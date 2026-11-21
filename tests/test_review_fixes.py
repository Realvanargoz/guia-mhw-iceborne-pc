"""Review fixes: falta_joya, inheritance listing, plan_models leaf, EvalBody strict, row cap, migration, planner notes."""
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
H = {"X-MHW-Client": "1"}

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import builds, db, planner, settings, userdb  # noqa: E402


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("review") / "user.db"
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


# ---- P2-1 coverage reason from /evaluate
def _skill_needing(min_size_at_least):
    D = builds._load()
    for sid, s in D["skills"].items():
        sizes = [d["slot"] for d in D["decos"].values() if sid in d["skills"]]
        if sizes and min(sizes) >= min_size_at_least and sid not in planner._static(D)["bonus_only"] and (s["cap"] or 0) >= 1:
            return sid
    pytest.skip("no skill whose smallest jewel is that big")


def test_evaluate_coverage_falta_joya_vs_no_slot(client):
    sid = _skill_needing(2)
    D = builds._load()
    need = min(d["slot"] for d in D["decos"].values() if sid in d["skills"])
    t = [{"skill_id": sid, "level": 1, "tier": 1}]
    small = client.post("/api/builds/evaluate", headers=H, json={"weapon_slots": [need - 1], "targets": t}).json()
    assert small["coverage"][0]["reason"] == "no_slot"
    big = client.post("/api/builds/evaluate", headers=H, json={"weapon_slots": [min(4, need)], "targets": t}).json()
    assert big["coverage"][0]["reason"] == "falta_joya"


# ---- P2-2 inheritance
def test_inheritance_in_unlocked_by_and_set_bonus_ranks(client):
    skills = {s["id"]: s for s in client.get("/api/skills").json()}
    base = [s for s in skills.values() if s["secret"]]
    assert base
    for s in base:
        assert any(u["via"] == "inheritance" and u["required"] == 2 for u in s["unlocked_by"]), s["id"]
    inh = next(s for s in skills.values() if s["name_en"] == "Inheritance")
    assert all(u["via"] != "inheritance" for u in inh["unlocked_by"])
    bid = next(u["bonus_id"] for u in base[0]["unlocked_by"] if u["via"] == "inheritance")
    ranks = client.get(f"/api/set-bonuses/{bid}").json()["ranks"]
    assert any(r["unlocks_all"] and r["skill_id"] == inh["id"] for r in ranks)
    assert not any(r["unlocks_all"] for r in ranks if r["skill_id"] != inh["id"])


# ---- P2-3 leaf module
def test_plan_models_is_leaf():
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import app.plan_models as m; "
            "assert not any(k in sys.modules for k in ('app.builds','app.planner','app.planner_store')); "
            "assert m.WeaponSlots and m.PlanIn")
    subprocess.run([sys.executable, "-I", "-c", code, str(ROOT / "api")], check=True)
    from app import plan_models, planner_store
    assert planner.TargetIn is plan_models.TargetIn and planner_store.PlanIn is plan_models.PlanIn is builds.PlanIn


def test_weapon_slots_bounds(client):
    body = {"rank": "LR", "targets": [{"skill_id": 61, "level": 1, "tier": 1}], "weapon_slots": [1, 1, 1, 1]}
    assert client.post("/api/builds/plan/solve", headers=H, json=body).status_code == 422
    # EvalBody/SavedPayload keep accepting 4 for old saved builds
    assert client.post("/api/builds/evaluate", headers=H, json={"weapon_slots": [1, 1, 1, 1]}).status_code == 200


# ---- P3 EvalBody
def test_evalbody_forbids_extra_and_does_not_echo_skill(client):
    r = client.post("/api/builds/evaluate", headers=H, json={"pieces": {}, "bogus": 1})
    assert r.status_code == 422
    r = client.post("/api/builds/evaluate", headers=H,
                    json={"targets": [{"skill_id": 999999, "level": 1, "tier": 1}]})
    assert r.status_code == 422 and "999999" not in r.text
    # exact shape the frontend sends
    ok = client.post("/api/builds/evaluate", headers=H, json={
        "pieces": {"head": None, "chest": None, "arms": None, "waist": None, "legs": None, "charm": None},
        "decorations": [{"id": 1, "piece": "weapon"}], "weapon_slots": [2],
        "targets": [{"skill_id": 61, "level": 1, "tier": 1}]})
    assert ok.status_code == 200, ok.text


