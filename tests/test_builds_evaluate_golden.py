"""Golden test de app.builds.evaluate_loadout: 12 equipos fijos en tests/fixtures/evaluate_golden.json.

La comparacion es de igualdad exacta (skills, set_bonuses, defense, slots, warnings). Si cambia a proposito la
logica del evaluador, regenerar con scripts/capture_evaluate_golden.py y revisar el diff del JSON.

Run: python -m pytest tests/test_builds_evaluate_golden.py -q
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
GOLDEN = json.loads((ROOT / "tests" / "fixtures" / "evaluate_golden.json").read_text(encoding="utf-8"))

from app import db, userdb  # noqa: E402
from app.builds import evaluate_loadout  # noqa: E402

pytestmark = pytest.mark.skipif(not CATALOG.is_file(), reason="build/catalog.db missing")
KEYS = ("skills", "set_bonuses", "defense", "slots_total", "slots_used", "slots_free", "warnings")


@pytest.fixture(scope="module", autouse=True)
def pool(tmp_path_factory):
    user = tmp_path_factory.mktemp("golden") / "user.db"
    userdb.migrate(user)
    db.close_pool()  # a pool left open by another test module would win over our temp path
    db.open_pool(user, CATALOG)
    yield
    db.close_pool()


def test_golden_has_twelve_cases():
    assert len(GOLDEN["cases"]) == 12
    assert len({c["name"] for c in GOLDEN["cases"]}) == 12


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["name"])
def test_evaluate_matches_golden(case):
    inp = case["input"]
    out = evaluate_loadout(inp["pieces"], inp["decorations"], inp["weapon_slots"])
    got = {k: out[k] for k in KEYS}
    assert got == case["expected"]
