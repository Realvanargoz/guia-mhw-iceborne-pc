"""Smoke tests de la API de builds (api/app/builds.py) con TestClient.

Cubre: evaluate, rules, monster/{id}, goal/recoleccion, CRUD de saved builds y 403 en escrituras sin cabecera.
La base de usuario es un user.db temporal (migrado) y el pool apunta al catalog.db del repo, en solo lectura.
Nunca toca data/user.db ni la instalacion del usuario.

Run: python -m pytest tests/test_builds_api.py -q
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
H = {"X-MHW-Client": "1"}
LARGE_MONSTER = 17  # Great Jagras (size large in catalog)

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import db, settings, userdb  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("builds_api") / "user.db"
    userdb.migrate(user)
    db.close_pool()  # a pool left open by another test module would win over our temp path
    db.open_pool(user, CATALOG)
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "SESSION_TOKEN", None)  # no launcher session in tests
    try:
        with TestClient(app, base_url="http://127.0.0.1") as c:
            yield c
    finally:
        mp.undo()
        db.close_pool()


def _payload(**kw):
    base = {"head": None, "chest": None, "arms": None, "waist": None, "legs": None, "charm": None,
            "decos": {}, "weapon": []}
    base.update(kw)
    return base


def test_evaluate_small_loadout(client):
    r = client.post("/api/builds/evaluate", headers=H,
                    json={"pieces": {"head": 1377, "chest": 1378}, "decorations": [100], "weapon_slots": [2]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pieces"]["head"]["id"] == 1377
    assert body["pieces"]["chest"]["id"] == 1378
    assert isinstance(body["skills"], list) and body["skills"]
    assert body["defense"]["max"] > 0
    assert "disclaimer_es" in body


def test_evaluate_without_header_is_403(client):
    r = client.post("/api/builds/evaluate", json={"pieces": {"head": 1377}})
    assert r.status_code == 403


def test_rules(client):
    r = client.get("/api/builds/rules")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rules_hash"]
    assert "disclaimer_es" in body


def test_monster_builds(client):
    r = client.get(f"/api/builds/monster/{LARGE_MONSTER}", params={"rank": "HR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["builds"], list)
    assert isinstance(body["notes"], list)
    assert body["owned_available"] is None


def test_monster_unknown_id_is_not_500(client):
    r = client.get("/api/builds/monster/999999")
    assert r.status_code < 500


def test_goal_recoleccion(client):
    r = client.get("/api/builds/goal/recoleccion", params={"rank": "MR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["goal"] == "recoleccion"
    assert isinstance(body["builds"], list)


def test_saved_builds_crud(client):
    r = client.post("/api/builds/saved", headers=H,
                    json={"name": "Zorah test", "payload": _payload(head=1377, chest=1378, charm=1,
                                                                  decos={"chest": [165, None]}, weapon=[2])})
    assert r.status_code == 201, r.text
    created = r.json()
    sid = created["id"]
    assert created["name"] == "Zorah test"

    rows = client.get("/api/builds/saved").json()
    assert any(row["id"] == sid for row in rows)

    r = client.put(f"/api/builds/saved/{sid}", headers=H, json={"name": "Renombrado"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renombrado"
    assert r.json()["payload"]["head"] == 1377  # payload kept when only the name changes

    r = client.put(f"/api/builds/saved/{sid}", headers=H, json={"payload": _payload(legs=1381)})
    assert r.status_code == 200, r.text
    assert r.json()["payload"]["legs"] == 1381

    r = client.delete(f"/api/builds/saved/{sid}", headers=H)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "id": sid}
    assert client.delete(f"/api/builds/saved/{sid}", headers=H).status_code == 404


def test_saved_writes_without_header_are_403(client):
    body = {"name": "sin cabecera", "payload": _payload()}
    assert client.post("/api/builds/saved", json=body).status_code == 403
    assert client.put("/api/builds/saved/1", json={"name": "x"}).status_code == 403
    assert client.delete("/api/builds/saved/1").status_code == 403


def test_evaluate_targets_adds_coverage(client):
    body = {"pieces": {"head": 1377, "chest": 1378}, "decorations": [], "weapon_slots": []}
    plain = client.post("/api/builds/evaluate", headers=H, json=body).json()
    assert "coverage" not in plain
    sid = next(s["skill_id"] for s in plain["skills"])
    r = client.post("/api/builds/evaluate", headers=H, json={**body, "targets": [{"skill_id": sid, "level": 5, "tier": 1}]})
    assert r.status_code == 200, r.text
    out = r.json()
    cov = out.pop("coverage")
    assert len(cov) == 1 and cov[0]["skill_id"] == sid and cov[0]["target"] == 5
    assert cov[0]["status"] in ("ok", "parcial", "falta")
    assert out == plain  # el resto de la salida no cambia


def test_evaluate_targets_validation(client):
    r = client.post("/api/builds/evaluate", headers=H, json={"pieces": {}, "targets": [{"skill_id": 999999, "level": 1, "tier": 1}]})
    assert r.status_code == 422
    r = client.post("/api/builds/evaluate", headers=H, json={"pieces": {}, "targets": [{"skill_id": 1, "level": 1, "tier": 1}] * 21})
    assert r.status_code == 422
