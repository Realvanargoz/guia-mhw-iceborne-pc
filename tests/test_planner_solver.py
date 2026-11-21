"""Motor del constructor por fases (api/app/planner.py): POST /api/builds/plan/solve.

Caso principal: el ejemplo del video de Dem (hacha cargada de impacto, MR, bono Esencia Zorah Magdaros 3).
Comprobado aparte con una búsqueda sin recortes sobre todos los estados de armadura con cota (0,0,0): el mínimo
real del catálogo es déficit t1=0, t2=0, t3=1 (falta un nivel de Bloqueo agresivo o de Bonus al aturdir).

user.db temporal y build/catalog.db en solo lectura; nunca toca la instalación del usuario.
Run: python -m pytest tests/test_planner_solver.py -q   (MHW_PERF=1 activa la prueba de tiempo)
"""
import itertools
import os
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
H = {"X-MHW-Client": "1"}
URL = "/api/builds/plan/solve"

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import builds, db, planner, settings, userdb  # noqa: E402

ARTILLERY, GUARD, HEALTH, STUN, WEX, PROLONGER, GUARD_UP, CAPACITY, OFF_GUARD, SLUGGER = (
    61, 70, 17, 4, 41, 43, 118, 59, 138, 47)
ART_SECRET, INHERITANCE = 152, 170
ZORAH = 50
ZORAH_HEAD, ZORAH_CHEST, ZORAH_ARMS, ZORAH_WAIST, ZORAH_LEGS, ZORAH_HEAD_B = 1377, 1378, 1379, 1380, 1381, 1382
VITALITY_1, ARTILLERY_1, IRONWALL_1 = 50, 89, 76
IRONSIDE_III, IRONSIDE_V = 69, 249
VIDEO = [(ARTILLERY, 5, 1), (GUARD, 5, 1), (HEALTH, 3, 1), (STUN, 3, 1), (WEX, 3, 1), (PROLONGER, 3, 1),
         (GUARD_UP, 1, 2), (CAPACITY, 1, 2), (OFF_GUARD, 3, 3), (SLUGGER, 3, 3)]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from starlette.testclient import TestClient
    from app.main import app

    user = tmp_path_factory.mktemp("planner") / "user.db"
    userdb.migrate(user)
    db.close_pool()  # a pool left open by another test module would win over our temp path
    db.open_pool(user, CATALOG)
    mp = pytest.MonkeyPatch()
    mp.setattr(settings, "SESSION_TOKEN", None)
    try:
        with TestClient(app, base_url="http://127.0.0.1") as c:
            yield c
    finally:
        mp.undo()
        db.close_pool()


def _targets(spec):
    return [{"skill_id": s, "level": lv, "tier": t} for s, lv, t in spec]


def _video(**kw):
    body = {"rank": "MR", "cap": "full", "mode": "ideal", "weapon_slots": [1], "targets": _targets(VIDEO),
            "set_bonus": {"bonus_id": ZORAH, "required": 3}}
    body.update(kw)
    return body


def _solve(client, body, status=200):
    r = client.post(URL, headers=H, json=body)
    assert r.status_code == status, r.text
    return r.json()


def _cov(result, sid):
    return next(c for c in result["coverage"] if c["skill_id"] == sid)


def _deficit(result):
    d = result["deficit"]
    return d["t1"], d["t2"], d["t3"]


def _bonus_pieces(result, bid):
    D = builds._load()
    return [p for p in result["pieces"] if not p.get("empty") and D["armor"][p["id"]]["bonus_id"] == bid]


def _snapshot(armor_ids, decos, charm_ids):
    D = builds._load()
    data = {"signature_ok": True, "slots": [{"slot": 1, "equipment": {
        "armor": [{"name_en": D["armor"][a]["name_en"], "count": 1} for a in armor_ids],
        "charms": [{"name_en": D["charms"][c]["name_en"], "count": 1} for c in charm_ids]},
        "decorations": [{"name_en": D["decos"][d]["name_en"], "count": n} for d, n in decos.items()]}]}
    db.execute("INSERT INTO profile_snapshots (taken_at, source, sha256, slot, data) VALUES (?, ?, ?, ?, ?)",
               (db.now(), "upload", "x" * 64, 1, db.J(data)))


@pytest.fixture()
def snapshot(client):
    yield _snapshot
    db.execute("DELETE FROM profile_snapshots")


