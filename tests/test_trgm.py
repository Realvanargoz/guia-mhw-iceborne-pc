"""Bit-exact parity of api/app/trgm.py with PostgreSQL 17 pg_trgm (fixtures from scripts/gen_fnorm_table.py).

Run: python -m pytest tests/test_trgm.py   or   python tests/test_trgm.py
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app import trgm  # noqa: E402
from app.textnorm import contains, f_norm, startswith  # noqa: E402

PAIRS = json.loads((ROOT / "tests" / "fixtures" / "trgm_pairs.json").read_text(encoding="utf-8"))["pairs"]
GOLDEN = json.loads((ROOT / "tests" / "fixtures" / "search_golden.json").read_text(encoding="utf-8"))


def bits(x: float) -> bytes:
    return struct.pack("<f", x)


def test_fixture_size():
    assert len(PAIRS) >= 5000


def test_word_similarity_exact():
    bad = []
    for a, b, ws_txt, ws_f8, _s_txt, _s_f8, _op in PAIRS:
        got = trgm.word_similarity_f32(a, b)
        # float8 cast of a float4 is exact: compare values and float32 bit patterns
        if got != ws_f8 or bits(got) != bits(ws_f8) or trgm.word_similarity(a, b) != float(ws_txt):
            bad.append((a, b, ws_f8, got))
    assert not bad, f"{len(bad)} mismatches, e.g. {bad[:5]!r}"


def test_word_similarity_prepared():
    bad = [(a, b) for a, b, _t, ws_f8, *_ in PAIRS
           if trgm.word_similarity_prepared(trgm.prepare(a), trgm.prepare(b)) != ws_f8]
    assert not bad, f"{len(bad)} mismatches, e.g. {bad[:5]!r}"


def test_similarity_exact():
    bad = []
    for a, b, _wt, _wf, s_txt, s_f8, _op in PAIRS:
        got = trgm.similarity_f32(a, b)
        if got != s_f8 or bits(got) != bits(s_f8) or trgm.similarity(a, b) != float(s_txt):
            bad.append((a, b, s_f8, got))
    assert not bad, f"{len(bad)} mismatches, e.g. {bad[:5]!r}"


def test_word_similar_operator():
    bad = [(a, b, op) for a, b, *_rest, op in PAIRS if trgm.word_similar(a, b) != op]
    assert not bad, f"{len(bad)} mismatches, e.g. {bad[:5]!r}"


def test_nulls():
    assert trgm.word_similarity(None, "a") is None and trgm.similarity("a", None) is None
    assert trgm.word_similar(None, None) is None


def test_golden_rows_score_prefix_contains():
    """Every row the current SQL returned: our f_norm/LIKE/word_similarity reproduce score, prefix, contains."""
    bad = []
    n = 0
    for g in GOLDEN["queries"]:
        nq = f_norm(g["q"].strip())
        for typ, rid, score, prefix, cont, es, en in g["sql_rows"]:
            doc = f_norm((es or "") + " " + (en or ""))
            got = (trgm.word_similarity(nq, doc),
                   bool(startswith(f_norm(es or ""), nq) or startswith(f_norm(en or ""), nq)),
                   contains(doc, nq))
            n += 1
            if got != (score, prefix, cont) or not (cont or trgm.word_similar(nq, doc)):
                bad.append((g["q"], typ, rid, (score, prefix, cont), got))
    assert n > 1000
    assert not bad, f"{len(bad)} mismatches, e.g. {bad[:5]!r}"


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
        print("ok  ", name)
    print(f"{len(tests)} passed ({len(PAIRS)} pg_trgm pairs, {len(GOLDEN['queries'])} golden queries)")
