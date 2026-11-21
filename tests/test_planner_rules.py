"""Tests de research/builds/planner_rules.json y de GET /api/builds/plan/{rules,template}.

Run: python -m pytest tests/test_planner_rules.py -q
"""
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
RULES = ROOT / "research" / "builds" / "planner_rules.json"

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import db, settings, userdb  # noqa: E402

WEAPONS = {"great-sword", "long-sword", "sword-and-shield", "dual-blades", "hammer", "hunting-horn", "lance", "gunlance",
           "switch-axe", "charge-blade", "insect-glaive", "light-bowgun", "heavy-bowgun", "bow"}


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("planner_rules") / "user.db"
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


def _rules():
    return json.loads(RULES.read_text(encoding="utf-8"))


def test_names_resolve_in_catalog():
    cat = sqlite3.connect(f"file:{CATALOG.as_posix()}?mode=ro", uri=True)
    skills = {r[0]: r[1] for r in cat.execute("SELECT name_en, max_level FROM skills")}
    bonuses = {r[0] for r in cat.execute("SELECT name_en FROM armor_set_bonuses")}
    r = _rules()
    assert set(r["weapon_types"]) == WEAPONS
    entries = []
    for aid, a in r["archetypes"].items():
        entries += [(aid, e) for e in a["skills"] + a.get("discard", [])]
        assert a["needs_review"] is True
        assert a["weapon_types"] == "*" or set(a["weapon_types"]) <= WEAPONS
        for b in a.get("requires_bonus_any", []):
            assert b in bonuses, b
    for sid, s in r["play_styles"].items():
        entries += [(sid, e) for e in s["add"]]
    for ctx, e in entries:
        assert e["skill"] in skills, (ctx, e["skill"])
        if "level" in e:
            assert 1 <= e["level"] <= skills[e["skill"]], (ctx, e)
            assert e["tier"] in (1, 2, 3)
    for t, w in r["weapon_types"].items():
        assert set(w["archetypes"]) <= set(r["archetypes"])


def test_cb_impact_rules():
    cb = _rules()["archetypes"]["cb_impact"]
    art = next(s for s in cb["skills"] if s["skill"] == "Artillery")
    assert art["level"] == 5 and art["tier"] == 1
    assert "Critical Boost" in {d["skill"] for d in cb["discard"]}
    assert "ozzSBPNg5aw" in json.dumps(cb["sources"])


def test_rules_endpoint(client):
    r = client.get("/api/builds/plan/rules")
    assert r.status_code == 200
    body = r.json()
    cb = body["archetypes"]["cb_impact"]
    assert all(isinstance(s["skill_id"], int) for s in cb["skills"])
    assert cb["requires_bonus_any"] and all("bonus_id" in b for b in cb["requires_bonus_any"])


def test_template_monster(client):
    r = client.get("/api/builds/plan/template", params={"monster": 17, "rank": "HR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["objective"]["type"] == "monster"
    assert body["targets"] and {t["tier"] for t in body["targets"]} <= {1, 2, 3}
    assert all(t["origin"] and t["level"] >= 1 for t in body["targets"])


def test_template_goal(client):
    r = client.get("/api/builds/plan/template", params={"goal": "recoleccion", "rank": "MR"})
    assert r.status_code == 200, r.text
    assert r.json()["targets"]


def test_template_archetype_and_styles(client):
    r = client.get("/api/builds/plan/template", params={"archetype": "cb_impact", "styles": "bloqueo"})
    assert r.status_code == 200, r.text
    body = r.json()
    t = {x["name_es"]: x for x in body["targets"]}
    assert any(x["level"] == 5 and x["tier"] == 1 for x in body["targets"])
    assert body["set_bonus_suggestion"] and body["set_bonus_suggestion"]["bonus_ids"]
    assert "Critical Boost" in {d["name_es"] for d in body["discard_hints"]} or body["discard_hints"]
    assert t


def test_template_bad_input(client):
    for params in ({"archetype": "nope"}, {"styles": "bloqueo,zzz"}, {"archetype": "x'<script>"}, {"monster": 17, "goal": "botin"}, {}):
        r = client.get("/api/builds/plan/template", params=params)
        assert r.status_code == 422, params
        for v in params.values():
            if isinstance(v, str):
                assert v not in r.text