# ------------------------------------------------------------------ (a) the video example
def test_video_example_ideal(client):
    out = _solve(client, _video())
    assert out["mode"] == "ideal" and out["results"]
    res = out["results"]
    assert [_deficit(r) for r in res] == sorted(_deficit(r) for r in res)
    best = res[0]
    # verified minimum of the real catalog: every primary and secondary complete, one tertiary level short
    assert _deficit(best)[:2] == (0, 0) and _deficit(best)[2] <= 1
    for r in res:
        assert _deficit(r)[0] == 0
        assert len(_bonus_pieces(r, ZORAH)) >= 3
        art = _cov(r, ARTILLERY)
        assert art["achieved"] == 5 and art["cap"] == 5 and art["status"] == "ok"
        assert art["cap_unlocked_by"] == "Esencia Zorah Magdaros"
        assert any(b["skill_id"] == ART_SECRET for b in r["set_bonuses"])
        assert r["loadout"]["weapon_slots"] == [1]
        for c in r["coverage"]:
            if c["status"] != "ok":
                assert c["tier"] == 3 and c["reason"] == "no_slot"
                assert any(t.startswith("Terciaria: " + c["name_es"]) for t in r["tradeoffs_es"])


def test_video_example_with_head_and_chest_locked(client):
    out = _solve(client, _video(locks={"head": ZORAH_HEAD, "chest": ZORAH_CHEST}))
    assert out["results"]
    seen_bonus_only = False
    for r in out["results"]:
        assert _deficit(r)[0] == 0
        assert r["loadout"]["pieces"]["head"] == ZORAH_HEAD and r["loadout"]["pieces"]["chest"] == ZORAH_CHEST
        assert _cov(r, ARTILLERY)["from"]["armadura"] >= 4
        zorah = _bonus_pieces(r, ZORAH)
        assert len(zorah) >= 3
        for p in zorah:
            if p["locked"]:
                assert p["aporta_es"].startswith("Aporta Artillería")
                continue
            gives = builds._load()["armor"][p["id"]]["skills"]
            if not any(s in gives for s, _, _ in VIDEO):
                seen_bonus_only = True
                assert p["aporta_es"] == "Solo activa el bono «Esencia Zorah Magdaros»"
                assert any(t.endswith("solo activa el bono «Esencia Zorah Magdaros»") for t in r["tradeoffs_es"])
    assert seen_bonus_only


# ------------------------------------------------------------------ (b) scenarios
def test_artillery_5_without_bonus_creates_scenarios(client):
    out = _solve(client, {"rank": "MR", "targets": _targets([(ARTILLERY, 5, 1), (HEALTH, 3, 2)]),
                          "weapon_slots": [1], "max_results": 5})
    notes = " ".join(out["scenario_notes_es"])
    for name in ("Esencia Zorah Magdaros", "Brachydios", "Fatalis Legend"):
        assert name in notes
    assert out["stats"]["scenarios"] == 3
    assert out["results"]
    for r in out["results"]:
        assert _cov(r, ARTILLERY)["achieved"] == 5
        assert {b["skill_id"] for b in r["set_bonuses"]} & {ART_SECRET, INHERITANCE}
        assert r["scenario_es"].startswith("Con «")


def test_bonus_only_skill_target_needs_its_bonus(client):
    out = _solve(client, {"rank": "MR", "targets": _targets([(ART_SECRET, 1, 1)]), "max_results": 1})
    assert "solo sale de un bono de set" in " ".join(out["scenario_notes_es"])
    r = out["results"][0]
    assert _deficit(r) == (0, 0, 0)
    assert any(b["skill_id"] == ART_SECRET for b in r["set_bonuses"])


# ------------------------------------------------------------------ (c) locks and exclusions
def test_locks_and_exclusions_respected(client):
    free = _solve(client, _video(set_bonus=None, targets=_targets(VIDEO[:6])))
    used = {p["id"] for r in free["results"] for p in r["pieces"] if not p.get("empty")}
    used_charms = {r["charm"]["id"] for r in free["results"] if r["charm"]}
    excluded = sorted(used)[:6]
    body = _video(set_bonus=None, targets=_targets(VIDEO[:6]),
                  locks={"legs": ZORAH_LEGS, "charm": IRONSIDE_III,
                         "decorations": [{"id": ARTILLERY_1, "piece": "legs"}, {"id": VITALITY_1, "piece": "weapon"}]},
                  exclude={"armor": excluded, "charms": sorted(used_charms)})
    out = _solve(client, body)
    assert out["results"]
    for r in out["results"]:
        lo = r["loadout"]
        assert lo["pieces"]["legs"] == ZORAH_LEGS and lo["pieces"]["charm"] == IRONSIDE_III
        assert r["charm"]["locked"] is True
        assert not ({p["id"] for p in r["pieces"] if not p.get("empty")} - {ZORAH_LEGS}) & set(excluded)
        assert {"id": ARTILLERY_1, "piece": "legs"} in lo["decorations"]
        assert {"id": VITALITY_1, "piece": "weapon"} in lo["decorations"]
        locked = [d for d in r["decorations"] if d["locked"]]
        assert sorted(d["decoration_id"] for d in locked) == sorted([ARTILLERY_1, VITALITY_1])
        assert next(p for p in r["pieces"] if p["type"] == "legs")["locked"] is True


