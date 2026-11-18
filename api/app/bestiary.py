"""In-game style bestiary book: list of large monsters (left page) and a per-monster page with
ecology, physiology (weak points, breakable parts, element/status stars) and rewards by rank.
Every section tolerates missing data (empty lists / zero stars)."""
from fastapi import APIRouter

from .db import all_, one_or_404

router = APIRouter(prefix="/api")

# Hitzone value -> weak-point stars (checked from highest). In-game shows the weakest part per damage type.
HITZONE_STAR_THRESHOLDS = ((45, 3), (35, 2), (25, 1))
# Reward drop percentage -> stars (1-5); calibrated on Anjanath MR in-game values:
# 2-5% -> 1, 6-9% -> 2 (not observed, interpolated), 10-15% -> 3, 16-30% -> 4, >30% -> 5.
REWARD_STAR_THRESHOLDS = ((5, 1), (9, 2), (15, 3), (30, 4))
# Reward condition kind -> (display order, section). Mirrors the in-game page:
# "Cortados" (carves), "Recompensas" (quest rewards), "Material caído" (drops), then broken parts, then the rest.
KIND_SECTIONS = {
    "carve": (0, "carved"), "reward": (1, "rewards"), "drop": (2, "dropped"), "break": (3, "broken"),
    "wound": (3, "broken"), "mining": (4, "other"), "capture": (4, "other"), "track": (5, "other"),
    "palico": (6, "other"), "siege": (7, "other"), "gl": (8, "other"), "appraisal": (9, "other"),
}
RANKS = ("LR", "HR", "MR")
ELEMENTS = ("fire", "water", "thunder", "ice", "dragon")
STATUSES = ("poison", "sleep", "paralysis", "blast", "stun")


def _stars(value, thresholds) -> int:
    v = value or 0
    for limit, s in thresholds:
        if v >= limit:
            return s
    return 0


def _reward_stars(pct) -> int:
    p = float(pct or 0)
    for limit, s in REWARD_STAR_THRESHOLDS:
        if p <= limit:
            return s
    return 5


@router.get("/bestiary")
def bestiary_list():
    return all_("""
      SELECT m.id, m.name_es, m.name_en, m.ecology_en,
             COALESCE((SELECT json_group_array(x) FROM (
                         SELECT DISTINCT r.rank x FROM monster_rewards r WHERE r.monster_id = m.id
                         ORDER BY CASE r.rank WHEN 'LR' THEN 1 WHEN 'HR' THEN 2 WHEN 'MR' THEN 3 ELSE 4 END) q),
                      '[]') AS "has_ranks [JSON]"
      FROM monsters m WHERE m.size = 'large' ORDER BY m.id""")


def _weak_points(hz: list[dict]) -> list[dict]:
    out = []
    for dmg in ("cut", "impact", "shot"):
        cand = [h for h in hz if h[dmg] is not None]
        if not cand:
            continue
        best = max(cand, key=lambda h: h[dmg])
        out.append({"damage": dmg, "value": best[dmg], "stars": _stars(best[dmg], HITZONE_STAR_THRESHOLDS),
                    "part_es": best["hitzone_es"] or best["hitzone_en"], "part_en": best["hitzone_en"]})
    return out


def _weakness_block(w: dict | None) -> dict:
    w = w or {}
    return {"elements": {k: w.get(k) or 0 for k in ELEMENTS}, "statuses": {k: w.get(k) or 0 for k in STATUSES}}


@router.get("/bestiary/{monster_id}")
def bestiary_entry(monster_id: int):
    m = one_or_404("SELECT * FROM monsters WHERE id = ?", (monster_id,), "monstruo")
    habitats = all_("""
      SELECT h.location_id, l.name_es, l.name_en, h.start_area, h.move_area, h.rest_area, h.rank
      FROM monster_habitats h JOIN locations l ON l.id = h.location_id
      WHERE h.monster_id = ? ORDER BY h.location_id, h.id""", (monster_id,))
    hz = all_("SELECT * FROM monster_hitzones WHERE monster_id = ? ORDER BY id", (monster_id,))
    breaks = all_("SELECT * FROM monster_breaks WHERE monster_id = ? ORDER BY id", (monster_id,))
    weaks = all_("SELECT * FROM monster_weaknesses WHERE monster_id = ? ORDER BY (form = 'normal') DESC NULLS FIRST, id",
                 (monster_id,))
    rows = all_("""
      SELECT r.rank, c.id cid, c.name_es condition_es, c.name_en condition_en, c.kind, i.id item_id,
             i.name_es, i.name_en, r.stack, r.percentage
      FROM monster_rewards r JOIN reward_conditions c ON c.id = r.condition_id JOIN items i ON i.id = r.item_id
      WHERE r.monster_id = ? ORDER BY r.rank, c.id, r.percentage DESC NULLS FIRST, i.id""", (monster_id,))

    rewards: dict[str, list] = {}
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["rank"], r["cid"])
        if key not in groups:
            order, section = KIND_SECTIONS.get(r["kind"], (10, "other"))
            groups[key] = {"condition_es": r["condition_es"], "condition_en": r["condition_en"], "kind": r["kind"],
                           "section": section, "_o": (order, r["cid"]), "items": []}
        pct = float(r["percentage"]) if r["percentage"] is not None else None
        groups[key]["items"].append({"item_id": r["item_id"], "name_es": r["name_es"] or r["name_en"],
                                     "name_en": r["name_en"], "stack": r["stack"], "percentage": pct,
                                     "stars": _reward_stars(pct)})
    for rank in RANKS:
        gs = sorted((g for (rk, _), g in groups.items() if rk == rank), key=lambda g: g["_o"])
        if gs:
            for g in gs:
                g.pop("_o")
            rewards[rank] = gs

    forms = [{"form": w["form"], "alt_description": w["alt_description"], **_weakness_block(w)} for w in weaks]
    return {
        "id": m["id"], "name_es": m["name_es"], "name_en": m["name_en"], "size": m["size"],
        "ecology": {"class_en": m["ecology_en"], "description_es": m["description_es"],
                    "description_en": m["description_en"], "habitats": habitats},
        "physiology": {
            "weak_points": _weak_points(hz),
            "breakable_parts": [{"part_es": b["part_es"] or b["part_en"], "part_en": b["part_en"],
                                 "flinch": b["flinch"], "wound": b["wound"], "sever": b["sever"],
                                 "extract": b["extract"]}
                                for b in breaks if b["wound"] or b["sever"]],
            **_weakness_block(weaks[0] if weaks else None),
            "forms": forms,
        },
        "rewards": rewards,
        "links": {"page": f"/monstruos/{m['id']}"},
    }
