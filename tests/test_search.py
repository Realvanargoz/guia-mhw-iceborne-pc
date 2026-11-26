"""Parity of api/app/search.py (in-memory search) with the old PostgreSQL /api/search.

* tests/fixtures/search_golden.json: SQL rows (score, prefix, contains) + final API order for 46 queries.
* build/golden/pg: /api/search captures of every line of tests/parity/search_queries.txt (skipped if absent).

Rows that tie on every ORDER BY key have no defined order in Postgres and LIMIT may cut through them, so results
are compared as consecutive tie groups: same group keys and sizes in the same order, same set per group, except
groups that are cut by a LIMIT (there both sides only need to pick rows of that exact tie class).

Run: python -m pytest tests/test_search.py -q   (add -s for the parity/latency summary)
"""
import json
import random
import sys
import threading
import time
import urllib.parse
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
GOLDEN = json.loads((ROOT / "tests" / "fixtures" / "search_golden.json").read_text(encoding="utf-8"))
FNORM = json.loads((ROOT / "tests" / "fixtures" / "fnorm.json").read_text(encoding="utf-8"))
QUERIES = ROOT / "tests" / "parity" / "search_queries.txt"
CAPTURES = ROOT / "build" / "golden" / "pg"

from app import db, search, trgm, userdb  # noqa: E402
from app.textnorm import contains, f_norm, like, startswith  # noqa: E402

# copied from the old Postgres main.py (kept independent of search.py on purpose)
_OLD_TYPE_PRIORITY = ["item", "monster", "armor_set", "layered", "achievement", "quest", "guide", "location",
                      "armor", "weapon", "skill", "decoration", "charm"]
_TYPE_RANK = {t: i for i, t in enumerate(_OLD_TYPE_PRIORITY)}

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")


@pytest.fixture(scope="module", autouse=True)
def index(tmp_path_factory):
    user = tmp_path_factory.mktemp("search") / "user.db"
    userdb.migrate(user)
    db.open_pool(user, CATALOG)
    search.reset()
    search.warm(background=False)
    yield search._get_index()
    search.reset()
    db.close_pool()


# ------------------------------------------------------------------ independent brute-force reference

_REF_ROWS = None


def _ref_rows(idx):
    """Per catalog row: (type, id, nes, nen, doc, prepared doc trigrams, length), computed without the index."""
    global _REF_ROWS
    if _REF_ROWS is None:
        out = []
        for t, rid, es, en, _sub in idx.rows:
            nes, nen = f_norm(es or ""), f_norm(en or "")
            doc = f_norm((es or "") + " " + (en or ""))
            name = es if es is not None else en
            out.append((t, rid, nes, nen, doc, trgm.prepare(doc), len(name) if name is not None else 10 ** 9))
        _REF_ROWS = out
    return _REF_ROWS


def reference(idx, q, typ):
    """{(type, id): (prefix, contains, score, length)} for every row the old WHERE accepts."""
    nq = f_norm(q.strip())
    qp = trgm.prepare(nq)
    out = {}
    for t, rid, nes, nen, doc, dp, ln in _ref_rows(idx):
        if typ is not None and t != typ:
            continue
        s32 = trgm.word_similarity_prepared(qp, dp)
        c = contains(doc, nq)
        if c or s32 >= trgm.WORD_SIMILARITY_THRESHOLD:
            p = bool(startswith(nes, nq) or startswith(nen, nq))
            out[(t, rid)] = (p, bool(c), trgm.to_psycopg_float4(s32), ln)
    return out


def _sqlkey(a):
    p, c, s, ln = a
    return (not p, not c, -s, ln)


def _finalkey(ident, a):
    p, c, s, ln = a
    return (not p, not c, -round(s, 1), _TYPE_RANK.get(ident[0], 99), -s, ln)


def _groups(ids, keyf):
    groups = []
    for i in ids:
        k = keyf(i)
        if not groups or groups[-1][0] != k:
            groups.append((k, []))
        groups[-1][1].append(i)
    return groups


def compare(name, expected_ids, got_ids, universe, keyf, sql_limit, limit):
    """Tie-aware comparison of two ordered id lists. Returns a list of error strings."""
    errs = []
    for side, ids in (("golden", expected_ids), ("mine", got_ids)):
        miss = [i for i in ids if i not in universe]
        if miss:
            errs.append(f"{name}: {side} has non-candidates {miss[:4]}")
    if errs:
        return errs
    ordered = sorted(universe, key=lambda i: _sqlkey(universe[i]))
    ambiguous = None   # SQL tie class that LIMIT limit*3 cuts through
    if len(ordered) > sql_limit and _sqlkey(universe[ordered[sql_limit - 1]]) == _sqlkey(universe[ordered[sql_limit]]):
        ambiguous = _sqlkey(universe[ordered[sql_limit - 1]])
    ge, gm = _groups(expected_ids, keyf), _groups(got_ids, keyf)
    if [(k, len(v)) for k, v in ge] != [(k, len(v)) for k, v in gm]:
        errs.append(f"{name}: group layout differs: golden={[(k, len(v)) for k, v in ge][:5]} "
                    f"mine={[(k, len(v)) for k, v in gm][:5]}")
        return errs
    for n, ((k, a), (_, b)) in enumerate(zip(ge, gm)):
        if set(a) == set(b):
            continue
        last_cut = n == len(ge) - 1 and len(expected_ids) == limit
        if last_cut or _sqlkey(universe[a[0]]) == ambiguous:
            continue
        errs.append(f"{name}: tie group {k} differs: only golden {sorted(set(a) - set(b))[:4]} "
                    f"only mine {sorted(set(b) - set(a))[:4]}")
    return errs


