"""In-memory bilingual search: an exact replacement for the PostgreSQL ``/api/search`` query (pg_trgm + f_norm).

The old route ran (``q`` already stripped, ``nq = f_norm(q)``, ``doc = f_norm(coalesce(name_es,'') || ' ' ||
coalesce(name_en,''))``)::

    SELECT type, id, name_es, name_en, subtitle,
           doc LIKE '%' || nq || '%'                                         AS contains,
           f_norm(coalesce(name_es,'')) LIKE nq || '%' OR f_norm(coalesce(name_en,'')) LIKE nq || '%'  AS prefix,
           word_similarity(nq, doc)                                          AS score
    FROM search_index WHERE (type filter) AND (doc LIKE '%' || nq || '%' OR nq <% doc)
    ORDER BY prefix DESC, contains DESC, score DESC, length(coalesce(name_es, name_en))
    LIMIT limit * 3

and then re-sorted the rows in Python (stable) by ``(not prefix, not contains, -round(score, 1), TYPE_PRIORITY)``,
cut them to ``limit`` and dropped ``prefix``/``contains``. :func:`search` returns exactly that final list.

Exactness: ``textnorm.f_norm`` and ``trgm`` are bit-exact ports; LIKE keeps ``%``, ``_`` and ``\\`` of the query as
wildcards/escape (as the SQL did). Rows that tie on all four ORDER BY keys have no defined order in Postgres (and
``LIMIT`` may cut through such a group); here they come in catalog row order.

Speed: per-row normalised strings and positional trigrams are precomputed once, plus an inverted trigram index.
``word_similarity(nq, doc) <= f32(shared / |trgm(nq)|)`` (``shared`` = distinct common trigrams), which bounds the
fuzzy candidates (``<%`` needs >= 0.6) and lets the top-``limit*3`` selection stop computing exact scores early.

LIKE matching never builds a backtracking regex: the pattern is split on ``%`` into fixed-length segments matched
greedily left to right (``str.find`` / a quantifier-free escaped regex for segments that contain ``_``).
"""
from __future__ import annotations

import heapq
import re
import threading
from array import array
from collections import Counter
from itertools import chain

from . import trgm
from .textnorm import f_norm

__all__ = ["search", "search_sql_rows", "warm", "TYPE_PRIORITY"]

TYPE_PRIORITY = ["item", "monster", "armor_set", "layered", "achievement", "quest", "guide", "location",
                 "armor", "weapon", "skill", "decoration", "charm"]
_TYPE_RANK = {t: i for i, t in enumerate(TYPE_PRIORITY)}

_THRESHOLD = trgm.WORD_SIMILARITY_THRESHOLD   # nq <% doc  <=>  (double) float4 word_similarity >= 0.6
_NO_LENGTH = 1 << 30                           # length(NULL) sorts last (ASC = NULLS LAST)
_MAX_PATTERN = 2000                            # q <= 100 chars; f_norm expands a code point to at most a few
_MAX_LIMIT = 2000


# ------------------------------------------------------------------------------------------ index

class _Index:
    __slots__ = ("rows", "doc", "nes", "nen", "length", "trg", "post", "by_type")

    def __init__(self, raw_rows: list[dict]):
        self.rows = []      # (type, id, name_es, name_en, subtitle)
        self.doc = []       # f_norm(coalesce(name_es,'') || ' ' || coalesce(name_en,''))
        self.nes = []       # f_norm(coalesce(name_es,''))
        self.nen = []
        self.length = []    # length(coalesce(name_es, name_en)), NULL -> _NO_LENGTH
        self.trg = []       # positional trigram keys of doc (tuple)
        post: dict = {}
        for i, r in enumerate(raw_rows):
            es, en = r["name_es"], r["name_en"]
            nes, nen = f_norm(es or ""), f_norm(en or "")
            doc = nes + " " + nen          # f_norm is per code point, so this == f_norm(es || ' ' || en)
            name = es if es is not None else en
            keys = tuple(trgm.trgm_keys(doc))
            self.rows.append((r["type"], r["id"], es, en, r["subtitle"]))
            self.doc.append(doc)
            self.nes.append(nes)
            self.nen.append(nen)
            self.length.append(len(name) if name is not None else _NO_LENGTH)
            self.trg.append(keys)
            for k in set(keys):
                p = post.get(k)
                if p is None:
                    p = post[k] = array("I")
                p.append(i)
        self.post = post
        by_type: dict = {}
        for i, row in enumerate(self.rows):
            by_type.setdefault(row[0], []).append(i)
        self.by_type = {t: (ids, [self.doc[i] for i in ids]) for t, ids in by_type.items()}
        self.by_type[None] = (list(range(len(self.rows))), list(self.doc))


