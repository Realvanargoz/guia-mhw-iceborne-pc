"""Cantina (Iceborne PC): catalogue + simulator.

Data: research/canteen/canteen.json -> canteen_ingredients / canteen_skills / canteen_rules (catalog.db).

The simulator applies ONLY the qualitative rules the sources publish (ingredient types, 2/4/6 thresholds, half a
star of activation per fresh ingredient, vouchers, +10/+4 HP per fresh ingredient). Each branch (= skill_type) gives
ONLY the skill of the tier it reaches, floor(min(n,6)/2); lower tiers are superseded [Fandom]. Same rules as the
UI engine web/src/pages/canteen/engine.ts (shared cases: research/canteen/sim_cases.json). No source publishes activation
percentages, so none are produced: the answer says so explicitly and returns stars instead.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .db import all_

router = APIRouter(prefix="/api/canteen")

NO_PERCENT_ES = ("Ninguna fuente consultada (Kiranico, monsterhunterwiki.org, Fextralife, Game8, PowerPyx) publica "
                 "porcentajes de activación de las habilidades de cantina; solo estrellas (1 a 3). Por eso este "
                 "simulador no calcula probabilidades: muestra las estrellas y su significado cualitativo.")
STARS_TEXT_ES = {
    1: "1 estrella: muy baja probabilidad de activar al menos una habilidad (Game8).",
    2: "2 estrellas: muy buena probabilidad de activar al menos una, buena de dos y muy baja de todas (Game8).",
    3: "3 estrellas: activación garantizada de todas las habilidades según monsterhunterwiki.org y Fextralife; "
       "Game8 matiza: al menos 2 garantizadas y probabilidad muy alta de todas.",
}
MAX_SLOTS = 6
TIERS = (2, 4, 6)   # ingredients of one type needed for skill tier 1 / 2 / 3
FOOD_TYPES = ("Courage", "Resilience", "Vigor", "Acumen", "Artillery")
DRINK_TYPES = ("Perception", "Fortune", "Preparation", "Trailblazer")
BUFF = {"meat": ("attack", "Ataque"), "fish": ("defense", "Defensa"), "veggie": ("elemental_res", "Resistencia elemental")}
BUFF_SIZE = {1: "S", 2: "M", 3: "L"}
UNLOCK_ES = {"base": "Disponible desde el inicio", "quest": "Misión", "delivery": "Entrega",
             "bounty": "Recompensa por captura", "gathering": "Recolección"}


def _unlock_es(u: dict | None) -> str | None:
    if not u:
        return None
    t = u.get("type")
    detail = (u.get("detail_en") or "").strip()
    if t == "base":
        return UNLOCK_ES["base"] + (" de Iceborne" if "Iceborne" in detail else "")
    return f"{UNLOCK_ES.get(t, t)}: {detail}" if detail else UNLOCK_ES.get(t)


def _ingredients() -> list[dict]:
    rows = all_("""
      SELECT c.id, c.name_en, c.name_es, c.category, c.category_es, c.skill_type, c.skill_type_es, c.description_en,
             c.description_es, c.unlock_type, c.unlock, c.unlock_es, c.doc_id, c.can_be_fresh, c.item_id, c.sources,
             c.needs_review,
             c.review_notes, i.icon_name, i.icon_color, i.rarity, p.done
      FROM canteen_ingredients c
      LEFT JOIN items i ON i.id = c.item_id
      LEFT JOIN progress p ON p.entity_type = 'ingredient' AND p.entity_id = c.id
      ORDER BY c.sort_order""")
    for r in rows:
        r["icon_url"] = f"/icons/ingredients/{r['id']}.webp"
        r["unlock_es"] = r["unlock_es"] or _unlock_es(r["unlock"])   # workbook text first, computed fallback
        r["done"] = bool(r["done"])
    return rows


def _skills() -> list[dict]:
    return all_("""SELECT id, name_en, name_es, effect_en, effect_es, kind, skill_type, skill_type_es, tier,
                          ingredients_required, hunter_effect, palico_effect, duration, pool_note, note_es,
                          numeric_details, synergy_es, sources, needs_review, review_notes
                   FROM canteen_skills ORDER BY sort_order""")


def _types(skills: list[dict], ings: list[dict]) -> list[dict]:
    """One entry per ingredient skill type with its three tiers (2/4/6 ingredients) and ingredient counts."""
    out: dict = {}
    for i in ings:
        t = out.setdefault(i["skill_type"], {"skill_type": i["skill_type"], "skill_type_es": i["skill_type_es"],
                                             "categories": set(), "ingredient_count": 0, "tiers": []})
        t["categories"].add(i["category"])
        t["ingredient_count"] += 1
    for s in skills:
        if s["kind"] == "ingredient" and s["skill_type"] in out:
            out[s["skill_type"]]["tiers"].append({"tier": s["tier"], "ingredients_required": s["ingredients_required"],
                                                  "skill_id": s["id"], "name_es": s["name_es"], "name_en": s["name_en"]})
    for t in out.values():
        t["categories"] = sorted(t["categories"])
        t["tiers"].sort(key=lambda x: x["tier"])
    return list(out.values())


def _branches() -> list[dict]:
    return all_("""SELECT id, name_es, name_en, color_name_es, color_hex, glyph, branch_group AS "group", categories,
                          skill_ids, sort_order, sources, needs_review, review_notes
                   FROM canteen_branches ORDER BY sort_order""")


def _recipes() -> list[dict]:
    return all_("""SELECT id, name_es, plate_type_es, composition, variants_es, target_skill_ids, needs_daily,
                          voucher_es, use_es, sort_order, sources, needs_review, review_notes
                   FROM canteen_recipes ORDER BY sort_order""")


@router.get("")
def canteen():
    """Catálogo completo: ingredientes (con icono/progreso), habilidades felyne, reglas y fuentes."""
    ings = _ingredients()
    skills = _skills()
    rules = all_("""SELECT id, topic, title_es, text_es, sources, needs_review, review_notes
                    FROM canteen_rules ORDER BY sort_order""")
    return {
        "ingredients": ings,
        "skills": {"ingredient": [s for s in skills if s["kind"] == "ingredient"],
                   "daily": [s for s in skills if s["kind"] == "daily"]},
        "skill_types": _types(skills, ings),
        "rules": rules,
        "branches": _branches(),
        "recipes": _recipes(),
        "meta": {
            "counts": {"ingredients": len(ings), "ingredient_skills": sum(s["kind"] == "ingredient" for s in skills),
                       "daily_skills": sum(s["kind"] == "daily" for s in skills), "rules": len(rules),
                       "done": sum(i["done"] for i in ings)},
            "categories": [{"id": "meat", "name_es": "Carne"}, {"id": "fish", "name_es": "Pescado"},
                           {"id": "veggie", "name_es": "Verdura/fruta"}, {"id": "drink", "name_es": "Bebida"}],
            "simulate": {"max_ingredients": MAX_SLOTS, "tiers": list(TIERS), "skill_slots": 3},
            "no_percentages_es": NO_PERCENT_ES,
        },
    }


class IngredientIn(BaseModel):
    id: str = Field(max_length=80, pattern=r"^[^\x00-\x1f\x7f]+$", description="id del ingrediente (ing_*) o su name_en")
    fresh: bool = False


class SimulateIn(BaseModel):
    ingredients: list[IngredientIn | Annotated[str, Field(max_length=80, pattern=r"^[^\x00-\x1f\x7f]+$")]] = Field(default_factory=list, max_length=6, description="hasta 6 (según huecos)")
    slots: int = Field(MAX_SLOTS, ge=2, le=MAX_SLOTS, description="huecos de ingrediente de tu cantina: 2, 4 o 6")
    voucher: str = Field("none", pattern="^(none|voucher|gourmet)$",
                         description="none | voucher (3 estrellas) | gourmet (todos frescos y 3 estrellas)")
    daily_skill_ids: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=3,
                                       description="ids fs_* de las habilidades diarias que muestra tu cantina hoy (opcional)")


@router.post("/simulate")
def simulate(body: SimulateIn):
    ings = {i["id"]: i for i in _ingredients()}
    by_name = {i["name_en"].lower(): i for i in ings.values()}
    skills = {s["id"]: s for s in _skills()}
    notes: list[str] = []
    chosen = []
    seen: set[str] = set()
    for x in body.ingredients:
        x = IngredientIn(id=x) if isinstance(x, str) else x
        ing = ings.get(x.id) or by_name.get(x.id.strip().lower())
        if ing is None:
            raise HTTPException(422, f"Ingrediente desconocido: {x.id!r}")
        if ing["id"] in seen:
            raise HTTPException(422, f"Ingrediente repetido: {ing['name_es'] or ing['id']!r}. Cada ingrediente solo "
                                     "puede ir una vez en el plato.")
        seen.add(ing["id"])
        chosen.append((ing, x.fresh))
    if len(chosen) > body.slots:
        raise HTTPException(422, f"Has elegido {len(chosen)} ingredientes y tu cantina tiene {body.slots} huecos.")
    daily_in = []
    for sid in body.daily_skill_ids:
        s = skills.get(sid)
        if s is None or s["kind"] != "daily":
            raise HTTPException(422, f"Habilidad diaria desconocida: {sid!r}")
        if s in daily_in:
            raise HTTPException(422, f"Habilidad diaria repetida: {sid!r}")
        daily_in.append(s)
    if len(daily_in) > 3:
        raise HTTPException(422, "La cantina muestra 3 habilidades diarias como máximo.")

    gourmet = body.voucher == "gourmet"
    n = len(chosen)
    fresh = n if gourmet else sum(1 for _, f in chosen if f)

    # ---- branch skills: n ingredients of one branch reach tier floor(min(n,6)/2); only that tier is active
    counts: dict[str, int] = {}
    for ing, _ in chosen:
        counts[ing["skill_type"]] = counts.get(ing["skill_type"], 0) + 1
    by_type, ingredient_skills = [], []
    any_superseded = False
    for t, cnt in sorted(counts.items(), key=lambda kv: -kv[1]):
        tiers = sorted((s for s in skills.values() if s["kind"] == "ingredient" and s["skill_type"] == t),
                       key=lambda s: s["tier"])
        reached = min(cnt, MAX_SLOTS) // 2
        row = {"skill_type": t, "skill_type_es": tiers[0]["skill_type_es"] if tiers else None, "count": cnt,
               "tier_reached": reached,
               "next_tier_at": next((th for th in TIERS if cnt < th), None),
               "skills": []}
        for s in tiers:
            tier = s["tier"] or 0
            active, superseded = tier == reached and reached > 0, 0 < tier < reached
            any_superseded |= superseded
            row["skills"].append({"id": s["id"], "name_es": s["name_es"], "name_en": s["name_en"],
                                  "effect_es": s["effect_es"], "tier": s["tier"],
                                  "ingredients_required": s["ingredients_required"],
                                  "unlocked": active,   # = active (kept for old clients)
                                  "active": active, "superseded": superseded, "locked": tier > reached,
                                  "needs_review": s["needs_review"], "numeric_details": s["numeric_details"]})
        by_type.append(row)
        ingredient_skills += [x for x in row["skills"] if x["active"]]
    if any_superseded:
        notes.append("Cada rama da solo su nivel más alto (Fandom); confirmar en el juego.")

    # ---- daily skills fill the free skill slots
    free_slots = max(0, 3 - len(ingredient_skills))
    daily = {"free_skill_slots": free_slots,
             "provided": [{"id": s["id"], "name_es": s["name_es"], "name_en": s["name_en"], "effect_es": s["effect_es"]}
                          for s in daily_in[:free_slots]]}
    if not daily_in:
        daily["note_es"] = ("Los huecos libres se rellenan con las 3 habilidades diarias de tu cantina (hay 29 posibles; "
                            "cambian al volver de una misión según monsterhunterwiki.org, y a diario a las 00:00 UTC y "
                            "al comer según Game8). Pásalas en daily_skill_ids para verlas aquí; no se pueden predecir.")

    # ---- stars: half a star per fresh ingredient, 3 stars max; vouchers force the maximum
    stars = 3.0 if body.voucher in ("voucher", "gourmet") else min(3.0, fresh * 0.5)
    text = STARS_TEXT_ES.get(int(stars))
    if text is None:
        text = ("Menos de 1 estrella: las fuentes no publican la probabilidad base ni describen este caso. "
                "Hacen falta ingredientes frescos (o un vale) para llegar a 1-3 estrellas.")
    activation = {"stars": stars, "fresh_ingredients": fresh, "voucher": body.voucher, "text_es": text,
                  "rule_es": "Cada ingrediente fresco sube media estrella; con 6 frescos son 3 estrellas. El Vale pone 3 "
                             "estrellas; el Vale gourmet vuelve frescos todos los ingredientes."}

    # ---- stat buffs by category
    cat = {c: sum(1 for i, _ in chosen if i["category"] == c) for c in ("meat", "fish", "veggie", "drink")}
    buffs = []
    for c, (key, label) in BUFF.items():
        lvl = min(cat[c], MAX_SLOTS) // 2
        buffs.append({"stat": key, "name_es": label, "from_category": c, "count": cat[c], "level": BUFF_SIZE.get(lvl),
                      "value_fextralife": {1: 5, 2: 10, 3: 15}.get(lvl) if key in ("attack", "defense") else None,
                      "needs_review": True})
    notes.append("Mejoras de ataque/defensa/resistencia: nivel S/M/L con 2/4/6 ingredientes de carne/pescado/verdura. "
                 "Los valores +5/+10/+15 solo los publica Fextralife; el de resistencia elemental no consta en ninguna fuente.")

    hp = {"hunter_max_hp": min(fresh, 5) * 10, "palico_max_hp": min(fresh, 5) * 4, "hunter_cap": 50, "palico_cap": 20,
          "stamina_up_to": 50, "needs_review": True,
          "note_es": "+10 de vida máxima al cazador y +4 al camarada por ingrediente fresco, con tope de 5 (+50 / +20). "
                     "El aguante sube hasta +50 (monsterhunterwiki.org: depende del nivel de la cantina; Game8: fijo). "
                     "Con Vale gourmet y plato completo (5 o más ingredientes) las fuentes dan +50 / +20."}
    palico = {"max_hp": hp["palico_max_hp"],
              "note_es": "El camarada solo recibe vida máxima; ninguna fuente lista habilidades de cantina que cambien su "
                         "combate (Felyne Trainer solo acelera su crecimiento)."}

    return {
        "input": {"ingredients": [{"id": i["id"], "name_es": i["name_es"], "name_en": i["name_en"],
                                   "category": i["category"], "skill_type": i["skill_type"], "fresh": bool(gourmet or f),
                                   "item_id": i["item_id"], "icon_url": i["icon_url"]} for i, f in chosen],
                  "slots": body.slots, "voucher": body.voucher},
        "by_type": by_type,
        "ingredient_skills": ingredient_skills,
        "daily": daily,
        "activation": activation,
        "probabilities": {"published": False, "text_es": NO_PERCENT_ES},
        "stat_buffs": buffs,
        "health": hp,
        "palico": palico,
        "notes_es": notes,
        "needs_review": True,
    }
