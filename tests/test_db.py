import sqlite3
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"

from app import db, userdb  # noqa: E402

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")


@pytest.fixture()
def dbp(tmp_path):
    user = tmp_path / "user.db"
    userdb.migrate(user)
    db.open_pool(user, CATALOG)
    yield user
    db.close_pool()


def test_converters_adapters_roundtrip(dbp):
    t = datetime(2024, 5, 6, 7, 8, 9, 123, tzinfo=timezone(timedelta(hours=2)))
    db.execute("INSERT INTO progress(entity_type, entity_id, done, notes, updated_at) VALUES (?,?,?,?,?)",
               ("x", "1", False, None, t))
    r = db.one("SELECT * FROM progress WHERE entity_id='1'")
    assert r["done"] is False and r["notes"] is None
    assert r["updated_at"] == t and r["updated_at"].utcoffset() == timedelta(0)
    raw = sqlite3.connect(dbp).execute("SELECT updated_at FROM progress").fetchone()[0]
    assert raw == "2024-05-06T05:08:09.000123Z"
    naive = datetime(2024, 1, 1, 0, 0, 0)
    db.execute("INSERT INTO progress(entity_type, entity_id, updated_at) VALUES ('x','2',?)", (naive,))
    r = db.one("SELECT done, updated_at FROM progress WHERE entity_id='2'")
    assert r["done"] is True and r["updated_at"] == naive.replace(tzinfo=timezone.utc)
    # JSON: explicit J() for lists, dict adapted automatically
    for i, obj in enumerate([[{"a": "ñá"}, 1], {"k": [1, 2.5, None]}]):
        db.execute("INSERT INTO calendar_settings(key, value, updated_at) VALUES (?,?,?)",
                   (f"k{i}", db.J(obj) if isinstance(obj, list) else obj, db.now()))
        assert db.one("SELECT value FROM calendar_settings WHERE key=?", (f"k{i}",))["value"] == obj
    stored = sqlite3.connect(dbp).execute("SELECT value FROM calendar_settings WHERE key='k0'").fetchone()[0]
    assert "ñ" in stored  # ensure_ascii=False
    # named params; NUMERIC untouched
    assert db.one("SELECT :a + :b AS s", {"a": 1, "b": 2.5})["s"] == 3.5


def test_check_constraint_iso_text(dbp):
    n = db.now()
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO calendar_periods(kind,start_at,end_at,created_at) VALUES ('x',?,?,?)", (n, n, n))
    db.execute("INSERT INTO calendar_periods(kind,start_at,end_at,created_at) VALUES ('x',?,?,?)",
               (n, n + timedelta(seconds=1), n))


def test_one_or_404(dbp):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        db.one_or_404("SELECT * FROM progress WHERE 0", what="algo")
    assert e.value.status_code == 404


def test_catalog_readonly_and_declared_types(dbp):
    assert db.one("SELECT name FROM mhw.sqlite_master WHERE type='table' AND name='monsters'")
    with pytest.raises(sqlite3.OperationalError):
        db.execute("INSERT INTO mhw.meta(key, value) VALUES ('zz','zz')")
    with pytest.raises(sqlite3.OperationalError):
        db.execute("DELETE FROM monsters")
    row = db.one("SELECT * FROM festivals LIMIT 1")
    assert isinstance(row["needs_review"], bool) and isinstance(row["tickets"], (list, dict))
    assert db.one("SELECT count(*) AS n FROM monsters")["n"] > 0  # unqualified resolves to catalog


def test_non_immutable_attach(tmp_path):
    userdb.migrate(tmp_path / "u.db")
    db.open_pool(tmp_path / "u.db", CATALOG, immutable=False)
    try:
        assert db.one("SELECT count(*) AS n FROM monsters")["n"] > 0
        with pytest.raises(sqlite3.OperationalError):
            db.execute("DELETE FROM monsters")
    finally:
        db.close_pool()


def test_returning_releases_lock(dbp):
    sql = ("INSERT INTO calendar_settings(key, value, updated_at) VALUES (?,?,?) "
           "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at "
           "RETURNING key, value")
    r = db.one(sql, ("a", db.J([1]), db.now()))
    assert r["value"] == [1]
    other = sqlite3.connect(dbp, timeout=0.2)  # raises "database is locked" if the lock were still held
    other.execute("INSERT INTO user_meta(key, value) VALUES ('x','y')")
    other.commit()
    other.close()
    r = db.one(sql, ("a", db.J([2]), db.now()))
    assert r["value"] == [2]


def test_transaction_commit_rollback(dbp):
    with db.transaction() as tx:
        tx.execute("INSERT INTO user_meta(key,value) VALUES ('t','1')")
        assert tx.one("SELECT value FROM user_meta WHERE key='t'")["value"] == "1"
    with pytest.raises(RuntimeError):
        with db.transaction() as tx:
            tx.execute("INSERT INTO user_meta(key,value) VALUES ('t2','1')")
            raise RuntimeError
    assert db.one("SELECT 1 AS x FROM user_meta WHERE key='t2'") is None
    assert db.one("SELECT 1 AS x FROM user_meta WHERE key='t'")


def test_f_norm_registered(dbp):
    assert db.one("SELECT f_norm('Ñandú ÁÉ') AS v")["v"] == "nandu ae"
    assert db.one("SELECT f_norm(NULL) AS v")["v"] is None
    assert db.one("SELECT count(*) AS n FROM monsters WHERE f_norm(name_en) LIKE '%rathalos%'")["n"] >= 1


def test_concurrent_threads(dbp):
    errs = []

    def work(i):
        try:
            for j in range(40):
                db.execute("INSERT INTO progress(entity_type, entity_id, notes, updated_at) VALUES (?,?,?,?) "
                           "ON CONFLICT(entity_type, entity_id) DO UPDATE SET notes=excluded.notes",
                           ("t", f"{i}-{j % 10}", "n", db.now()))
                assert db.all_("SELECT * FROM monsters LIMIT 20")
                with db.transaction() as tx:
                    tx.execute("INSERT OR REPLACE INTO user_meta(key,value) VALUES (?,?)", (f"k{i}", str(j)))
        except BaseException as e:  # noqa: BLE001
            errs.append(e)

    ts = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs, errs
    assert db.one("SELECT count(*) AS n FROM progress")["n"] == 80
    assert len(db.pool._all) <= 8


def test_init_and_limit_threadpool(tmp_path):
    db.open_pool(tmp_path / "x" / "u.db", CATALOG)
    try:
        assert db.init() == userdb.LATEST

        import asyncio

        async def go():
            db.limit_threadpool(8)
            import anyio.to_thread
            return anyio.to_thread.current_default_thread_limiter().total_tokens
        assert asyncio.run(go()) == 8
    finally:
        db.close_pool()