_index: _Index | None = None
_lock = threading.Lock()


def _load_rows() -> list[dict]:
    from .db import all_
    return all_("SELECT type, id, name_es, name_en, subtitle FROM search_index ORDER BY rowid")


def _get_index() -> _Index:
    global _index
    idx = _index
    if idx is None:
        with _lock:
            if _index is None:
                _index = _Index(_load_rows())
            idx = _index
    return idx


def warm(background: bool = True) -> threading.Thread | None:
    """Build the index now (``background=False``) or in a daemon thread. Safe to call more than once."""
    if not background:
        _get_index()
        return None

    def run():
        try:
            _get_index()
        except Exception:   # noqa: BLE001 - a failed warm-up just means the first search builds it (and raises)
            pass

    t = threading.Thread(target=run, name="search-warm", daemon=True)
    t.start()
    return t


def reset() -> None:
    """Drop the index (tests / catalog swap)."""
    global _index
    with _lock:
        _index = None


# ------------------------------------------------------------------------------------------ LIKE

def _like_segments(pattern: str):
    """Split a LIKE pattern (default escape ``\\``) on unescaped ``%`` into fixed-length segments.
    Each segment is ``(length, literal_str | None, compiled_regex | None)``."""
    if len(pattern) > _MAX_PATTERN:
        raise ValueError("pattern too long")
    segs, cur = [], []
    i, n = 0, len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\":
            i += 1
            if i >= n:
                raise ValueError("LIKE pattern must not end with escape character")
            cur.append(pattern[i])
        elif ch == "%":
            segs.append(cur)
            cur = []
        elif ch == "_":
            cur.append(None)
        else:
            cur.append(ch)
        i += 1
    segs.append(cur)
    out = []
    for toks in segs:
        if None in toks:
            rx = re.compile("".join("." if t is None else re.escape(t) for t in toks), re.DOTALL)
            out.append((len(toks), None, rx))
        else:
            out.append((len(toks), "".join(toks), None))
    return out


def _seg_at(seg, v: str, pos: int) -> bool:
    n, lit, rx = seg
    if lit is not None:
        return v.startswith(lit, pos)
    return pos + n <= len(v) and rx.match(v, pos) is not None


def _seg_find(seg, v: str, pos: int) -> int:
    n, lit, rx = seg
    if lit is not None:
        return v.find(lit, pos)
    m = rx.search(v, pos)
    return -1 if m is None else m.start()


def _like(v: str, segs) -> bool:
    """``v LIKE pattern`` for pre-split segments: greedy leftmost placement is exact for fixed-length segments."""
    first = segs[0]
    if len(segs) == 1:
        return len(v) == first[0] and _seg_at(first, v, 0)
    if not _seg_at(first, v, 0):
        return False
    pos = first[0]
    for seg in segs[1:-1]:
        j = _seg_find(seg, v, pos)
        if j < 0:
            return False
        pos = j + seg[0]
    last = segs[-1]
    start = len(v) - last[0]
    return start >= pos and _seg_at(last, v, start)


def _matchers(nq: str):
    """(contains(doc), startswith(name)) with the SQL's LIKE semantics for the unescaped needle nq."""
    if "%" not in nq and "_" not in nq and "\\" not in nq:
        return (lambda s: nq in s), (lambda s: s.startswith(nq))
    c_segs = _like_segments("%" + nq + "%")
    p_segs = _like_segments(nq + "%")
    return (lambda s: _like(s, c_segs)), (lambda s: _like(s, p_segs))


# ------------------------------------------------------------------------------------------ search

