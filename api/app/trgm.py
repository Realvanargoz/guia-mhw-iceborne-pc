"""Exact pure-Python port of PostgreSQL 17 contrib/pg_trgm (trgm_op.c) as built in the project's database
(Alpine/musl libc, UTF8, libc provider, ctype en_US.utf8; pg_trgm 1.6; KEEPONLYALNUM + IGNORECASE, LPADDING=2,
RPADDING=1, DIVUNION).

* word characters (``ISWORDCHR`` = ``t_isalnum``: musl ``isalnum``/``iswalnum``) and the lower-casing
  (``lowerstr_with_len`` = musl ``towlower``) come from tables extracted from the live database
  (``_fnorm_table.WORDCHR_RANGES`` / ``LOWER``).
* trigrams containing multibyte characters are compacted like ``compact_trigram()``: PG's *legacy* CRC32
  (normal-table update on reflected data, init/final 0xFFFFFFFF), keeping the 3 low-order bytes (little-endian
  ``CPTRGM``). Two trigrams are equal iff their 3 stored bytes are equal, CRC collisions included.
* similarities are float4: every ``CALCSML`` is rounded to IEEE single precision (``struct 'f'``) exactly where the
  C code stores a float4. Division of two small ints in double then rounding to float is exact (53 >= 2*24+2).

Public API (all ``*_f32`` return the exact float4 value as a Python float; the plain names return what psycopg
hands to Python for a float4 column: ``float(float4out(x))``, i.e. the shortest round-trip decimal):

    show_trgm(s)                 -> sorted list[str] like SELECT show_trgm(s) (as a set; PG's own order differs)
    similarity(a, b)             -> similarity(a, b)
    word_similarity(a, b)        -> word_similarity(a, b)
    word_similar(a, b)           -> a <% b   (threshold pg_trgm.word_similarity_threshold = 0.6)
    prepare(s) / word_similarity_prepared(q_prepared, doc_prepared) -> cached-trigram fast path
"""
from __future__ import annotations

import re
import struct

from ._fnorm_table import LOWER, WORDCHR_RANGES

__all__ = ["WORD_SIMILARITY_THRESHOLD", "SIMILARITY_THRESHOLD", "show_trgm", "trgm_keys", "prepare",
           "similarity", "similarity_f32", "word_similarity", "word_similarity_f32", "word_similarity_prepared",
           "word_similar", "to_psycopg_float4"]

WORD_SIMILARITY_THRESHOLD = 0.6   # SHOW pg_trgm.word_similarity_threshold (GUC is a C double)
SIMILARITY_THRESHOLD = 0.3        # SHOW pg_trgm.similarity_threshold

# ------------------------------------------------------------------------------------------ float4

_F = struct.Struct("<f")


def _f32(x: float) -> float:
    return _F.unpack(_F.pack(x))[0]


_SML_CACHE: dict = {}


def _calcsml(count: int, len1: int, len2: int) -> float:
    """CALCSML(count, len1, len2) = (float4) count / (float4) (len1 + len2 - count)."""
    denom = len1 + len2 - count
    key = (count, denom)
    v = _SML_CACHE.get(key)
    if v is None:
        v = _SML_CACHE[key] = _f32(count / denom)
    return v


_PG_CACHE: dict = {}


def to_psycopg_float4(x: float) -> float:
    """float4 value -> the Python float psycopg returns for it (float4out = shortest round-trip digits)."""
    v = _PG_CACHE.get(x)
    if v is None:
        if x == 0.0:
            v = 0.0
        else:
            for digits in range(1, 10):
                v = float("%.*g" % (digits, x))
                if _f32(v) == x:
                    break
        _PG_CACHE[x] = v
    return v


# ------------------------------------------------------------------------------------------ trigrams

def _cls(lo: int, hi: int) -> str:
    return "\\U%08x" % lo if lo == hi else "\\U%08x-\\U%08x" % (lo, hi)


_WORD_RE = re.compile("[" + "".join(_cls(lo, hi) for lo, hi in WORDCHR_RANGES) + "]+")

# legacy CRC32 as in src/include/utils/pg_crc.h (COMP_CRC32_NORMAL_TABLE with pg_crc32_table)
_CRC_TABLE = []
for _i in range(256):
    _c = _i
    for _ in range(8):
        _c = (_c >> 1) ^ 0xEDB88320 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)
del _i, _c


def _legacy_crc32(data: bytes) -> int:
    crc = 0xFFFFFFFF
    tab = _CRC_TABLE
    for b in data:
        crc = tab[((crc >> 24) ^ b) & 0xFF] ^ ((crc << 8) & 0xFFFFFFFF)
    return crc ^ 0xFFFFFFFF


_KEY_CACHE: dict = {}


def _key(t: str):
    """Identity of a 3-character trigram = its 3 stored bytes. ASCII bytes are returned as a str (so a CRC that
    happens to produce 3 ASCII bytes still equals the matching plain trigram), anything else as bytes."""
    k = _KEY_CACHE.get(t)
    if k is None:
        b = t.encode("utf-8")
        if len(b) == 3:
            k = t
        else:
            raw = (_legacy_crc32(b) & 0xFFFFFF).to_bytes(3, "little")
            k = raw.decode("ascii") if raw.isascii() else raw
        if len(_KEY_CACHE) > 200_000:
            _KEY_CACHE.clear()
        _KEY_CACHE[t] = k
    return k


