"""Tests de la cantina (api/app/canteen.py) con TestClient.

Cubre: los casos compartidos research/canteen/sim_cases.json contra POST /api/canteen/simulate (los mismos que usa
tools/canteen-engine-check.mjs con el motor de la UI), el catálogo GET /api/canteen (ramas, recetas, desbloqueo en
español y claves antiguas) y que cada receta, montada con ingredientes reales, active exactamente sus habilidades.
La base de usuario es un user.db temporal y el pool apunta al catalog.db del repo, en solo lectura
(MHW_TEST_CATALOG permite usar otro catalog.db, p. ej. uno recién generado fuera de build/).

Run: python -m pytest tests/test_canteen.py -q
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = Path(os.environ.get("MHW_TEST_CATALOG") or ROOT / "build" / "catalog.db")
CASES = json.loads((ROOT / "research" / "canteen" / "sim_cases.json").read_text(encoding="utf-8"))["cases"]


def _has_recipes(path: Path) -> bool:
    if not path.is_file():
        return False
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        return con.execute("SELECT 1 FROM sqlite_master WHERE name = 'canteen_recipes'").fetchone() is not None
    finally:
        con.close()


pytestmark = pytest.mark.skipif(not _has_recipes(CATALOG), reason="catalog.db missing or without canteen_recipes")

from app import db, settings, userdb  # noqa: E402

LEVEL = {None: 0, "S": 1, "M": 2, "L": 3}
H = {"X-MHW-Client": "1"}  # the API demands it on every write (CSRF guard)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("canteen") / "user.db"
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


@pytest.fixture(scope="module")
def catalog(client):
    r = client.get("/api/canteen")
    assert r.status_code == 200, r.text
    return r.json()


def _summary(body: dict) -> dict:
    return {
        "active_skill_ids": [s["id"] for s in body["ingredient_skills"]],
        "superseded_skill_ids": [s["id"] for t in body["by_type"] for s in t["skills"] if s["superseded"]],
        "stat_levels": {b["stat"]: LEVEL[b["level"]] for b in body["stat_buffs"]},
        "stars": body["activation"]["stars"],
        "free_skill_slots": body["daily"]["free_skill_slots"],
    }


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_shared_case(client, case):
    r = client.post("/api/canteen/simulate", headers=H, json=case["input"])
    if case.get("expect_error"):
        assert r.status_code == 422, r.text
        return
    assert r.status_code == 200, r.text
    got, exp = _summary(r.json()), case["expect"]
    assert sorted(got["active_skill_ids"]) == sorted(exp["active_skill_ids"])
    assert sorted(got["superseded_skill_ids"]) == sorted(exp["superseded_skill_ids"])
    assert got["stat_levels"] == exp["stat_levels"]
    assert got["stars"] == exp["stars"]
    assert got["free_skill_slots"] == exp["free_skill_slots"]


def test_skill_states_and_notes(client):
    case = next(c for c in CASES if c["id"] == "six_artillery_meat")
    body = client.post("/api/canteen/simulate", headers=H, json=case["input"]).json()
    (row,) = body["by_type"]
    assert row["tier_reached"] == 3
    for s in row["skills"]:
        assert s["unlocked"] == s["active"]
        assert [s["active"], s["superseded"], s["locked"]].count(True) == 1
    notes = " ".join(body["notes_es"])
    assert "solo su nivel más alto" in notes
    assert "Mezclas" not in notes and "más de 3" not in notes
    for key in ("input", "by_type", "ingredient_skills", "daily", "activation", "probabilities", "stat_buffs",
                "health", "palico", "notes_es", "needs_review"):
        assert key in body


def test_repeated_daily_is_rejected(client):
    body = {"ingredients": ["ing_wyvern_thigh"], "daily_skill_ids": ["fs_felyne_temper", "fs_felyne_temper"]}
    r = client.post("/api/canteen/simulate", headers=H, json=body)
    assert r.status_code == 422, r.text


def test_duplicate_by_name_is_rejected(client):
    r = client.post("/api/canteen/simulate", headers=H, json={"ingredients": ["ing_wyvern_thigh", "Wyvern Thigh"]})
    assert r.status_code == 422, r.text


def test_catalog_shape(catalog):
    for key in ("ingredients", "skills", "skill_types", "rules", "meta", "branches", "recipes"):
        assert key in catalog
    assert {"ingredient", "daily"} <= set(catalog["skills"])
    assert len(catalog["branches"]) == 9
    assert {b["group"] for b in catalog["branches"]} == {"food", "drink"}
    assert all(isinstance(b["skill_ids"], list) and len(b["skill_ids"]) == 3 for b in catalog["branches"])
    recipes = catalog["recipes"]
    assert len(recipes) == 19
    assert [r["sort_order"] for r in recipes] == sorted(r["sort_order"] for r in recipes)
    assert all(isinstance(r["composition"], list) and r["composition"] for r in recipes)
    ings = catalog["ingredients"]
    assert len(ings) == 114
    assert all(i["unlock_es"] for i in ings)
    assert all({"unlock_type", "doc_id"} <= set(i) for i in ings)
    assert all("synergy_es" in s for s in catalog["skills"]["ingredient"] + catalog["skills"]["daily"])


def test_recipes_activate_their_targets(client, catalog):
    pool: dict = {}
    for i in catalog["ingredients"]:
        pool.setdefault((i["category"], i["skill_type"]), []).append(i["id"])
    for rec in catalog["recipes"]:
        plate = []
        for part in rec["composition"]:
            avail = [x for x in pool.get((part["category"], part["branch"]), []) if x not in plate]
            assert len(avail) >= part["count"], (rec["id"], part)
            plate += avail[:part["count"]]
        r = client.post("/api/canteen/simulate", headers=H, json={"ingredients": plate, "slots": 6})
        assert r.status_code == 200, (rec["id"], r.text)
        active = {s["id"] for s in r.json()["ingredient_skills"]}
        assert active == set(rec["target_skill_ids"]), rec["id"]
