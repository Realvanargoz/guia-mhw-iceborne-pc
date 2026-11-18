import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app import userdb  # noqa: E402

TABLES = {"progress", "calendar_periods", "calendar_settings", "profile_snapshots", "build_recommendations",
          "saved_builds", "user_meta"}


def _tables(p):
    c = sqlite3.connect(p)
    try:
        return {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    finally:
        c.close()


def _version(p):
    c = sqlite3.connect(p)
    try:
        return c.execute("PRAGMA user_version").fetchone()[0]
    finally:
        c.close()


def test_fresh_migrate_no_backup_and_idempotent(tmp_path):
    p = tmp_path / "user.db"
    assert userdb.migrate(p) == userdb.LATEST
    assert _tables(p) == TABLES
    assert not (tmp_path / "backups").exists()
    assert userdb.migrate(p) == userdb.LATEST
    assert not (tmp_path / "backups").exists()
    c = sqlite3.connect(p)
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    c.close()


def test_backup_before_migrating_existing_and_keep_last_3(tmp_path, monkeypatch):
    p = tmp_path / "user.db"
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE old(x)")
    c.execute("INSERT INTO old VALUES (42)")
    c.commit()
    c.close()
    assert userdb.migrate(p) == userdb.LATEST
    backups = list((tmp_path / "backups").glob("user-v0-*.db"))
    assert len(backups) == 1
    b = sqlite3.connect(backups[0])
    assert b.execute("SELECT x FROM old").fetchone()[0] == 42
    assert b.execute("PRAGMA user_version").fetchone()[0] == 0
    b.close()
    # simulate later migrations: each one backs up again, only the last 3 remain
    migs = list(userdb.MIGRATIONS)
    for n in range(4):
        migs = migs + [["CREATE TABLE IF NOT EXISTS m%d (a)" % n]]
        monkeypatch.setattr(userdb, "MIGRATIONS", migs)
        monkeypatch.setattr(userdb, "LATEST", len(migs))
        userdb.migrate(p)
    assert len(list((tmp_path / "backups").glob("user-v*.db"))) == 3
    assert _version(p) == len(migs)


def test_failed_migration_rolls_back(tmp_path, monkeypatch):
    p = tmp_path / "user.db"
    monkeypatch.setattr(userdb, "MIGRATIONS", [["CREATE TABLE a(x)", "THIS IS NOT SQL"]])
    monkeypatch.setattr(userdb, "LATEST", 1)
    with pytest.raises(sqlite3.Error):
        userdb.migrate(p)
    assert _tables(p) == set()
    assert _version(p) == 0
