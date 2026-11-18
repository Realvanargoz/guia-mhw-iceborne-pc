"""Read-only endpoints for the loot / gathering rule seeds (research/loot/*.json -> loot_rules / gathering_rules)."""
from fastapi import APIRouter

from .db import all_

router = APIRouter(prefix="/api")


_TABLES = {"loot_rules": "loot_rules", "gathering_rules": "gathering_rules"}   # closed allowlist for the identifier


def _sections(table: str) -> dict:
    table = _TABLES[table]
    skill_ids = {r["name_en"]: r["id"] for r in all_("SELECT id, name_en FROM skills")}
    out: dict = {}
    for r in all_(f"SELECT id, section, name_en, name_es, data, sources, needs_review FROM {table} ORDER BY section, sort_order"):
        d = dict(r["data"])
        d["id"] = r["id"]
        d["needs_review"] = r["needs_review"]
        d["sources"] = r["sources"]
        if r["section"] == "skills" and r["name_en"] in skill_ids:
            d["skill_id"] = skill_ids[r["name_en"]]   # link to /api/skills-style pages / builds
        out.setdefault(r["section"], []).append(d)
    return out


def _note(table: str) -> str:
    return ("Reglas investigadas (Iceborne PC). Las entradas con needs_review=true tienen cifras sin confirmar o fuentes "
            "que se contradicen; mira su review_note / el texto.")


@router.get("/loot-rules")
def loot_rules():
    """Botín y partes: habilidades, herramientas (manto de bandido), camarada (Plunderblade), consejos y combinaciones."""
    return {"sections": _sections("loot_rules"), "note_es": _note("loot")}


@router.get("/gathering-rules")
def gathering_rules():
    """Recolección: habilidades, herramientas, camarada/cantina y consejos."""
    return {"sections": _sections("gathering_rules"), "note_es": _note("gathering")}
