"""User database (user.db): DDL + ordered migrations driven by PRAGMA user_version.

Before migrating an existing, non-empty DB a consistent copy is written with the sqlite backup API to
``<db dir>/backups/user-v<old>-<timestamp>.db`` (the last 3 are kept).
NOTE: the generic key/value table is ``user_meta`` (not ``meta``) because catalog.db already has a
``meta`` table and unqualified names resolve in ``main`` (user.db) first.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from . import settings

KEEP_BACKUPS = 3

def _add_column(table: str, name: str, decl: str) -> Callable[[sqlite3.Connection], None]:
    """Idempotent ``ALTER TABLE ... ADD COLUMN`` (skips when the column already exists; e.g. a half-applied dev DB)."""
    def run(conn: sqlite3.Connection) -> None:
        if name not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    return run


# MIGRATIONS[i] upgrades user_version i -> i+1. Never edit a released entry; append a new one.
MIGRATIONS: list[list[str | Callable[[sqlite3.Connection], None]]] = [
    [
        """CREATE TABLE IF NOT EXISTS progress (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT 1, notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (entity_type, entity_id))""",
        """CREATE TABLE IF NOT EXISTS calendar_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, festival_slug TEXT, title TEXT,
  start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL, CHECK (end_at > start_at))""",
        """CREATE TABLE IF NOT EXISTS calendar_settings (
  key TEXT PRIMARY KEY, value JSON NOT NULL, updated_at TIMESTAMPTZ NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS profile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, taken_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('steam-local', 'upload')),
  sha256 TEXT NOT NULL, slot INTEGER, data JSON NOT NULL)""",
        """CREATE TABLE IF NOT EXISTS build_recommendations (
  monster_id INTEGER NOT NULL, rank TEXT NOT NULL, cap TEXT NOT NULL,
  rules_hash TEXT NOT NULL, data_sig TEXT NOT NULL, data JSON NOT NULL,
  built_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (monster_id, rank, cap))""",
        """CREATE TABLE IF NOT EXISTS saved_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, payload JSON NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)""",
        "CREATE TABLE IF NOT EXISTS user_meta (key TEXT PRIMARY KEY, value TEXT)",
    ],
    # v1 -> v2: phased builder (versions per saved build + plan on the build itself)
    [
        """CREATE TABLE IF NOT EXISTS build_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id INTEGER NOT NULL REFERENCES saved_builds(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, label TEXT NOT NULL, payload JSON NOT NULL, plan JSON, tests JSON,
  parent_id INTEGER REFERENCES build_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (build_id, seq), UNIQUE (build_id, label))""",
        "CREATE INDEX IF NOT EXISTS build_versions_build ON build_versions (build_id, seq)",
        _add_column("saved_builds", "plan", "JSON"),
        _add_column("saved_builds", "current_version_id", "INTEGER"),
    ],
]
LATEST = len(MIGRATIONS)


def _is_empty(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT count(*) FROM sqlite_master").fetchone()[0] == 0


def backup(conn: sqlite3.Connection, db_path: Path, old_version: int) -> Path:
    bdir = db_path.parent / "backups"
    bdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    dest = bdir / f"user-v{old_version}-{stamp}.db"
    out = sqlite3.connect(dest)
    try:
        conn.backup(out)
    finally:
        out.close()
    for old in sorted(bdir.glob("user-v*.db"), key=lambda p: (p.stat().st_mtime_ns, p.name))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)
    return dest


def migrate(db_path: Path | str | None = None) -> int:
    """Bring user.db to the latest schema (idempotent). Returns the resulting user_version."""
    path = Path(db_path) if db_path else Path(settings.USER_DB)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        cur = conn.execute("PRAGMA user_version").fetchone()[0]
        if cur > LATEST:
            raise RuntimeError(
                f"La base de datos de usuario (user.db) es de una versión más nueva (v{cur}) que la que soporta esta app "
                f"(v{LATEST}). Actualiza la app; no se ha modificado nada. (user.db is version {cur}, newer than supported {LATEST})")
        if cur == LATEST:
            return cur
        if not _is_empty(conn):
            backup(conn, path, cur)
        for v in range(cur, LATEST):
            conn.execute("BEGIN IMMEDIATE")
            try:
                if conn.execute("PRAGMA user_version").fetchone()[0] != v:  # another process got there first
                    conn.execute("ROLLBACK")
                    continue
                for stmt in MIGRATIONS[v]:
                    stmt(conn) if callable(stmt) else conn.execute(stmt)
                conn.execute(f"PRAGMA user_version = {v + 1}")
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()