# ------------------------------------------------------------------ (d) rank rules for decorations
def test_hr_has_no_size_4_jewels_and_lr_has_none(client):
    spec = [(HEALTH, 3, 1), (WEX, 3, 1), (GUARD, 5, 2), (STUN, 3, 3)]
    hr = _solve(client, {"rank": "HR", "targets": _targets(spec), "weapon_slots": [3, 1]})
    assert hr["results"]
    assert any(r["decorations"] for r in hr["results"])
    for r in hr["results"]:
        assert all(d["size"] <= 3 for d in r["decorations"])
        assert all(p["rank"] == "HR" for p in r["pieces"] if not p.get("empty"))
    lr = _solve(client, {"rank": "LR", "targets": _targets(spec), "weapon_slots": [1]})
    assert lr["results"]
    for r in lr["results"]:
        assert r["decorations"] == [] and r["loadout"]["decorations"] == []
        for c in r["coverage"]:
            if c["status"] != "ok" and c["achieved"] < min(c["target"], c["cap"]):
                assert c["reason"] == "no_jewel"


# ------------------------------------------------------------------ (e) owned mode
def test_owned_mode_uses_only_owned_things(client, snapshot):
    armor = [ZORAH_HEAD, ZORAH_CHEST, ZORAH_ARMS, ZORAH_WAIST, ZORAH_LEGS, ZORAH_HEAD_B]
    decos = {VITALITY_1: 1, ARTILLERY_1: 1, IRONWALL_1: 2}
    snapshot(armor, decos, [IRONSIDE_III])
    out = _solve(client, {"rank": "MR", "mode": "owned", "weapon_slots": [1],
                          "targets": _targets([(ARTILLERY, 5, 1), (HEALTH, 3, 1), (GUARD, 3, 2)])})
    assert out["mode"] == "owned" and out["owned_available"] is True
    assert out["results"]
    for r in out["results"]:
        for p in r["pieces"]:
            assert p.get("empty") or (p["id"] in armor and p["owned"] is True)
        assert r["charm"] is None or r["charm"]["id"] == IRONSIDE_III
        used = {}
        for d in r["decorations"]:
            used[d["decoration_id"]] = used.get(d["decoration_id"], 0) + 1
        assert all(n <= decos.get(i, 0) for i, n in used.items())
        assert r["missing"]["pieces"] == []
    best = out["results"][0]
    assert _cov(best, ARTILLERY)["achieved"] == 5
    assert best["charm"]["id"] == IRONSIDE_III and best["missing"]["charm_owned"] is True
    assert _cov(best, HEALTH)["achieved"] == 1 and _deficit(best)[0] == 2
    assert _cov(best, HEALTH)["reason"] == "jewel_not_owned"
    miss = best["missing"]["jewels"]
    assert miss and all(m["text_es"].startswith("Te falta ") for m in miss)
    assert any(HEALTH in builds._load()["decos"][m["decoration_id"]]["skills"] for m in miss)
    assert sum(m["count"] for m in miss if m["decoration_id"] == VITALITY_1) == 2


# ------------------------------------------------------------------ (f) impossible bonus in owned mode
def test_owned_impossible_bonus_gives_note(client, snapshot):
    snapshot([ZORAH_HEAD], {}, [])
    out = _solve(client, {"rank": "MR", "mode": "owned", "targets": _targets([(ARTILLERY, 3, 1)]),
                          "set_bonus": {"bonus_id": ZORAH, "required": 3}})
    assert out["results"] == []
    assert any("Esencia Zorah Magdaros" in n and "no se puede activar" in n for n in out["scenario_notes_es"])