def validate_final(name, ids, universe, sql_limit, limit):
    """Is ``ids`` a possible output of the old route? The SQL top-``sql_limit`` is fixed except for the tie class
    the LIMIT cuts through (Postgres may keep any subset of it, and the Python re-sort then splits that class by
    type). Rebuild the SQL top-N from the definite rows + the class rows that ``ids`` shows + the class rows least
    likely to surface, re-sort like main.py and compare tie-aware."""
    miss = [i for i in ids if i not in universe]
    if miss:
        return [f"{name}: non-candidates {miss[:4]}"]
    ordered = sorted(universe, key=lambda i: _sqlkey(universe[i]))
    top = ordered[:sql_limit]
    if len(ordered) > sql_limit:
        bkey = _sqlkey(universe[ordered[sql_limit - 1]])
        definite = [i for i in top if _sqlkey(universe[i]) != bkey]
        klass = [i for i in ordered if _sqlkey(universe[i]) == bkey]
        m = sql_limit - len(definite)
        shown = [i for i in ids if i in set(klass)]
        if len(shown) > m:
            return [f"{name}: {len(shown)} rows of the cut tie class shown, only {m} fit"]
        rest = sorted((i for i in klass if i not in set(shown)), key=lambda i: -_TYPE_RANK.get(i[0], 99))
        top = definite + shown + rest[:m - len(shown)]
    sim = sorted(top, key=lambda i: _finalkey(i, universe[i]))[:limit]
    return compare(name, sim, list(ids), universe, lambda i: _finalkey(i, universe[i]), len(universe) + 1, limit)


# ------------------------------------------------------------------ LIKE matcher

def test_like_matcher_vs_textnorm_fixture():
    bad = []
    for value, pattern, pg in FNORM["like"]:
        try:
            segs = search._like_segments(pattern)
        except ValueError:
            continue
        if search._like(value, segs) != pg:
            bad.append((value, pattern, pg))
    assert not bad, bad[:5]


def test_like_matcher_random():
    rnd = random.Random(7)
    alphabet = "ab%_\\ñ "
    for _ in range(20000):
        v = "".join(rnd.choice("ab%_\\ñ ") for _ in range(rnd.randint(0, 8)))
        nq = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(0, 5)))
        c_fn, p_fn = search._matchers(nq)
        assert c_fn(v) == contains(v, nq), (v, nq)
        assert p_fn(v) == startswith(v, nq), (v, nq)
        pat = nq + "%"
        assert search._like(v, search._like_segments(pat)) == like(v, pat)


def test_like_no_catastrophic_backtracking():
    t = time.perf_counter()
    c_fn, _ = search._matchers("a%" * 49 + "b")
    assert not c_fn("a" * 400)
    assert time.perf_counter() - t < 0.5


# ------------------------------------------------------------------ golden fixture (46 queries)

@pytest.mark.parametrize("case", GOLDEN["queries"], ids=lambda c: f"{c['q']!r}|{c['type']}|{c['limit']}")
def test_golden_sql_rows_and_api_order(index, case):
    q, typ, limit, sql_limit = case["q"], case["type"], case["limit"], case["sql_limit"]
    universe = reference(index, q, typ)
    gold = {(r[0], r[1]): r for r in case["sql_rows"]}
    # golden attributes == independent reference
    for ident, (t, rid, score, p, c, es, en) in gold.items():
        assert ident in universe, f"golden row {ident} not a candidate"
        up, uc, us, _ = universe[ident]
        assert (up, uc, us) == (p, c, float(score)), (ident, (p, c, score), universe[ident])
    # SQL rows (before the Python re-sort)
    mine_sql = search.search_sql_rows(q.strip(), typ, sql_limit)
    for r in mine_sql:
        assert universe[(r["type"], r["id"])] [:3] == (r["prefix"], r["contains"], r["score"])
    errs = compare("sql", [(r[0], r[1]) for r in case["sql_rows"]], [(r["type"], r["id"]) for r in mine_sql],
                   universe, lambda i: _sqlkey(universe[i]), sql_limit, sql_limit)
    # final API order
    mine = search.search(q, typ, limit)
    assert all(set(r) == {"type", "id", "name_es", "name_en", "subtitle", "score"} for r in mine)
    errs += validate_final("api golden", [tuple(x) for x in case["api_ids"]], universe, sql_limit, limit)
    errs += validate_final("api mine", [(r["type"], r["id"]) for r in mine], universe, sql_limit, limit)
    assert not errs, "\n".join(errs)


