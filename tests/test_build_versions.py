"""Versiones de builds guardados + borrador del planificador (api/app/planner_store.py). user.db temporal."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
H = {"X-MHW-Client": "1"}

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import db, settings, userdb  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("build_versions") / "user.db"
    userdb.migrate(user)
    db.close_pool()
    db.open_pool(user, CATALOG)
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "SESSION_TOKEN", None)
    try:
        with TestClient(app, base_url="http://127.0.0.1") as c:
            yield c
    finally:
        mp.undo()
        db.close_pool()


def _pl(**kw):
    base = {"head": None, "chest": None, "arms": None, "waist": None, "legs": None, "charm": None,
            "decos": {}, "weapon": []}
    base.update(kw)
    return base


def _build(client, name="B", **extra):
    r = client.post("/api/builds/saved", headers=H, json={"name": name, "payload": _pl(), **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _ver(client, sid, **kw):
    pl = kw.pop("pl", {})
    return client.post(f"/api/builds/saved/{sid}/versions", headers=H, json={"payload": _pl(**pl), **kw})


def _me(client, sid):
    return next(r for r in client.get("/api/builds/saved").json() if r["id"] == sid)


PLAN = {"objective": {"weapon_type": "bow", "styles": ["bloqueo"], "rank": "MR", "notes": "hola"},
        "targets": [{"skill_id": 1, "level": 3, "tier": 1}], "mode": "owned"}
TEST = {"monster_id": 17, "tier": "normal", "checklist": {"comodidad": "bien"}, "gaps": ["ritmo"],
        "minutes": 10, "carts": 0, "notes": "ok", "verdict": "lista"}


def test_old_build_without_plan_still_works(client):
    sid = _build(client)
    me = _me(client, sid)
    assert me["plan"] is None and me["current_version_id"] is None and me["version_count"] == 0
    r = client.put(f"/api/builds/saved/{sid}", headers=H, json={"name": "N"})
    assert r.status_code == 200 and r.json()["plan"] is None
    r = client.put(f"/api/builds/saved/{sid}", headers=H, json={"plan": PLAN})
    assert r.status_code == 200 and r.json()["plan"]["objective"]["weapon_type"] == "bow"
    assert client.get(f"/api/builds/saved/{sid}/versions").json() == []


def test_create_with_plan(client):
    sid = _build(client, plan=PLAN)
    assert _me(client, sid)["plan"]["mode"] == "owned"


def test_auto_labels_and_current_version(client):
    sid = _build(client)
    v1 = _ver(client, sid, plan=PLAN, pl={"head": 5})
    assert v1.status_code == 201, v1.text
    assert v1.json()["label"] == "v1.0" and v1.json()["seq"] == 1
    v2 = _ver(client, sid, pl={"head": 6}).json()
    assert v2["label"] == "v1.1"
    v3 = _ver(client, sid, major=True, parent_id=v2["id"]).json()
    assert v3["label"] == "v2.0" and v3["parent_id"] == v2["id"]
    assert _ver(client, sid, label="v7.3").json()["label"] == "v7.3"
    assert _ver(client, sid, label="v7.3").status_code == 409
    me = _me(client, sid)
    assert me["version_count"] == 4 and me["current_version_id"] is not None
    lst = client.get(f"/api/builds/saved/{sid}/versions").json()
    assert [v["label"] for v in lst] == ["v1.0", "v1.1", "v2.0", "v7.3"] and "payload" not in lst[0]
    full = client.get(f"/api/builds/saved/{sid}/versions/{v1.json()['id']}").json()
    assert full["payload"]["head"] == 5 and full["plan"]["mode"] == "owned"


def test_put_label_tests_and_payload_immutable(client):
    sid = _build(client)
    v = _ver(client, sid).json()
    url = f"/api/builds/saved/{sid}/versions/{v['id']}"
    r = client.put(url, headers=H, json={"label": "v3.2", "tests": [TEST]})
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "v3.2" and r.json()["tests"][0]["verdict"] == "lista"
    assert client.put(url, headers=H, json={"payload": _pl()}).status_code == 422
    assert client.put(url, headers=H, json={"tests": [TEST] * 11}).status_code == 422
    assert client.put(url, headers=H, json={}).status_code == 422


def test_restore_creates_new_version(client):
    sid = _build(client)
    a = _ver(client, sid, pl={"head": 9}, plan=PLAN).json()
    _ver(client, sid, pl={"head": 10})
    r = client.post(f"/api/builds/saved/{sid}/versions/{a['id']}/restore", headers=H)
    assert r.status_code == 201, r.text
    n = r.json()
    assert n["id"] != a["id"] and n["label"] == "v1.2" and n["payload"]["head"] == 9 and n["parent_id"] == a["id"]
    me = _me(client, sid)
    assert me["current_version_id"] == n["id"] and me["payload"]["head"] == 9 and me["version_count"] == 3


def test_delete_version_and_cascade(client):
    sid = _build(client)
    a = _ver(client, sid).json()
    b = _ver(client, sid).json()
    assert client.delete(f"/api/builds/saved/{sid}/versions/{b['id']}", headers=H).status_code == 200
    assert _me(client, sid)["current_version_id"] == a["id"]
    assert client.delete(f"/api/builds/saved/{sid}/versions/{b['id']}", headers=H).status_code == 404
    assert client.delete(f"/api/builds/saved/{sid}", headers=H).status_code == 200
    assert db.one("SELECT count(*) n FROM build_versions WHERE build_id = ?", (sid,))["n"] == 0
    assert client.get(f"/api/builds/saved/{sid}/versions").status_code == 404


def test_cap_50(client):
    sid = _build(client)
    for _ in range(50):
        assert _ver(client, sid).status_code == 201
    assert _ver(client, sid).status_code == 409


def test_validation(client):
    sid = _build(client)
    t1 = {"skill_id": 1, "level": 3, "tier": 1}
    for body in (
        {"payload": _pl(), "label": "1.0"}, {"payload": _pl(), "label": "v1.x"}, {"payload": _pl(), "label": "v1234.0"},
        {"payload": _pl(), "extra": 1}, {"payload": _pl(head=1, bad=2)},
        {"payload": _pl(), "plan": {"objective": {"notes": "a\x00b"}}},
        {"payload": _pl(), "plan": {"objective": {"weapon_type": "spoon"}}},
        {"payload": _pl(), "plan": {"objective": {"styles": ["bloqueo"] * 7}}},
        {"payload": _pl(), "plan": {"targets": [t1] * 21}},
        {"payload": _pl(), "plan": {"bogus": 1}},
        {"payload": _pl(), "tests": [dict(TEST, notes="x\x1b")]},
        {"payload": _pl(), "tests": [dict(TEST, minutes=0)]},
        {"payload": _pl(), "tests": [dict(TEST, carts=4)]},
        {"payload": _pl(), "tests": [dict(TEST, verdict="meh")]},
        {"payload": _pl(), "tests": [dict(TEST, bogus=1)]},
        {"payload": _pl(), "parent_id": 999999},
    ):
        r = client.post(f"/api/builds/saved/{sid}/versions", headers=H, json=body)
        assert r.status_code == 422, (body, r.text)
    r = client.post(f"/api/builds/saved/{sid}/versions", headers=H,
                    json={"payload": _pl(), "plan": {"objective": {"notes": "zq\x00zq"}}})
    assert r.status_code == 422 and "zq" not in r.text  # no echo of the input
    assert client.post("/api/builds/saved/999999/versions", headers=H, json={"payload": _pl()}).status_code == 404
    assert client.post(f"/api/builds/saved/{sid}/versions", json={"payload": _pl()}).status_code == 403


def test_size_cap_64kb(client):
    sid = _build(client)
    big = {"payload": _pl(head={"x": "a" * 70_000})}
    assert client.post(f"/api/builds/saved/{sid}/versions", headers=H, json=big).status_code == 413
    d = {"plan": {}, "loadout": _pl(head={"x": "a" * 70_000}), "step": "objetivo"}
    assert client.put("/api/builds/plan/draft", headers=H, json=d).status_code == 413


def test_draft_round_trip(client):
    assert client.get("/api/builds/plan/draft").json()["draft"] is None
    d = {"plan": PLAN, "loadout": _pl(head=3), "step": "armadura", "saved_id": 4}
    r = client.put("/api/builds/plan/draft", headers=H, json=d)
    assert r.status_code == 200, r.text
    got = client.get("/api/builds/plan/draft").json()
    assert got["draft"]["step"] == "armadura" and got["draft"]["loadout"]["head"] == 3 and got["updated_at"]
    assert client.put("/api/builds/plan/draft", headers=H, json={**d, "step": "x"}).status_code == 422
    assert client.put("/api/builds/plan/draft", headers=H, json={**d, "extra": 1}).status_code == 422
    assert client.put("/api/builds/plan/draft", json=d).status_code == 403
    assert client.delete("/api/builds/plan/draft", headers=H).status_code == 200
    assert client.get("/api/builds/plan/draft").json()["draft"] is None
