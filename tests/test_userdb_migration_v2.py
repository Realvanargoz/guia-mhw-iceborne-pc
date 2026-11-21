"""user.db v1 -> v2 (build_versions, saved_builds.plan/current_version_id) keeps data and writes a backup."""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from app import userdb  # noqa: E402


def test_v1_to_v2_keeps_rows_and_backs_up(tmp_path):
    p = tmp_path / "user.db"
    c = sqlite3.connect(p, isolation_level=None)
    c.execute("BEGIN")
    for stmt in userdb.MIGRATIONS[0]:
        c.execute(stmt)
    c.execute("PRAGMA user_version = 1")
    c.execute("INSERT INTO saved_builds (name, payload, created_at, updated_at) VALUES "
              "('A', '{\"head\": 1}', '2026-01-01T00:00:00.000000Z', '2026-01-01T00:00:00.000000Z')")
    c.execute("COMMIT")
    c.close()

    assert userdb.migrate(p) == 2
    c = sqlite3.connect(p)
    assert c.execute("SELECT name, payload, plan, current_version_id FROM saved_builds").fetchall() == [
        ("A", '{"head": 1}', None, None)]
    assert c.execute("SELECT count(*) FROM build_versions").fetchone()[0] == 0
    assert c.execute("PRAGMA user_version").fetchone()[0] == 2
    c.close()

    backups = list((tmp_path / "backups").glob("user-v1-*.db"))
    assert len(backups) == 1
    b = sqlite3.connect(backups[0])
    assert b.execute("SELECT name FROM saved_builds").fetchall() == [("A",)]
    assert b.execute("PRAGMA user_version").fetchone()[0] == 1
    assert b.execute("SELECT name FROM sqlite_master WHERE name='build_versions'").fetchone() is None
    b.close()
