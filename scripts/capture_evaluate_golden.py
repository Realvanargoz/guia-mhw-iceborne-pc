"""Captura tests/fixtures/evaluate_golden.json: salida de app.builds.evaluate_loadout para 12 equipos fijos.

Uso (desde la raiz del repo): .venv-build/Scripts/python.exe scripts/capture_evaluate_golden.py
Solo usa la stdlib y el propio proyecto. Abre un user.db temporal y build/catalog.db (solo lectura).
Regenerar solo si el cambio de comportamiento es intencionado; el test compara igualdad exacta.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
CATALOG = ROOT / "build" / "catalog.db"
OUT = ROOT / "tests" / "fixtures" / "evaluate_golden.json"

from app import db, userdb  # noqa: E402
from app.builds import evaluate_loadout  # noqa: E402

# Zorah α+ set (305): head 1377, chest 1378, arms 1379, waist 1380, legs 1381. Charm 1 = Poison Charm I.
# Jewel 100 = Fire Res Jewel+ 4 (1 skill, size 4). Jewel 165 = Drain/Physique Jewel 4 (2 skills, size 4).
CASES = [
    ("empty", {}, [], None),
    ("zorah_head_only", {"head": 1377}, [], None),
    ("zorah_full_set", {"head": 1377, "chest": 1378, "arms": 1379, "waist": 1380, "legs": 1381}, [], None),
    ("zorah_set_auto_jewels", {"head": 1377, "chest": 1378, "arms": 1379, "waist": 1380, "legs": 1381},
     [100, 165], None),
    ("charm_only", {"charm": 1}, [], None),
    ("charm_with_zorah_head", {"head": 1377, "charm": 1}, [], None),
    ("explicit_two_skill_jewel_chest", {"chest": 1378}, [{"id": 165, "piece": "chest"}], None),
    ("two_skill_size4_auto", {"chest": 1378, "waist": 1380}, [165], None),
    ("weapon_slots_only", {}, [], [1, 2, 3]),
    ("weapon_slots_with_jewels", {"head": 1377}, [{"id": 100, "piece": "weapon"}, 101], [4, 2]),
    ("invalid_ids_and_wrong_slot", {"head": 1378, "legs": 999999, "charm": 999999}, [999999], [5]),
    ("mixed_loadout_with_weapon", {"arms": 166, "legs": 787, "head": 1377, "chest": 1378, "charm": 38},
     [100, 100, 165], [2, 1, 1]),
]

KEYS = ("skills", "set_bonuses", "defense", "slots_total", "slots_used", "slots_free", "warnings")


def main() -> None:
    user = Path(tempfile.mkdtemp(prefix="golden_")) / "user.db"
    userdb.migrate(user)
    db.open_pool(user, CATALOG)
    try:
        cases = []
        for name, pieces, decos, ws in CASES:
            out = evaluate_loadout(pieces, decos, ws)
            cases.append({
                "name": name,
                "input": {"pieces": pieces, "decorations": decos, "weapon_slots": ws},
                "expected": {k: out[k] for k in KEYS},
            })
    finally:
        db.close_pool()
    doc = {"description": "Salida de evaluate_loadout para 12 equipos fijos (ver scripts/capture_evaluate_golden.py).",
           "cases": cases}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK {len(cases)} casos -> {OUT}")


if __name__ == "__main__":
    main()
