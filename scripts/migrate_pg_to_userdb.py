#!/usr/bin/env python
"""ONE-TIME migration of the personal data in the old Postgres into the new SQLite user.db.

Postgres is only ever read (SELECT, read-only transaction). Nothing personal is printed: only counts and hashes.

  python scripts/migrate_pg_to_userdb.py --pg postgresql://mhw:mhw@127.0.0.1:5433/mhw --out data/user.db \
      [--with-build-cache] [--copy-stored-save <dest dir>]

Exit codes: 0 ok, 2 refused (--out exists and is non-empty), 3 verification failed, 4 missing dependency/other error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

# table -> (ordered columns, ORDER BY, timestamptz cols, json cols, bool cols)
TABLES: dict[str, dict] = {
    "progress": dict(cols=["entity_type", "entity_id", "done", "notes", "updated_at"],
                     order="entity_type, entity_id", pk=["entity_type", "entity_id"], ts=["updated_at"], js=[], bools=["done"]),
    "calendar_periods": dict(cols=["id", "kind", "festival_slug", "title", "start_at", "end_at", "notes", "created_at"],
                             order="id", pk=["id"], ts=["start_at", "end_at", "created_at"], js=[], bools=[]),
    "calendar_settings": dict(cols=["key", "value", "updated_at"], order="key", pk=["key"], ts=["updated_at"], js=["value"], bools=[]),
    "profile_snapshots": dict(cols=["id", "taken_at", "source", "sha256", "slot", "data"], order="id", pk=["id"],
                              ts=["taken_at"], js=["data"], bools=[]),
    "build_recommendations": dict(cols=["monster_id", "rank", "cap", "rules_hash", "data_sig", "data", "built_at"],
                                  order="monster_id, rank, cap", pk=["monster_id", "rank", "cap"], ts=["built_at"], js=["data"], bools=[]),
}
CACHE_TABLES = {"build_recommendations"}

# progress entity_type -> catalog query returning the ids (as text) that exist
CATALOG_IDS = {
    "item": "SELECT id FROM items",
    "monster_hunted": "SELECT id FROM monsters",
    "monster_captured": "SELECT id FROM monsters",
    "armor_set": "SELECT id FROM armor_sets",
    "quest": "SELECT id FROM quests",
    "layered": "SELECT slug FROM layered_armor",
    "achievement": "SELECT slug FROM achievements",
    "ingredient": "SELECT id FROM canteen_ingredients",
}


# ------------------------------------------------------------------ conversion helpers
def to_utc_iso(v):
    """timestamptz (datetime, naive treated as UTC) or ISO string -> fixed-width UTC text with microseconds and Z."""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        v = datetime.fromisoformat(s[:-1] + "+00:00" if s.endswith("Z") else s)
    v = v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc)
    return v.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def to_json_text(v):
    """jsonb value (already parsed by the driver, or a JSON string) -> JSON text."""
    if isinstance(v, (bytes, bytearray)):
        v = v.decode()
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            pass  # a plain string stored as jsonb would already have been decoded by the driver
    return json.dumps(v, ensure_ascii=False)


def to_bool_int(v):
    return None if v is None else (1 if v else 0)


def convert_row(spec: dict, row: dict) -> dict:
    out = {}
    for c in spec["cols"]:
        v = row[c]
        if c in spec["ts"]:
            v = to_utc_iso(v)
        elif c in spec["js"]:
            v = to_json_text(v)
        elif c in spec["bools"]:
            v = to_bool_int(v)
        out[c] = v
    return out


# ------------------------------------------------------------------ canonical hashing
def _canon_value(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else str(v)
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if isinstance(v, (datetime, date)):
        return to_utc_iso(v)
    return v


def _sort_key(spec: dict, r: dict):
    return tuple(str(r[c]) if not isinstance(r[c], (int, float)) else r[c] for c in spec["pk"])


def canonical_hash(spec: dict, rows) -> str:
    """SHA-256 over the rows (already in the target representation, ordered) as canonical JSON.

    JSON columns are re-parsed so the hash does not depend on key order/whitespace of the stored text.
    """
    h = hashlib.sha256()
    n = 0
    # sort in Python by primary key: Postgres and SQLite collate text differently, so ORDER BY is not comparable
    for r in sorted(rows, key=lambda r: _sort_key(spec, r)):
        vals = []
        for c in spec["cols"]:
            v = r[c]
            if c in spec["js"] and v is not None:
                v = json.loads(v) if isinstance(v, str) else v
            vals.append(_canon_value(v))
        h.update(json.dumps(vals, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        h.update(b"\n")
        n += 1
    return f"{n}:{h.hexdigest()}"


# ------------------------------------------------------------------ main flow
def _import_psycopg():
    try:
        import psycopg  # noqa: WPS433 (lazy on purpose)
        from psycopg.rows import dict_row
        return psycopg, dict_row
    except ImportError:
        print("ERROR: the 'psycopg' package is required (pip install \"psycopg[binary]\").", file=sys.stderr)
        sys.exit(4)


def pg_rows(cur, table: str, spec: dict):
    cur.execute(f"SELECT {', '.join(spec['cols'])} FROM public.{table} ORDER BY {spec['order']}")
    return cur.fetchall()


def sqlite_rows(conn: sqlite3.Connection, table: str, spec: dict):
    cur = conn.execute(f"SELECT {', '.join(spec['cols'])} FROM {table} ORDER BY {spec['order']}")
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def find_orphans(progress_rows, catalog_path: Path):
    if not catalog_path.is_file():
        return None
    cat = sqlite3.connect(f"{catalog_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        valid = {t: {str(r[0]) for r in cat.execute(q)} for t, q in CATALOG_IDS.items()}
    finally:
        cat.close()
    counts: dict[str, int] = {}
    for r in progress_rows:
        t = r["entity_type"]
        if t not in valid:
            counts[t] = counts.get(t, 0) + 1  # unknown type counts as orphan
        elif str(r["entity_id"]) not in valid[t]:
            counts[t] = counts.get(t, 0) + 1
    return counts


def run(args) -> int:
    out = Path(args.out)
    if out.exists() and out.stat().st_size > 0:
        print(f"REFUSED: {out} already exists and is not empty. Nothing was written.", file=sys.stderr)
        return 2
    psycopg, dict_row = _import_psycopg()
    from app import userdb  # target DDL

    tmp = Path(str(out) + ".tmp")
    for suffix in ("", "-wal", "-shm"):
        Path(str(tmp) + suffix).unlink(missing_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)

    tables = [t for t in TABLES if args.with_build_cache or t not in CACHE_TABLES]
    userdb.migrate(tmp)

    pg = psycopg.connect(args.pg, row_factory=dict_row, connect_timeout=10)
    pg.read_only = True  # every statement runs in a READ ONLY transaction
    pg_hash: dict[str, str] = {}
    progress_rows = []
    try:
        cur = pg.cursor()
        conn = sqlite3.connect(tmp, isolation_level=None)
        try:
            conn.execute("BEGIN IMMEDIATE")
            for t in tables:
                spec = TABLES[t]
                rows = pg_rows(cur, t, spec)
                conv = [convert_row(spec, r) for r in rows]
                pg_hash[t] = canonical_hash(spec, conv)  # Postgres side, in target representation
                if t == "progress":
                    progress_rows = rows
                ph = ", ".join("?" for _ in spec["cols"])
                conn.executemany(f"INSERT INTO {t} ({', '.join(spec['cols'])}) VALUES ({ph})",
                                 [tuple(r[c] for c in spec["cols"]) for r in conv])
                # keep AUTOINCREMENT counters beyond the highest copied id
                if "id" in spec["cols"]:
                    mx = conn.execute(f"SELECT max(id) FROM {t}").fetchone()[0]
                    if mx is not None:
                        conn.execute("DELETE FROM sqlite_sequence WHERE name = ?", (t,))
                        conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", (t, mx))
            conn.execute("COMMIT")

            # ---- verify: independent re-read of the tmp DB, plus a fresh read from Postgres
            ok = True
            report = []
            for t in tables:
                spec = TABLES[t]
                pg_fresh = canonical_hash(spec, [convert_row(spec, r) for r in pg_rows(cur, t, spec)])
                lite = canonical_hash(spec, sqlite_rows(conn, t, spec))
                same = pg_fresh == pg_hash[t] == lite
                ok &= same
                report.append((t, lite.split(":")[0], lite.split(":")[1], same))
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                ok = False
        finally:
            conn.close()
    finally:
        pg.rollback()
        pg.close()

    print("table                  rows  sha256                                                            match")
    for t, n, h, same in report:
        print(f"{t:<22} {n:>5}  {h}  {'yes' if same else 'NO'}")
    if not ok:
        print("VERIFICATION FAILED: nothing was moved to the destination.", file=sys.stderr)
        return 3

    if "progress" in tables:
        orphans = find_orphans(progress_rows, ROOT / "build" / "catalog.db")
        if orphans is None:
            print("orphans: build/catalog.db not found, skipped")
        else:
            print(f"orphan progress rows (not in catalog): {sum(orphans.values())} {dict(sorted(orphans.items()))}")

    for suffix in ("-wal", "-shm"):
        Path(str(tmp) + suffix).unlink(missing_ok=True)
    os.replace(tmp, out)
    print(f"written: {out}")

    if args.copy_stored_save:
        src = ROOT / "data" / "saves" / "SAVEDATA1000.copy"
        if not src.is_file():
            print(f"stored save not found: {src}", file=sys.stderr)
        else:
            dest_dir = Path(args.copy_stored_save)
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / src.name
            with open(src, "rb") as f_in, open(dest, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            same = hashlib.sha256(src.read_bytes()).hexdigest() == hashlib.sha256(dest.read_bytes()).hexdigest()
            print(f"stored save copied: {dest} sha256 match: {'yes' if same else 'NO'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg", required=True, help="postgresql://user:pass@host:port/db (read-only use)")
    ap.add_argument("--out", required=True, help="destination user.db (must not exist or be empty)")
    ap.add_argument("--with-build-cache", action="store_true", help="also copy build_recommendations")
    ap.add_argument("--copy-stored-save", metavar="DEST_DIR", help="copy data/saves/SAVEDATA1000.copy there")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
