"""Tests de los listados de catálogo (api/app/catalog_lists.py) con TestClient.

Cubre: /api/skills (178 habilidades, secretas, bonos, joyas por rango), /api/set-bonuses (lista y detalle con
piezas por ranura), 404/422 y la cabecera slot_1.. de /api/weapons.
La base de usuario es un user.db temporal y el pool apunta al catalog.db del repo, en solo lectura.

Run: python -m pytest tests/test_catalog_lists.py -q
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import db, settings, userdb  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("catalog_lists") / "user.db"
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
def skills(client):
    r = client.get("/api/skills")
    assert r.status_code == 200, r.text
    return {s["id"]: s for s in r.json()}


def test_skills_count_and_shape(skills):
    assert len(skills) == 178
    s = skills[61]
    assert s["name_en"] == "Artillery"
    assert {"id", "name_es", "name_en", "icon_color", "max_level", "secret", "cap", "unlocks_skill_id",
            "unlocked_by", "set_bonus_only", "set_bonuses", "jewels", "charm_max_level", "armor_pieces"} <= set(s)
    assert "description_en" not in s and "description_es" not in s


def test_artillery_caps_and_secret_unlock(skills):
    s = skills[61]
    assert s["max_level"] == 5
    assert s["secret"] == 2
    # Spec: cap = max_level - secret (same formula as builds.py). That yields 3, not 5; see report.
    assert s["cap"] == s["max_level"] - s["secret"] == 3
    assert any(u["bonus_id"] == 50 and u["required"] == 3 and u["via"] == "secret" for u in s["unlocked_by"])
    secret_skill = skills[152]  # "Artillery Secret"
    assert secret_skill["unlocks_skill_id"] == 61
    assert secret_skill["set_bonus_only"] is True
    assert {"bonus_id": 50, "name_es": "Esencia Zorah Magdaros", "required": 3} in secret_skill["set_bonuses"]


def test_artillery_jewels_by_rank(client):
    mr = client.get("/api/skills", params={"rank": "MR"}).json()
    artillery = next(s for s in mr if s["id"] == 61)
    sizes = {j["size"] for j in artillery["jewels"]}
    assert {1, 4} <= sizes
    plus = [j for j in artillery["jewels"] if j["double"]]
    assert plus and all(j["size"] == 4 for j in plus)
    for j in artillery["jewels"]:
        assert j["min_rarity"] is not None and 5 <= j["min_rarity"] <= 12

    lr = client.get("/api/skills", params={"rank": "LR"}).json()
    assert all(s["jewels"] == [] for s in lr)

    hr = client.get("/api/skills", params={"rank": "HR"}).json()
    hr_artillery = next(s for s in hr if s["id"] == 61)
    assert all(5 <= j["min_rarity"] <= 8 for j in hr_artillery["jewels"])


def test_skills_rejects_unknown_rank(client):
    assert client.get("/api/skills", params={"rank": "XX"}).status_code == 422


def test_set_bonuses_list(client):
    r = client.get("/api/set-bonuses")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 69
    b50 = next(b for b in body if b["id"] == 50)
    assert {"id", "name_es", "name_en", "ranks", "sets"} <= set(b50)
    assert any(rk["skill_id"] == 152 and rk["unlocks_skill_id"] == 61 for rk in b50["ranks"])
    assert {s["id"] for s in b50["sets"]} == {305, 306}
    assert all({"id", "name_es", "rank", "rarity_max", "monster_id"} <= set(s) for s in b50["sets"])


def test_set_bonus_detail_pieces(client):
    r = client.get("/api/set-bonuses/50")
    assert r.status_code == 200, r.text
    body = r.json()
    pieces = body["pieces"]
    assert set(pieces) == {"head", "chest", "arms", "waist", "legs"}
    ids = {p["id"] for slot in pieces.values() for p in slot}
    assert {1377, 1378, 1380} <= ids
    head = next(p for p in pieces["head"] if p["id"] == 1377)
    assert {"id", "name_es", "rarity", "slots", "skills", "defense_max"} <= set(head)
    assert all(isinstance(v, int) for v in head["slots"])
    assert all({"skill_id", "name_es", "level"} <= set(sk) for sk in head["skills"])


def test_set_bonus_detail_rank_filter(client):
    r = client.get("/api/set-bonuses/50", params={"rank": "MR"})
    assert r.status_code == 200
    assert all(p["id"] for slot in r.json()["pieces"].values() for p in slot)
    assert client.get("/api/set-bonuses/50", params={"rank": "LR"}).status_code == 404


def test_set_bonus_detail_404_and_bounds(client):
    assert client.get("/api/set-bonuses/999999").status_code == 404
    assert client.get("/api/set-bonuses/0").status_code == 422


def test_weapons_rows_have_slots(client):
    r = client.get("/api/weapons", params={"limit": 20})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows and all({"slot_1", "slot_2", "slot_3"} <= set(w) for w in rows)


def test_fatalis_legend_rank_skill_names_not_null(client):
    # Bono 67 no tiene name_es en el catálogo: los nombres de habilidad deben caer a inglés, nunca None ni '?'.
    b67 = next(b for b in client.get("/api/set-bonuses").json() if b["id"] == 67)
    assert b67["name"] == "Fatalis Legend"
    assert b67["ranks"]
    for rk in b67["ranks"]:
        assert rk["skill_name"] and rk["skill_es"], rk
        assert "?" not in rk["skill_es"] and "?" not in rk["skill_name"], rk


def test_legiana_rank3_skill_desc(client):
    b34 = next(b for b in client.get("/api/set-bonuses").json() if b["id"] == 34)
    assert b34["name"]
    rk3 = next(rk for rk in b34["ranks"] if rk["required"] == 3)
    assert rk3["skill_id"] == 127
    assert "carga del arco" in rk3["skill_desc"]
    detail = client.get("/api/set-bonuses/34").json()
    assert detail["monster_id"] is not None
    assert "carga del arco" in next(rk for rk in detail["ranks"] if rk["required"] == 3)["skill_desc"]


def test_skills_rank_filters_set_bonuses(client):
    mr_ids = {b["id"] for b in client.get("/api/set-bonuses", params={"rank": "MR"}).json()}
    all_ids = {b["id"] for b in client.get("/api/set-bonuses").json()}
    assert 22 in all_ids and 22 not in mr_ids  # bono 22 solo tiene piezas HR

    great_luck = next(s for s in client.get("/api/skills", params={"rank": "MR"}).json() if s["id"] == 124)
    assert great_luck["name"] == "Recompensas extra"
    assert great_luck["set_bonuses"]
    for bonus in great_luck["set_bonuses"] + great_luck["unlocked_by"]:
        assert bonus["bonus_id"] in mr_ids, bonus
        assert bonus["name_es"]
    assert all(s["name"] and s["name_en"] for s in client.get("/api/skills", params={"rank": "MR"}).json())


def test_skill_61_has_description(skills):
    assert skills[61]["description"]
    assert "Artiller" in skills[61]["name"]