def test_owned_without_unlock_reports_cap_locked(client, snapshot):
    snapshot([ZORAH_HEAD, ZORAH_CHEST, 1511], {ARTILLERY_1: 3}, [62])
    out = _solve(client, {"rank": "MR", "mode": "owned", "weapon_slots": [1],
                          "targets": _targets([(ARTILLERY, 5, 1), (HEALTH, 1, 3)])})
    assert any("no puede llegar a 5" in n for n in out["scenario_notes_es"])
    best = out["results"][0]
    art = _cov(best, ARTILLERY)
    assert (art["achieved"], art["cap"], art["status"], art["reason"]) == (3, 3, "parcial", "cap_locked")
    assert _deficit(best)[0] == 2
    line = next(t for t in best["tradeoffs_es"] if t.startswith("Primaria: Artillería 3/5"))
    assert "los niveles 4-5 necesitan el bono" in line and "«Esencia Zorah Magdaros» (3 piezas)" in line


def test_owned_without_save_falls_back_to_catalog(client):
    out = _solve(client, {"rank": "HR", "mode": "owned", "targets": _targets([(STUN, 2, 1)])})
    assert out["mode"] == "ideal" and out["owned_available"] is False
    assert any("cofre de equipo" in n for n in out["notes"])
    assert out["results"]


def test_weapon_id_and_reference_monster(client):
    w = db.one("SELECT id, slot_1, slot_2, slot_3 FROM weapons WHERE slot_1 >= 2 AND rarity >= 10 ORDER BY id LIMIT 1")
    slots = sorted([x for x in (w["slot_1"], w["slot_2"], w["slot_3"]) if x], reverse=True)
    out = _solve(client, {"rank": "MR", "weapon_id": w["id"], "targets": _targets([(WEX, 3, 1)]), "max_results": 1})
    assert out["results"][0]["loadout"]["weapon_slots"] == slots
    assert not any("ranuras del arma" in n for n in out["notes"])
    base = {"rank": "HR", "cap": "progress", "targets": _targets([(HEALTH, 3, 1)]), "max_results": 1}
    assert any("monstruo de referencia" in n for n in _solve(client, base)["notes"])
    assert _solve(client, {**base, "ref_monster_id": 17})["results"]
    assert client.post(URL, headers=H, json={**base, "ref_monster_id": 999_999}).status_code == 404


# ------------------------------------------------------------------ (g) validation
@pytest.mark.parametrize("patch", [
    {"targets": [{"skill_id": 17 + i, "level": 1, "tier": 1} for i in range(21)]},          # > 20 targets
    {"targets": _targets([(HEALTH, 3, 1), (HEALTH, 2, 2)])},                                  # duplicates
    {"targets": _targets([(HEALTH, 4, 1)])},                                                  # level > max
    {"targets": _targets([(HEALTH, 3, 4)])},                                                  # bad tier
    {"set_bonus": {"bonus_id": ZORAH, "required": 2}},                                        # not a real rank
    {"locks": {"decorations": [{"id": ARTILLERY_1, "piece": "head"}]}},                       # piece not locked
    {"locks": {"head": ZORAH_CHEST}},                                                         # wrong slot
    {"weapon_slots": [5]},
    {"max_results": 6},
    {"time_budget_ms": 100},
    {"unknown": 1},
    {"exclude": {"armor": list(range(101))}},
])
def test_validation_422(client, patch):
    body = {"rank": "MR", "targets": _targets([(HEALTH, 3, 1)])}
    body.update(patch)
    r = client.post(URL, headers=H, json=body)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    if isinstance(detail, list):        # pydantic errors: location + message only, never the input
        assert all(set(e) == {"loc", "msg", "type"} for e in detail)


def test_missing_weapon_is_404_and_header_is_required(client):
    body = {"rank": "MR", "targets": _targets([(HEALTH, 3, 1)])}
    assert client.post(URL, headers=H, json={**body, "weapon_id": 999_999}).status_code == 404
    assert client.post(URL, json=body).status_code == 403


def test_busy_solver_is_429(client):
    assert planner._sem.acquire(timeout=1)
    try:
        r = client.post(URL, headers=H, json={"rank": "HR", "targets": _targets([(STUN, 2, 1)]), "time_budget_ms": 300})
        assert r.status_code == 429
    finally:
        planner._sem.release()


# ------------------------------------------------------------------ (h) determinism + memo
def test_deterministic(client):
    body = planner.SolveBody(**_video(max_results=5))
    a = planner.solve_plan(body, None)
    b = planner.solve_plan(body, None)
    for x in (a, b):
        x.pop("elapsed_ms")
    assert a == b
    first = _solve(client, _video(max_results=2))
    again = _solve(client, _video(max_results=2))
    assert again["cached"] is True
    assert [r["loadout"] for r in first["results"]] == [r["loadout"] for r in again["results"]]


