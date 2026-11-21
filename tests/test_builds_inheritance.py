"""Bonus de set 'Inheritance' (Fatalis Legend, 2 piezas): quita el tope de TODAS las habilidades con secreto.

Artillery (id 61) tiene max_level 5 y secret 2: sin su secreto el tope es 3. Con 2 piezas del set Dragon α+/β+
(bono 67, Fatalis Legend) el evaluador debe dejar llegar Artillery a nivel 5. Puntos de Artillery:
Zorah Headgear α+ (1377, +2), Zorah Hide α+ (1378, +2) y Artillery Charm II (62, +2) = 6 puntos.
Piezas Fatalis: Dragonbarbs α+ (1574, cintura), Dragonfeet α+ (1575, piernas), Dragonhead β+ (1576, cabeza).

Usa un user.db temporal y build/catalog.db en solo lectura; nunca toca la instalacion del usuario.
Run: python -m pytest tests/test_builds_inheritance.py -q
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")

from app import db, userdb  # noqa: E402
from app import builds  # noqa: E402

ARTILLERY, INHERITANCE, FATALIS_LEGEND = 61, 170, 67
ZORAH_HEAD, ZORAH_CHEST, ARTILLERY_CHARM_II = 1377, 1378, 62
DRAGONBARBS_A, DRAGONFEET_A, DRAGONHEAD_B = 1574, 1575, 1576
MAXIMUM_MIGHT, LATENT_POWER = 88, 51
LARGE_MONSTER = 17  # Great Jagras


@pytest.fixture(scope="module", autouse=True)
def pool(tmp_path_factory):
    user = tmp_path_factory.mktemp("inheritance") / "user.db"
    userdb.migrate(user)
    db.close_pool()  # a pool left open by another test module would win over our temp path
    db.open_pool(user, CATALOG)
    yield
    db.close_pool()


def _skill(out: dict, sid: int) -> dict:
    return next(s for s in out["skills"] if s["skill_id"] == sid)


def _eval(pieces: dict) -> dict:
    return builds.evaluate(builds.EvalBody(pieces=pieces))


def test_catalog_exposes_inheritance():
    D = builds._load()
    assert D["unlock_all"] == INHERITANCE
    assert D["skills"][INHERITANCE]["name_en"] == "Inheritance"
    assert (2, INHERITANCE) in D["bonuses"][FATALIS_LEGEND]["ranks"]
    assert len(D["unlocks"]) == 12 and D["unlocks"][152] == ARTILLERY
    assert D["skills"][ARTILLERY]["cap"] == 3 and D["skills"][ARTILLERY]["max_level"] == 5


def test_without_fatalis_artillery_caps_at_3():
    out = _eval({"head": ZORAH_HEAD, "chest": ZORAH_CHEST, "charm": ARTILLERY_CHARM_II})
    art = _skill(out, ARTILLERY)
    assert (art["level"], art["max"], art["points"]) == (3, 3, 6)


def test_one_fatalis_piece_does_not_unlock():
    out = _eval({"head": ZORAH_HEAD, "chest": ZORAH_CHEST, "waist": DRAGONBARBS_A, "charm": ARTILLERY_CHARM_II})
    art = _skill(out, ARTILLERY)
    assert (art["level"], art["max"]) == (3, 3)
    assert all(s["skill_id"] != INHERITANCE for s in out["skills"])


def test_fatalis_legend_two_pieces_unlocks_artillery_5():
    out = _eval({"head": ZORAH_HEAD, "chest": ZORAH_CHEST, "waist": DRAGONBARBS_A, "legs": DRAGONFEET_A,
                 "charm": ARTILLERY_CHARM_II})
    art = _skill(out, ARTILLERY)
    assert (art["level"], art["max"], art["points"]) == (5, 5, 6)
    inh = _skill(out, INHERITANCE)
    assert (inh["level"], inh["max"]) == (1, 1)
    assert any(s["from"] == "set_bonus" for s in inh["source"])
    bonus = next(b for b in out["set_bonuses"] if b["skill_id"] == INHERITANCE)
    assert bonus["active"] and bonus["pieces"] == 2 and bonus["bonus_id"] == FATALIS_LEGEND
    # output shape unchanged: same keys as any other evaluation
    assert set(out) == set(_eval({"head": ZORAH_HEAD}))


def test_alpha_and_beta_pieces_count_together():
    # Dragonhead β+ (head) + Dragonbarbs α+ (waist): both belong to bonus 67, so Inheritance is active.
    out = _eval({"head": DRAGONHEAD_B, "chest": ZORAH_CHEST, "waist": DRAGONBARBS_A, "charm": ARTILLERY_CHARM_II})
    art = _skill(out, ARTILLERY)
    assert (art["level"], art["max"], art["points"]) == (4, 5, 4)
    assert not any("Artillería" in w for w in out["warnings"])


def test_levels_and_scorer_caps_unlock_all_secrets():
    D = builds._load()
    lv = builds._levels(D, {ARTILLERY: 6, LATENT_POWER: 7}, {INHERITANCE})
    assert lv[ARTILLERY] == (5, 5, 6) and lv[LATENT_POWER] == (7, 7, 7)
    lv = builds._levels(D, {ARTILLERY: 6, LATENT_POWER: 7}, set())
    assert lv[ARTILLERY] == (3, 3, 6) and lv[LATENT_POWER] == (5, 5, 7)

    sc = builds.Scorer(D, builds._monster_profile(D, D["monsters"][LARGE_MONSTER]), 1)
    base, unlocked = sc.caps(set()), sc.caps({INHERITANCE})
    for sid in (MAXIMUM_MIGHT, LATENT_POWER):  # offense skills with a secret
        assert base[sid] == D["skills"][sid]["cap"]
        assert unlocked[sid] == D["skills"][sid]["max_level"] > base[sid]
    assert unlocked == sc.caps(set(D["unlocks"]))  # Inheritance == every secret at once