def _lower(s: str) -> str:
    return s.lower() if s.isascii() else s.translate(LOWER)


def trgm_keys(s: str) -> list:
    """Positional trigrams in generation order, duplicates kept (generate_trgm_only)."""
    if not s:
        return []
    low = _lower(s)   # towlower is 1:1 per code point, so spans found on `s` index `low` too
    out = []
    key = _key
    for m in _WORD_RE.finditer(s):
        w = "  " + low[m.start():m.end()] + " "
        out.extend(key(w[i:i + 3]) for i in range(len(w) - 2))
    return out


def show_trgm(s: str) -> list[str]:
    """Like SELECT show_trgm(s): printable trigrams as text, compacted ones as '0x%06x'. Sorted by Python."""
    res = set()
    for k in set(trgm_keys(s)):
        if isinstance(k, str) and all(c == " " or (c.isascii() and c.isalnum()) for c in k):
            res.add(k)
        else:
            b = k.encode("ascii") if isinstance(k, str) else k
            res.add("0x%06x" % int.from_bytes(b, "big"))
    return sorted(res)


# ------------------------------------------------------------------------------------------ similarity

def similarity_f32(a: str, b: str) -> float:
    t1 = set(trgm_keys(a))
    t2 = set(trgm_keys(b))
    if not t1 or not t2:
        return 0.0
    return _calcsml(len(t1 & t2), len(t1), len(t2))


def similarity(a: str | None, b: str | None) -> float | None:
    if a is None or b is None:
        return None
    return to_psycopg_float4(similarity_f32(a, b))


def prepare(s: str):
    """Precomputed trigrams for either side: (positional list, distinct set)."""
    keys = trgm_keys(s)
    return keys, frozenset(keys)


def _iterate_word_similarity(trg2: list, t1: frozenset, ulen1: int) -> float:
    """calc_word_similarity + iterate_word_similarity (flags = 0) over the positional trigrams of str2."""
    # trg2indexes: id of the distinct trigram at each position; found[id]: trigram present in str1
    ids: dict = {}
    trg2indexes = [ids.setdefault(k, len(ids)) for k in trg2]
    found = [False] * len(ids)
    for k, j in ids.items():
        if k in t1:
            found[j] = True
    lastpos = [-1] * len(ids)
    ulen2 = count = 0
    upper = lower = -1
    smlr_max = 0.0
    for i, trgindex in enumerate(trg2indexes):
        f = found[trgindex]
        if lower >= 0 or f:
            if lastpos[trgindex] < 0:
                ulen2 += 1
                if f:
                    count += 1
            lastpos[trgindex] = i
        if f:
            upper = i
            if lower == -1:
                lower = i
                ulen2 = 1
            smlr_cur = _calcsml(count, ulen1, ulen2)
            tmp_count = count
            tmp_ulen2 = ulen2
            prev_lower = lower
            for tmp_lower in range(lower, upper + 1):
                smlr_tmp = _calcsml(tmp_count, ulen1, tmp_ulen2)
                if smlr_tmp > smlr_cur:
                    smlr_cur = smlr_tmp
                    ulen2 = tmp_ulen2
                    lower = tmp_lower
                    count = tmp_count
                tmp_trgindex = trg2indexes[tmp_lower]
                if lastpos[tmp_trgindex] == tmp_lower:
                    tmp_ulen2 -= 1
                    if found[tmp_trgindex]:
                        tmp_count -= 1
            if smlr_cur > smlr_max:
                smlr_max = smlr_cur
            for tmp_lower in range(prev_lower, lower):
                tmp_trgindex = trg2indexes[tmp_lower]
                if lastpos[tmp_trgindex] == tmp_lower:
                    lastpos[tmp_trgindex] = -1
    return smlr_max


def word_similarity_f32(a: str, b: str) -> float:
    t1 = frozenset(trgm_keys(a))
    if not t1:
        return 0.0
    return _iterate_word_similarity(trgm_keys(b), t1, len(t1))


def word_similarity_prepared(q, doc) -> float:
    """Exact float4 word_similarity from prepare()d values (q = first argument, doc = second)."""
    t1 = q[1]
    if not t1:
        return 0.0
    trg2 = doc[0]
    if t1.isdisjoint(doc[1]):
        return 0.0
    return _iterate_word_similarity(trg2, t1, len(t1))


def word_similarity(a: str | None, b: str | None) -> float | None:
    """word_similarity(a, b) as psycopg returns it."""
    if a is None or b is None:
        return None
    return to_psycopg_float4(word_similarity_f32(a, b))


def word_similar(a: str | None, b: str | None, threshold: float = WORD_SIMILARITY_THRESHOLD) -> bool | None:
    """``a <% b``. With WORD_SIMILARITY_CHECK_ONLY the C code stops early once the threshold is reached, which
    yields the same boolean as comparing the full maximum: (double) float4 >= threshold."""
    if a is None or b is None:
        return None
    return word_similarity_f32(a, b) >= threshold