# ------------------------------------------------------------------ (i) every loadout reproduces in /evaluate
def _check_evaluate(client, out):
    for r in out["results"]:
        ev = client.post("/api/builds/evaluate", headers=H, json=r["loadout"]).json()
        assert ev["warnings"] == [], ev["warnings"]
        assert [(s["skill_id"], s["level"]) for s in ev["skills"]] == [(s["skill_id"], s["level"]) for s in r["skills"]]
        assert ev["slots_free"] == r["slots_free"]


def test_loadouts_match_evaluate(client, snapshot):
    _check_evaluate(client, _solve(client, _video(max_results=5)))
    _check_evaluate(client, _solve(client, _video(locks={"head": ZORAH_HEAD, "chest": ZORAH_CHEST})))
    _check_evaluate(client, _solve(client, {"rank": "MR", "targets": _targets([(ARTILLERY, 5, 1), (HEALTH, 3, 2)]),
                                            "weapon_slots": [1], "max_results": 5}))
    _check_evaluate(client, _solve(client, {"rank": "HR", "targets": _targets([(HEALTH, 3, 1), (WEX, 3, 1)]),
                                            "weapon_slots": [2]}))
    snapshot([ZORAH_HEAD, ZORAH_CHEST, ZORAH_ARMS, ZORAH_WAIST, ZORAH_LEGS], {VITALITY_1: 1, IRONWALL_1: 2}, [IRONSIDE_III])
    _check_evaluate(client, _solve(client, {"rank": "MR", "mode": "owned", "weapon_slots": [1],
                                            "targets": _targets([(ARTILLERY, 5, 1), (HEALTH, 3, 1), (GUARD, 3, 2)])}))


# ------------------------------------------------------------------ (j) brute force cross-check
def _brute_force(D, targets, armor_by_slot, decos, charms, weapon_slots):
    """Every armor combo (or empty slot) x charm x multiset of owned decorations that fits; exact levels."""
    tlist = [(s, lv, t) for s, lv, t in targets]
    dlist = sorted(decos.items())
    best = None
    for combo in itertools.product(*[armor_by_slot[s] + [None] for s in builds.SLOTS]):
        for charm in charms + [None]:
            pts, counts, slots = {}, {}, list(weapon_slots)
            for a in combo:
                if a is None:
                    continue
                a = D["armor"][a]
                for s, lv in a["skills"].items():
                    pts[s] = pts.get(s, 0) + lv
                if a["bonus_id"]:
                    counts[a["bonus_id"]] = counts.get(a["bonus_id"], 0) + 1
                slots += a["slots"]
            if charm is not None:
                for s, lv in D["charms"][charm]["skills"].items():
                    pts[s] = pts.get(s, 0) + lv
            active = {sid for bid, n in counts.items() for r, sid in D["bonuses"][bid]["ranks"] if n >= r}
            for mult in itertools.product(*[range(n + 1) for _, n in dlist]):
                jewels = sorted([did for (did, _), k in zip(dlist, mult) for _ in range(k)],
                                key=lambda d: -D["decos"][d]["slot"])
                free = sorted(slots)
                ok = True
                for did in jewels:      # largest first into the smallest slot that fits: exact for nested sizes
                    i = next((i for i, z in enumerate(free) if z >= D["decos"][did]["slot"]), None)
                    if i is None:
                        ok = False
                        break
                    free.pop(i)
                if not ok:
                    continue
                p2 = dict(pts)
                for did in jewels:
                    for s, lv in D["decos"][did]["skills"].items():
                        p2[s] = p2.get(s, 0) + lv
                lv = builds._levels(D, p2, active)
                d = [0, 0, 0, 0]
                for s, L, t in tlist:
                    d[t] += max(0, L - lv.get(s, (0,))[0])
                key = (d[1], d[2], d[3])
                if best is None or key < best:
                    best = key
    return best


def _inventory(D, rank, targets, lo, hi, skip, n):
    """n owned pieces per slot: the ones with target points, best first, skipping the `skip` strongest."""
    tset = {s for s, _, _ in targets}
    out = {}
    for s in builds.SLOTS:
        pool = [a for a in D["armor"].values() if a["type"] == s and a["rank"] == rank and lo <= (a["rarity"] or 0) <= hi
                and any(k in tset for k in a["skills"])]
        pool.sort(key=lambda a: (-sum(lv for k, lv in a["skills"].items() if k in tset), -sum(a["slots"]), a["id"]))
        out[s] = [a["id"] for a in pool[skip:skip + n]]
    return out


