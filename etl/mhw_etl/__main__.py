"""CLI: python -m mhw_etl [fetch|load|all|check] [--refresh] [--out build/catalog.db]"""
import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .fetch import fetch_all
from .load_base import load_base
from .load_research import load_research
from .util import norm_lower, read_csv

POST_LOAD_MARK = "-- @@POST_LOAD@@"
SCHEMA_SQL = Path(__file__).with_name("schema_sqlite.sql")

# Source row counts that must land in the database 1:1.
EXPECTED = {
    "items": ("items/item_base.csv", None),
    "monsters": ("monsters/monster_base.csv", None),
    "armor": ("armors/armor_base.csv", None),
    "armor_sets": ("armors/armorset_base.csv", None),
    "weapons": ("weapons/weapon_base.csv", None),
    "decorations": ("decorations/decoration_base.csv", None),
    "charms": ("charms/charm_base.csv", None),
    "skills": ("skills/skill_base.csv", None),
    "quests": ("quests/quest_base.csv", None),
    "monster_rewards": ("monsters/monster_rewards.csv", None),
    "quest_rewards": ("quests/quest_rewards.csv", None),
    "location_items": ("locations/location_items.csv", "mhworlddata"),
}


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.create_function("norm_lower", 1, norm_lower, deterministic=True)
    return conn


def cmd_load(out: Path) -> int:
    t0 = time.time()
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    for f in (tmp, tmp.with_name(tmp.name + "-journal")):
        f.unlink(missing_ok=True)
    conn = _connect(tmp)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        pre, post = SCHEMA_SQL.read_text(encoding="utf-8").split(POST_LOAD_MARK)
        conn.executescript(pre)
        cur = conn.cursor()
        ctx = load_base(cur)
        research = load_research(ctx)
        seqs: dict[str, int] = {}
        for tbl, id_ in ctx.order:
            seqs[tbl] = seqs.get(tbl, 0) + 1
            cur.execute("INSERT INTO _load_order (tbl, seq, id) VALUES (?, ?, ?)", (tbl, seqs[tbl], id_))
        conn.executescript(post.split("\n", 1)[1])  # search_index table (CREATE TABLE ... AS over the loaded data)
        cur.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", [
            ("catalog_version", str(config.CATALOG_VERSION)),
            ("source_sha", config.MHWORLDDATA_SHA),
            ("source_repo", "gatheringhallstudios/MHWorldData"),
            ("built_at", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")),
        ])
        conn.commit()
        conn.execute(f"PRAGMA user_version = {int(config.CATALOG_VERSION)}")
        conn.execute("ANALYZE")
        conn.commit()
        conn.execute("VACUUM")
        conn.execute("PRAGMA journal_mode = DELETE")
    finally:
        conn.close()
    os.replace(tmp, out)
    report = config.REPORTS_DIR / "unresolved.json"
    ctx.misses.write(report)
    print("[load] rows:", json.dumps(dict(ctx.counts), indent=None))
    print("[load] research:", research)
    print(f"[load] unresolved references: {ctx.misses.total()} (see {report})")
    print(f"[load] wrote {out} ({out.stat().st_size / 1e6:.1f} MB) in {time.time() - t0:.1f}s")
    return cmd_check(out)


def cmd_check(out: Path) -> int:
    failures = []
    conn = _connect(Path(out))
    cur = conn.cursor()
    for table, (rel, source) in EXPECTED.items():
        expected = len(read_csv(rel))
        if source:
            cur.execute(f"SELECT count(*) FROM {table} WHERE source = ?", (source,))
        else:
            cur.execute(f"SELECT count(*) FROM {table}")
        got = cur.fetchone()[0]
        status = "ok" if got == expected else "MISMATCH"
        if got != expected:
            failures.append(table)
        print(f"[check] {table:<16} {got:>6} / {expected:<6} {status}")
    for label, sql in [
        ("items with name_es", "SELECT count(CASE WHEN name_es IS NOT NULL THEN 1 END), count(*) FROM items"),
        ("monsters with habitat", "SELECT count(DISTINCT h.monster_id), (SELECT count(*) FROM monsters WHERE size='large') FROM monster_habitats h"),
        ("layered armor", "SELECT count(*), count(CASE WHEN needs_review THEN 1 END) FROM layered_armor"),
        ("achievements", "SELECT count(*), count(CASE WHEN needs_review THEN 1 END) FROM achievements"),
        ("guides", "SELECT count(*), count(CASE WHEN needs_review THEN 1 END) FROM guides"),
    ]:
        cur.execute(sql)
        a, b = cur.fetchone()
        print(f"[check] {label:<24} {a} / {b}")
    uv = cur.execute("PRAGMA user_version").fetchone()[0]
    meta = dict(cur.execute("SELECT key, value FROM meta").fetchall())
    print(f"[check] user_version={uv} meta={meta}")
    conn.close()
    if failures:
        print("[check] FAILED:", failures)
        return 1
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="mhw_etl")
    p.add_argument("command", choices=["fetch", "load", "all", "check"])
    p.add_argument("--refresh", action="store_true", help="re-download raw data")
    p.add_argument("--out", type=Path, default=config.DEFAULT_OUT, help="SQLite catalog path")
    a = p.parse_args(argv)
    if a.command in ("fetch", "all"):
        fetch_all(a.refresh)
    if a.command in ("load", "all"):
        return cmd_load(a.out)
    if a.command == "check":
        return cmd_check(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