def test_saved_row_cap_counts_payload_and_plan(client):
    plan = {"objective": {"goal": "g"}, "targets": [{"skill_id": 1, "level": 1, "tier": 1}],
            "exclude": {"armor": list(range(1000, 1100)), "charms": list(range(1000, 1050)),
                        "decorations": list(range(1000, 1050))}}
    big = {"head": {"pad": "y" * 64_700}}          # payload alone is under 64 KB
    r = client.post("/api/builds/saved", headers=H, json={"name": "big", "payload": big, "plan": plan})
    assert r.status_code == 413, r.text
    r = client.post("/api/builds/saved", headers=H, json={"name": "ok", "payload": {"head": 1}, "plan": plan})
    assert r.status_code == 201
    r = client.put(f"/api/builds/saved/{r.json()['id']}", headers=H, json={"payload": big})
    assert r.status_code == 413


def test_owned_snapshot_without_charms_key_is_unknown():
    snap = {"slots": [{"equipment": {"armor": []}, "decorations": []}]}
    assert builds.owned_from_snapshot(snap)["charms"] is None
    snap["slots"][0]["equipment"]["charms"] = []
    assert builds.owned_from_snapshot(snap)["charms"] == set()


# ---- migration
def test_migration_add_column_idempotent_and_newer_db(tmp_path):
    p = tmp_path / "user.db"
    c = sqlite3.connect(p, isolation_level=None)
    for stmt in userdb.MIGRATIONS[0]:
        c.execute(stmt)
    c.execute("ALTER TABLE saved_builds ADD COLUMN plan JSON")   # half-applied dev DB
    c.execute("PRAGMA user_version = 1")
    c.close()
    assert userdb.migrate(p) == 2
    c = sqlite3.connect(p)
    c.execute("PRAGMA user_version = 99")
    c.commit()
    c.close()
    with pytest.raises(RuntimeError, match="más nueva"):
        userdb.migrate(p)


# ---- planner notes
def _solve(client, body):
    r = client.post("/api/builds/plan/solve", headers=H, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_slot_note_in_catalog_mode(client):
    D = builds._load()
    heads = [a["id"] for a in D["armor"].values() if a["type"] == "head" and a["rank"] == "LR"]
    out = _solve(client, {"rank": "LR", "targets": [{"skill_id": 61, "level": 1, "tier": 1}],
                          "exclude": {"armor": heads}})
    assert out["results"] == []
    assert any("cabeza" in n for n in out["notes"])
    assert not any("bonos obligatorios" in n for n in out["notes"])


def test_weapon_id_and_slots_warning(client):
    row = db.one("SELECT id FROM weapons WHERE slot_1 > 0 LIMIT 1")
    out = _solve(client, {"rank": "LR", "targets": [{"skill_id": 61, "level": 1, "tier": 1}],
                          "weapon_id": row["id"], "weapon_slots": [1]})
    assert out["results"] and any("weapon_id y weapon_slots" in w for w in out["results"][0]["warnings"])


def test_charm_cover_text_counts_only_charm_contribution():
    ch = {"skills": {61: 3}, "name_es": "Amu", "name_en": "Amu"}
    tab = SimpleNamespace(by_skill={}, minsize={}, cost=lambda s: 1)
    cov = [{"skill_id": 61, "target": 2, "achieved": 5, "from": {"amuleto": 3, "armadura": 2, "joya": 0},
            "reason": None, "tier": 1, "name_es": "A", "cap": 5}]
    ctx = {"table_ideal": tab, "table": tab, "rank": "MR"}
    lines = planner._tradeoffs(builds._load(), ctx, cov, {"charm": ch}, [])
    assert any("cubre 2 niveles" in ln for ln in lines), lines


# ---- planner_store
def test_gaps_up_to_8_and_corrupt_draft(client):
    from app import planner_store
    checks = ["comodidad", "ritmo", "habilidades", "supervivencia", "estados", "dano", "afilado", "movilidad"]
    planner_store.TestLogIn(monster_id=1, tier="normal", gaps=checks, minutes=5, carts=0, verdict="lista")
    db.execute("INSERT INTO user_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
               (planner_store.DRAFT_KEY, "{not json"))
    r = client.get("/api/builds/plan/draft")
    assert r.status_code == 200 and r.json()["draft"] is None
    client.delete("/api/builds/plan/draft", headers=H)