def _random_case(D, seed):
    rnd = random.Random(seed)
    rank = rnd.choice(["HR", "MR"])
    lo, hi = (5, 8) if rank == "HR" else (9, 12)
    pool_sk = [ARTILLERY, GUARD, HEALTH, STUN, WEX, PROLONGER, GUARD_UP, CAPACITY, OFF_GUARD, SLUGGER, 1, 2, 3, 5]
    sks = rnd.sample(pool_sk, rnd.randint(3, 6))
    targets = [(s, rnd.randint(1, D["skills"][s]["cap"]), rnd.randint(1, 3)) for s in sks]
    armor = {}
    for s in builds.SLOTS:
        pool = sorted(a["id"] for a in D["armor"].values() if a["type"] == s and a["rank"] == rank
                      and lo <= (a["rarity"] or 0) <= hi and any(k in sks for k in a["skills"]))
        armor[s] = rnd.sample(pool, min(len(pool), rnd.randint(1, 3)))
    dpool = sorted(d["id"] for d in D["decos"].values() if any(k in sks for k in d["skills"])
                   and 5 <= d["rarity"] <= (8 if rank == "HR" else 12) and (rank == "MR" or d["slot"] <= 3))
    decos = {d: rnd.randint(1, 2) for d in rnd.sample(dpool, min(len(dpool), rnd.randint(2, 4)))}
    cpool = sorted(c["id"] for c in D["charms"].values() if any(k in sks for k in c["skills"]) and (c["rarity"] or 0) <= hi)
    charms = rnd.sample(cpool, min(len(cpool), rnd.randint(0, 2)))
    ws = rnd.choice([[], [1], [2]] + ([[3, 1]] if rank == "MR" else []))
    return rank, targets, armor, decos, charms, ws


def _cross_check(D, rank, targets, armor, decos, charms, ws, max_results):
    expected = _brute_force(D, targets, armor, decos, charms, ws)
    own = {"armor": {a for ids in armor.values() for a in ids}, "decorations": decos, "charms": set(charms)}
    body = planner.SolveBody(rank=rank, mode="owned", weapon_slots=ws or None, targets=_targets(targets),
                             max_results=max_results)
    out = planner.solve_plan(body, own)
    assert out["results"]
    assert _deficit(out["results"][0]) == expected, (rank, targets)
    return expected


def test_brute_force_cross_check(client):
    D = builds._load()
    # MR with double 4-slot jewels; the optimum needs Artillery Jewel+ 4 even though it overshoots the cap by 1
    targets = [(ARTILLERY, 3, 1), (WEX, 3, 1), (HEALTH, 3, 1), (GUARD, 5, 2), (STUN, 3, 2), (PROLONGER, 3, 3),
               (SLUGGER, 3, 3)]
    armor = _inventory(D, "MR", targets, 9, 12, 10, 3)
    decos = {336: 1, 323: 1, 151: 1, VITALITY_1: 1, IRONWALL_1: 2, 53: 1}
    assert _cross_check(D, "MR", targets, armor, decos, [62, 248], [1], 1) == (0, 1, 4)
    # HR, nothing left to optimise in tier 1/2 but one tertiary level
    targets = [(HEALTH, 3, 1), (WEX, 3, 1), (GUARD, 5, 2), (STUN, 3, 3), (PROLONGER, 2, 3)]
    armor = _inventory(D, "HR", targets, 5, 8, 6, 3)
    assert _cross_check(D, "HR", targets, armor, {VITALITY_1: 2, 61: 1, IRONWALL_1: 1, 40: 1, 70: 1},
                        [22, 191, IRONSIDE_III], [1], 3) == (0, 0, 1)


@pytest.mark.parametrize("seed", range(8))
def test_brute_force_cross_check_random(client, seed):
    D = builds._load()
    _cross_check(D, *_random_case(D, 7000 + seed), max_results=1 + seed % 3)


# ------------------------------------------------------------------ (k) time (opt-in)
@pytest.mark.skipif(os.environ.get("MHW_PERF") != "1", reason="solo con MHW_PERF=1")
def test_time_budget(client):
    builds._cache.pop("plan_memo", None)
    out = _solve(client, _video(time_budget_ms=1500))
    assert out["elapsed_ms"] <= 1500 + 300