def _top(cands, k: int, exact, ub, length, need_threshold: bool) -> list[tuple]:
    """Best ``k`` of ``cands`` by (score DESC, length ASC), computing exact scores lazily in upper-bound order.
    Returns [(score_f32, row)] sorted. With need_threshold, rows whose exact score < 0.6 are dropped."""
    if k <= 0 or not cands:
        return []
    out: list[tuple] = []
    if len(cands) <= k:
        for i in cands:
            s = exact(i)
            if not need_threshold or s >= _THRESHOLD:
                out.append((s, i))
    else:
        order = sorted(cands, key=lambda i: (-ub[i], length[i]))   # stable: catalog order among equals
        heap: list = []   # min-heap of (score, -length, -seq) = worst kept row on top
        for seq, i in enumerate(order):
            if len(heap) >= k:
                w = heap[0]
                if (ub[i], -length[i]) <= (w[0], w[1]):
                    break
            s = exact(i)
            if need_threshold and s < _THRESHOLD:
                continue
            item = (s, -length[i], -seq, i)
            if len(heap) < k:
                heapq.heappush(heap, item)
            elif item[:3] > heap[0][:3]:
                heapq.heapreplace(heap, item)
        out = [(h[0], h[3]) for h in heap]
    out.sort(key=lambda t: (-t[0], length[t[1]], t[1]))
    return out


def search_sql_rows(q: str, type: str | None, limit: int) -> list[dict]:
    """Rows of the old SQL (before the Python re-sort): keys type, id, name_es, name_en, subtitle, contains,
    prefix, score (score as psycopg returned the float4). ``limit`` is the SQL LIMIT (route passes limit*3)."""
    idx = _get_index()
    nq = f_norm(q)
    if limit <= 0:
        return []
    sel = idx.by_type.get(type)
    if sel is None:
        return []
    ids, docs = sel
    contains_fn, prefix_fn = _matchers(nq)

    qkeys = trgm.prepare(nq)[1]
    nqk = len(qkeys)
    shared: Counter = Counter()
    if nqk:
        shared.update(chain.from_iterable(idx.post[k] for k in qkeys if k in idx.post))
    ub: dict = {}
    trg = idx.trg
    length = idx.length

    def exact(i: int) -> float:
        if not shared.get(i):
            return 0.0
        return trgm._iterate_word_similarity(trg[i], qkeys, nqk)   # exact float4 word_similarity(nq, doc)

    def bound(i: int) -> float:
        c = shared.get(i, 0)
        return trgm._calcsml(c, nqk, c) if c else 0.0               # f32(c / nqk) >= exact score

    g_prefix, g_contains = [], []
    contains_set = set()
    nes, nen = idx.nes, idx.nen
    for i, d in zip(ids, docs):
        if contains_fn(d):
            contains_set.add(i)
            (g_prefix if (prefix_fn(nes[i]) or prefix_fn(nen[i])) else g_contains).append(i)
    g_fuzzy = []
    if nqk:
        type_ok = None if type is None else set(ids)
        for i, c in shared.items():
            if i in contains_set or (type_ok is not None and i not in type_ok):
                continue
            if trgm._calcsml(c, nqk, c) >= _THRESHOLD:
                g_fuzzy.append(i)
        g_fuzzy.sort()

    out: list[dict] = []
    remaining = limit
    for group, is_prefix, is_contains in ((g_prefix, True, True), (g_contains, False, True), (g_fuzzy, False, False)):
        if remaining <= 0:
            break
        for i in group:
            ub[i] = bound(i)
        picked = _top(group, remaining, exact, ub, length, need_threshold=not is_contains)
        for s, i in picked:
            t, rid, es, en, sub = idx.rows[i]
            out.append({"type": t, "id": rid, "name_es": es, "name_en": en, "subtitle": sub,
                        "contains": is_contains, "prefix": is_prefix, "score": trgm.to_psycopg_float4(s)})
        remaining -= len(picked)
    return out


def search(q: str, type: str | None = None, limit: int = 40) -> list[dict]:
    """Final ``/api/search`` results (keys type, id, name_es, name_en, subtitle, score), same as the old route."""
    q = q.strip()
    limit = max(0, min(int(limit), _MAX_LIMIT))
    rows = search_sql_rows(q, type, limit * 3)
    rows.sort(key=lambda r: (not r["prefix"], not r["contains"], -round(r["score"], 1),
                             _TYPE_RANK.get(r["type"], 99)))
    rows = rows[:limit]
    for r in rows:
        del r["contains"], r["prefix"]
    return rows
