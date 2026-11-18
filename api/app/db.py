"""SQLite data layer: user.db (main, read-write, WAL) + catalog.db attached read-only as ``mhw``.

Unqualified table names resolve in ``main`` (user.db) first, then in attached DBs, so catalog queries stay
unqualified. Rows are dicts. Params: tuple/list (``?``) or dict (``:name``). Lists are NOT auto-adapted to JSON:
wrap them with ``J()``.
"""
from __future__ import annotations

import json
import queue
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from . import settings

assert sqlite3.sqlite_version_info >= (3, 38), f"SQLite >= 3.38 required, found {sqlite3.sqlite_version}"

MAX_CONNECTIONS = 8


# ------------------------------------------------------------------ text normalisation
def _fallback_f_norm(text):
    import unicodedata
    if text is None:
        return None
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower()


def _f_norm_impl():
    try:
        from .textnorm import f_norm  # lazy: owned by another module
        return f_norm
    except ImportError:
        return _fallback_f_norm


# ------------------------------------------------------------------ converters / adapters
def J(obj) -> str:
    """Explicit JSON param (for JSON columns / json_each)."""
    return json.dumps(obj, ensure_ascii=False)


def now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _adapt_datetime(dt: datetime) -> str:
    return _utc(dt).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _convert_timestamptz(b: bytes) -> datetime:
    return _utc(datetime.fromisoformat(b.decode()))


sqlite3.register_adapter(datetime, _adapt_datetime)
sqlite3.register_adapter(dict, J)
sqlite3.register_converter("BOOLEAN", lambda b: bool(int(b)))
sqlite3.register_converter("JSON", lambda b: json.loads(b))
sqlite3.register_converter("TIMESTAMPTZ", _convert_timestamptz)


def _dict_row(cur: sqlite3.Cursor, row: tuple) -> dict:
    return {d[0]: v for d, v in zip(cur.description, row)}


# ------------------------------------------------------------------ connection wrapper
class Conn:
    """Thin wrapper around a sqlite3 connection with the module-level helpers."""

    def __init__(self, raw: sqlite3.Connection):
        self.raw = raw

    def all_(self, sql: str, params=()) -> list[dict]:
        cur = self.raw.execute(sql, params if params is not None else ())
        try:
            return cur.fetchall()
        finally:
            cur.close()

    def one(self, sql: str, params=()) -> dict | None:
        # fetchall + close so INSERT/UPDATE ... RETURNING runs to completion and releases the write lock.
        rows = self.all_(sql, params)
        return rows[0] if rows else None

    def one_or_404(self, sql: str, params=(), what: str = "recurso") -> dict:
        row = self.one(sql, params)
        if row is None:
            raise HTTPException(404, f"No se encontró el {what}")
        return row

    def execute(self, sql: str, params=()) -> int:
        """Run a statement, return rowcount."""
        cur = self.raw.execute(sql, params if params is not None else ())
        try:
            return cur.rowcount
        finally:
            cur.close()


def _open_raw(user_db: Path, catalog_db: Path | None, immutable: bool) -> sqlite3.Connection:
    Path(user_db).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(user_db), uri=True, check_same_thread=False, isolation_level=None,
                           detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES, timeout=10)
    conn.row_factory = _dict_row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    if catalog_db is not None:
        uri = Path(catalog_db).resolve().as_uri() + "?mode=ro" + ("&immutable=1" if immutable else "")
        conn.execute("ATTACH DATABASE ? AS mhw", (uri,))
    conn.create_function("f_norm", 1, _f_norm_impl(), deterministic=True)
    return conn


# ------------------------------------------------------------------ pool
class Pool:
    def __init__(self):
        self._lock = threading.Lock()
        self._idle: queue.LifoQueue = queue.LifoQueue()
        self._sem = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self._all: list[sqlite3.Connection] = []
        self._cfg: tuple | None = None

    def open(self, user_db=None, catalog_db=None, immutable=None, wait: bool = True) -> None:
        with self._lock:
            if self._cfg is not None:
                return
            cat = Path(catalog_db) if catalog_db else Path(settings.CATALOG_DB)
            if not cat.is_file():
                raise FileNotFoundError(f"catalog.db not found: {cat}")
            self._cfg = (Path(user_db) if user_db else Path(settings.USER_DB), cat,
                         settings.CATALOG_IMMUTABLE if immutable is None else immutable)
            self._idle = queue.LifoQueue()
            self._sem = threading.BoundedSemaphore(MAX_CONNECTIONS)
            self._all = []
        with self.connection():  # fail fast on bad config
            pass

    def close(self) -> None:
        with self._lock:
            conns, self._all, self._cfg = self._all, [], None
            self._idle = queue.LifoQueue()
        for c in conns:
            try:
                c.close()
            except sqlite3.Error:
                pass

    @contextmanager
    def connection(self):
        if self._cfg is None:
            self.open()
        if not self._sem.acquire(timeout=30):
            raise RuntimeError("sqlite pool exhausted")
        raw = None
        try:
            try:
                raw = self._idle.get_nowait()
            except queue.Empty:
                raw = _open_raw(*self._cfg)
                with self._lock:
                    self._all.append(raw)
            yield Conn(raw)
        finally:
            if raw is not None:
                if raw.in_transaction:
                    try:
                        raw.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                self._idle.put(raw)
            self._sem.release()


pool = Pool()


def open_pool(user_db=None, catalog_db=None, immutable=None) -> None:
    pool.open(user_db, catalog_db, immutable)


def close_pool() -> None:
    pool.close()


def init() -> int:
    """Run user.db migrations (call before open_pool in lifespan; uses settings.USER_DB or the open pool's path)."""
    from . import userdb
    return userdb.migrate(pool._cfg[0] if pool._cfg else settings.USER_DB)


def limit_threadpool(app_state_tokens: int = 8) -> None:
    import anyio.to_thread
    anyio.to_thread.current_default_thread_limiter().total_tokens = app_state_tokens


# ------------------------------------------------------------------ module-level helpers
def all_(sql: str, params=()) -> list[dict]:
    with pool.connection() as c:
        return c.all_(sql, params)


def one(sql: str, params=()) -> dict | None:
    with pool.connection() as c:
        return c.one(sql, params)


def one_or_404(sql: str, params=(), what: str = "recurso") -> dict:
    with pool.connection() as c:
        return c.one_or_404(sql, params, what)


def execute(sql: str, params=()) -> int:
    with pool.connection() as c:
        return c.execute(sql, params)


@contextmanager
def transaction():
    """BEGIN IMMEDIATE ... COMMIT (ROLLBACK on error); yields a Conn with the same helpers."""
    with pool.connection() as c:
        c.raw.execute("BEGIN IMMEDIATE")
        try:
            yield c
        except BaseException:
            c.raw.execute("ROLLBACK")
            raise
        else:
            c.raw.execute("COMMIT")
