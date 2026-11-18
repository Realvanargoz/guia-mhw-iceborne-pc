"""Maxifusionador (Elder Melder / Melding Pot): items that can be melded, their RP/MP cost and ingredient MP values.

Data: research/melder/melder_data.json (Kiranico, build_data.py) + research/melder/melder.json (R4 notes/categories).
Kiranico gives no ingredient->item mapping for Guiding Lands materials, so that part is flagged needs_review.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

from . import settings
from .db import all_

router = APIRouter(prefix="/api")


def _find(name: str) -> Path:
    for base in (str(settings.RESEARCH_DIR / "melder"),):
        p = Path(base) / name
        if p.is_file():
            return p
    raise HTTPException(503, f"Falta research/melder/{name} (¿está montado /research en la API?)")


@lru_cache(maxsize=1)
def _data() -> dict:
    data = json.loads(_find("melder_data.json").read_text(encoding="utf-8"))
    notes = json.loads(_find("melder.json").read_text(encoding="utf-8"))
    return {"data": data, "gl": {i["item_en"].casefold(): i["category"] for i in notes["entries"]["items"]}}


def _category(name: str, gl: dict) -> str:
    low = name.casefold()
    if low in gl:
        return "tempered" if gl[low].endswith("tempered") else "gl"
    if low.startswith("tempered "):
        return "tempered"
    if "ticket" in low or "fireworks" in low:
        return "ticket"
    if re.search(r"\bjewel \d$", low):
        return "jewel"
    if "ammo" in low or low.startswith("ez "):
        return "ammo"
    if low.endswith(" gem") or " gem" in low:
        return "gem"
    return "other"


NOTES_ES = [
    "En Astera y Seliana, el Maxifusionador (el «Elder Melder» de las wikis en inglés) crea objetos a cambio de "
    "Puntos de Investigación (RP) y Puntos de Fusión (MP).",
    "Los MP no se compran: se aportan metiendo materia prima de tu cofre, y cada materia prima vale un número fijo de MP "
    "(por ejemplo Helechoflor 1, Mena de hierro 2, Encomio 50, Huella wyveriana 100, Huella wyveriana sublime 300).",
    "Cada objeto tiene un coste en MP; juntas varias materias primas hasta alcanzarlo. Ejemplo comprobado en el juego: "
    "Piel plateada siniestra = 250 RP + 320 MP (cuatro materiales de 80 pts).",
    "En el juego, la lista «Materia prima» solo enseña lo que tienes en el cofre y vale para ese objeto.",
    "Hay bonos temporales en eventos: ciertos ingredientes valen más MP.",
]
REVIEW_ES = [
    "Kiranico no publica qué materias primas acepta cada material de las Tierras Guía; en el juego salen otros "
    "materiales raros de 80 pts (y los Tempered de 120 a 320). Sin confirmar con otra fuente.",
    "No se encontró el límite de cantidad por materia prima ni el requisito de desbloqueo de cada objeto.",
    "Kiranico lista 236 objetos; en el juego solo ves los que ya desbloqueaste (tu captura mostraba 23).",
]


@router.get("/melder")
def melder():
    d = _data()
    data, gl = d["data"], d["gl"]
    db = {r["name_en"].casefold(): r for r in all_("SELECT id, name_en, name_es, rarity, category FROM items")}
    dec = {r["name_en"].casefold(): r for r in all_("SELECT id, name_en, name_es, rarity FROM decorations")}
    ing = {i["name_en"]: i for i in data["ingredients"]}
    # inverted: item -> accepted ingredients (only for items Kiranico maps)
    accepted: dict[str, list[dict]] = {}
    for i in data["ingredients"]:
        for t in i["targets_en"]:
            accepted.setdefault(t.casefold(), []).append({"name_en": i["name_en"], "name_es": i["name_es"], "mp": i["mp"]})
    items = []
    for it in data["items"]:
        key = it["name_en"].casefold()
        row = db.get(key)
        drow = None if row else dec.get(key)
        cat = _category(it["name_en"], gl)
        acc = sorted(accepted.get(key, []), key=lambda a: (a["mp"], a["name_en"]))
        items.append({**it, "category": cat, "item_id": row["id"] if row else None,
                      "decoration_id": drow["id"] if drow else None,
                      "icon_url": (f"/icons/items/{row['id']}.webp" if row else
                                   f"/icons/decorations/{drow['id']}.webp" if drow else None),
                      "rarity": (row or drow or {}).get("rarity"),
                      "accepted": acc, "accepted_known": bool(acc),
                      "needs_review": cat in ("gl", "tempered")})
    ingredients = []
    for i in data["ingredients"]:
        row = db.get(i["name_en"].casefold())
        ingredients.append({"name_en": i["name_en"], "name_es": i["name_es"], "mp": i["mp"],
                            "item_id": row["id"] if row else None,
                            "icon_url": f"/icons/items/{row['id']}.webp" if row else None,
                            "uses": len(i["targets_en"])})
    ingredients.sort(key=lambda a: (-a["mp"], a["name_en"]))
    cats = [("gl", "Materiales de las Tierras Guía"), ("tempered", "Materiales Tempered"), ("ticket", "Billetes y fuegos"),
            ("gem", "Gemas"), ("jewel", "Adornos"), ("ammo", "Munición y EZ"), ("other", "Otros")]
    return {"items": items, "ingredients": ingredients, "categories": [{"id": c, "name_es": n} for c, n in cats],
            "notes_es": NOTES_ES, "review_es": REVIEW_ES, "sources": data["sources"],
            "retrieved_at": data["retrieved_at"]}
