"""Unit tests for scripts/migrate_pg_to_userdb.py helpers (no Postgres, no network)."""
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
_spec = importlib.util.spec_from_file_location("migrate_pg_to_userdb", ROOT / "scripts" / "migrate_pg_to_userdb.py")
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_timestamptz_fixed_width_utc():
    plus2 = timezone(timedelta(hours=2))
    assert mig.to_utc_iso(datetime(2024, 5, 1, 12, 0, 0, tzinfo=plus2)) == "2024-05-01T10:00:00.000000Z"
    assert mig.to_utc_iso(datetime(2024, 5, 1, 12, 0, 0, 5)) == "2024-05-01T12:00:00.000005Z"  # naive = UTC
    assert mig.to_utc_iso("2024-05-01T10:00:00Z") == "2024-05-01T10:00:00.000000Z"
    assert mig.to_utc_iso(None) is None


def test_json_and_bool():
    assert mig.to_json_text({"a": "ñ", "b": [1]}) == '{"a": "ñ", "b": [1]}'
    assert mig.to_json_text('{"x": 1}') == '{"x": 1}'
    assert mig.to_json_text(None) == "null"
    assert (mig.to_bool_int(True), mig.to_bool_int(False), mig.to_bool_int(None)) == (1, 0, None)


def test_roundtrip_hash_through_real_schema(tmp_path):
    from app import userdb
    db = tmp_path / "u.db"
    userdb.migrate(db)
    spec = mig.TABLES["progress"]
    pg_rows = [
        {"entity_type": "item", "entity_id": "10", "done": True, "notes": "x",
         "updated_at": datetime(2024, 1, 2, 3, 4, 5, 6, tzinfo=timezone(timedelta(hours=-3)))},
        {"entity_type": "armor_set", "entity_id": "2", "done": False, "notes": None,
         "updated_at": datetime(2024, 1, 2, tzinfo=timezone.utc)},
    ]
    conv = [mig.convert_row(spec, r) for r in pg_rows]
    conn = sqlite3.connect(db)
    conn.executemany("INSERT INTO progress VALUES (?,?,?,?,?)", [tuple(r[c] for c in spec["cols"]) for r in conv])
    conn.commit()
    got = mig.sqlite_rows(conn, "progress", spec)
    assert mig.canonical_hash(spec, got) == mig.canonical_hash(spec, conv)
    # order independent, content sensitive
    assert mig.canonical_hash(spec, list(reversed(conv))) == mig.canonical_hash(spec, conv)
    changed = [dict(conv[0], notes="y"), conv[1]]
    assert mig.canonical_hash(spec, changed) != mig.canonical_hash(spec, conv)
    conn.close()


def test_json_hash_ignores_key_order_and_decimal():
    spec = mig.TABLES["calendar_settings"]
    a = [{"key": "k", "value": '{"a":1,"b":2}', "updated_at": "t"}]
    b = [{"key": "k", "value": '{"b": 2, "a": 1}', "updated_at": "t"}]
    assert mig.canonical_hash(spec, a) == mig.canonical_hash(spec, b)
    assert mig._canon_value(Decimal("3")) == 3


def test_refuses_non_empty_out(tmp_path, capsys):
    out = tmp_path / "user.db"
    out.write_bytes(b"x")
    rc = mig.main(["--pg", "postgresql://invalid/none", "--out", str(out)])
    assert rc == 2 and out.read_bytes() == b"x"
