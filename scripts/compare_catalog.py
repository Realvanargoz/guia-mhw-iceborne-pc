"""Compare the Postgres reference schema `mhw` with the SQLite catalog (build/catalog.db).

Usage: python scripts/compare_catalog.py [--sqlite build/catalog.db]
                                         [--pg postgresql://mhw:mhw@127.0.0.1:5433/mhw]
Needs psycopg (pip install "psycopg[binary]"). Read-only on both sides. Exit 1 on any difference.
Tables are compared ordered by primary key (physical order when there is none); the search_index
materialized view is compared row by row in its natural order.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg

MAX_LINES = 60


def norm_pg(v, dtype):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).timestamp(), v.astimezone(timezone.utc).microsecond
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, bool):
        return int(v)
    return v


def norm_lite(v, dtype):
    if v is None:
        return None
    if dtype in ("json", "jsonb"):
        return json.loads(v)
    if dtype == "ARRAY":
        return json.loads(v)
    if dtype.startswith("timestamp"):
        if not (isinstance(v, str) and len(v) == 27 and v.endswith("Z")):
            return ("BAD-TS-FORMAT", v)
        d = datetime.strptime(v, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        return d.timestamp(), d.microsecond
    if dtype in ("numeric", "double precision", "real"):
        return float(v)
    return v


def same(a, b):
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) <= 1e-9 * max(1.0, abs(float(a)))
        except (TypeError, ValueError):
            return False
    if isinstance(a, tuple) and isinstance(b, tuple):
        return a == b
    return a == b and type(a) is type(b) or (isinstance(a, (int, bool)) and isinstance(b, (int, bool)) and a == b)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", default=str(Path(__file__).resolve().parents[1] / "build" / "catalog.db"))
    ap.add_argument("--strict-order", action="store_true", help="fail when search_index row order differs from the pg heap order")
    ap.add_argument("--pg", default="postgresql://mhw:mhw@127.0.0.1:5433/mhw")
    a = ap.parse_args()

    pg = psycopg.connect(a.pg, autocommit=True)
    pg.read_only = True
    lite = sqlite3.connect(f"file:{a.sqlite}?mode=ro", uri=True)
    pc, lc = pg.cursor(), lite.cursor()

    pc.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='mhw' AND table_type='BASE TABLE' ORDER BY 1")
    tables = [r[0] for r in pc.fetchall()]
    lite_tables = {r[0] for r in lc.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    diffs: list[str] = []
    notes: list[str] = []
    summary = []

    def d(msg):
        diffs.append(msg)

    for t in tables:
        if t not in lite_tables:
            d(f"{t}: table missing in SQLite")
            continue
        pc.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='mhw' AND table_name=%s ORDER BY ordinal_position", (t,))
        cols = pc.fetchall()
        names = [c for c, _ in cols]
        types = [x for _, x in cols]
        lcols = [r[1] for r in lc.execute(f'PRAGMA table_info("{t}")')]
        if lcols != names:
            d(f"{t}: column mismatch pg={names} sqlite={lcols}")
            continue
        pc.execute("""SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
                      WHERE i.indrelid=%s::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)""", (f"mhw.{t}",))
        pk = [r[0] for r in pc.fetchall()]
        col_sql = ", ".join(f'"{c}"' for c in names)
        pc.execute(f'SELECT {col_sql} FROM mhw."{t}" ORDER BY ' + (", ".join(f'"{c}"' for c in pk) if pk else "ctid"))
        prow = pc.fetchall()
        lc.execute(f'SELECT {col_sql} FROM "{t}" ORDER BY ' + (", ".join(f'"{c}"' for c in pk) if pk else "rowid"))
        lrow = lc.fetchall()
        summary.append(f"{t}={len(prow)}")
        if len(prow) != len(lrow):
            d(f"{t}: row count pg={len(prow)} sqlite={len(lrow)}")
        for i, (p, l) in enumerate(zip(prow, lrow)):
            for c, ty, pv, lv in zip(names, types, p, l):
                x, y = norm_pg(pv, ty), norm_lite(lv, ty)
                if not same(x, y):
                    d(f"{t}[{i}] pk={[p[names.index(k)] for k in pk]} {c}: pg={str(pv)[:60]!r} sqlite={str(lv)[:60]!r}")

    # search_index: materialized view, natural order.
    if "search_index" in lite_tables:
        pc.execute("SELECT type, id, name_es, name_en, subtitle, sort_key FROM mhw.search_index")
        prow = pc.fetchall()
        lrow = lc.execute("SELECT type, id, name_es, name_en, subtitle, sort_key FROM search_index ORDER BY rowid").fetchall()
        summary.append(f"search_index={len(prow)}")
        if len(prow) != len(lrow):
            d(f"search_index: row count pg={len(prow)} sqlite={len(lrow)}")
        pt, lt = [tuple(r) for r in prow], [tuple(r) for r in lrow]
        # Content: exact multiset equality (every row, every column).
        from collections import Counter
        cp, cl = Counter(pt), Counter(lt)
        for r in list((cp - cl).elements())[:10]:
            d(f"search_index: only in pg {r!r}")
        for r in list((cl - cp).elements())[:10]:
            d(f"search_index: only in sqlite {r!r}")
        # Order: Postgres heap order is not reproducible from the sources once UPDATEs have moved tuples
        # (SQLite uses deterministic CSV insertion order), so by default it is reported, not failed.
        if pt != lt:
            import difflib
            sm = difflib.SequenceMatcher(None, [r[:2] for r in pt], [r[:2] for r in lt], autojunk=False)
            moved = sum(i2 - i1 for tag, i1, i2, _, _ in sm.get_opcodes() if tag != "equal")
            msg = f"search_index row ORDER differs from pg heap order ({moved} of {len(pt)} rows displaced)"
            if a.strict_order:
                d(msg)
            else:
                notes.append(msg)
    else:
        d("search_index missing in SQLite")

    extra = lite_tables - set(tables) - {"search_index", "meta", "sqlite_sequence", "sqlite_stat1"}
    if extra:
        d(f"tables only in SQLite: {sorted(extra)}")

    print("compared:", " ".join(summary))
    print(f"differences: {len(diffs)}")
    for n in notes:
        print("  note: " + n)
    for line in diffs[:MAX_LINES]:
        print("  " + line)
    if len(diffs) > MAX_LINES:
        print(f"  ... {len(diffs) - MAX_LINES} more")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