# ------------------------------------------------------------------ parity captures (search_queries.txt)

def _capture_requests():
    reqs = []
    for line in QUERIES.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line:
            continue
        q, typ, lim = line.rsplit("|", 2) if line.count("|") >= 2 else (line, "", "")
        params = [("q", q)]
        if typ:
            params.append(("type", typ))
        if lim:
            params.append(("limit", lim))
        reqs.append((q, typ or None, int(lim) if lim else 40,
                     "GET /api/search?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)))
    return reqs


# Catalogue rows that did not exist when build/golden/pg was captured (excluded only from the golden-side check).
_AFTER_CAPTURE = {("guide", "cantina-combinaciones")}


@pytest.mark.skipif(not CAPTURES.is_dir(), reason="build/golden/pg captures missing")
def test_parity_captures(index):
    caps = {}
    for f in CAPTURES.iterdir():
        if f.suffix == ".json" and "_api_search_" in f.name:
            rec = json.loads(f.read_text(encoding="utf-8"))
            caps[rec["key"]] = rec
    errs, checked, skipped = [], 0, []
    for q, typ, limit, key in _capture_requests():
        rec = caps.get(key)
        assert rec is not None, f"no capture for {key}"
        if rec["status"] != 200:   # 422 from the route's own validation (q/limit bounds), not search.py's job
            skipped.append((key, rec["status"]))
            continue
        checked += 1
        body = rec["body"]
        if body["q"] != q.strip():
            errs.append(f"{key}: q {body['q']!r} != {q.strip()!r}")
        universe = reference(index, q, typ)
        gold = body["results"]
        mine = search.search(q, typ, limit)
        for r in gold:
            ident = (r["type"], r["id"])
            if ident in universe and universe[ident][2] != r["score"]:
                errs.append(f"{key}: score {ident} pg={r['score']} ref={universe[ident][2]}")
        gmap = {(r["type"], r["id"]): r for r in gold}
        for r in mine:
            g = gmap.get((r["type"], r["id"]))
            if g is not None and g != r:
                errs.append(f"{key}: row differs {g} != {r}")
        # The Postgres captures are frozen: rows added to the catalogue later cannot appear in them.
        then = {i: v for i, v in universe.items() if i not in _AFTER_CAPTURE}
        errs += validate_final(key + " golden", [(r["type"], r["id"]) for r in gold], then, limit * 3, limit)
        errs += validate_final(key + " mine", [(r["type"], r["id"]) for r in mine], universe, limit * 3, limit)
    print(f"\nparity: {checked} searches compared, {len(skipped)} skipped (non-200: {skipped}), {len(errs)} mismatches")
    assert checked >= 270
    assert not errs, "\n".join(errs[:20])


# ------------------------------------------------------------------ behaviour, latency, threads

def test_shape_type_filter_and_limits():
    r = search.search("rathalos", None, 5)
    assert len(r) == 5 and list(r[0]) == ["type", "id", "name_es", "name_en", "subtitle", "score"]
    assert all(x["type"] == "monster" for x in search.search("rathalos", "monster", 20))
    assert search.search("rathalos", "nope", 20) == []
    assert search.search("rathalos", "", 20) == []           # type = '' matches nothing, like the SQL
    assert len(search.search("a", None, 200)) == 200
    assert search.search("zzzzqqqxxj", None, 40) == []
    assert len(search.search("   ", None, 7)) == 7           # strip -> '' -> LIKE '%%' matches every row


def test_latency_p95():
    reqs = _capture_requests()
    times = []
    for q, typ, limit, _ in reqs:
        t = time.perf_counter()
        search.search(q[:100], typ, min(max(limit, 1), 200))
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    p50, p95, mx = times[len(times) // 2], times[int(len(times) * 0.95)], times[-1]
    print(f"\nlatency over {len(times)} queries: p50={p50:.2f} ms p95={p95:.2f} ms max={mx:.2f} ms")
    assert p95 < 50


def test_thread_safety():
    reqs = [(q[:100], typ, min(max(limit, 1), 200)) for q, typ, limit, _ in _capture_requests()][:80]
    expected = [search.search(*r) for r in reqs]
    errors = []

    def worker(seed):
        order = list(range(len(reqs)))
        random.Random(seed).shuffle(order)
        for i in order:
            if search.search(*reqs[i]) != expected[i]:
                errors.append(reqs[i])

    search.reset()   # concurrent first use must build the index exactly once
    ts = [threading.Thread(target=worker, args=(s,)) for s in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors, errors[:5]
