"""Listados de catálogo para la guía: habilidades (con joyas, bonos de set y secretas), bonos de set y piezas.

GET only, sobre el catalog.db de solo lectura. Las respuestas dependen solo del rango (LR/HR/MR) y se
memorizan en un dict de módulo por rango; el catálogo no cambia en caliente.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi import Path as PathParam

from .db import all_

router = APIRouter()

RankQ = Annotated[Literal["LR", "HR", "MR"] | None, Query()]
# Rango de rareza de las joyas por rango de cacería; LR no tiene joyas (None = sin filtro).
JEWEL_BAND = {"LR": (None, None), "HR": (5, 8), "MR": (5, 12), None: (None, None)}
PIECE_SLOTS = ("head", "chest", "arms", "waist", "legs")

_cache: dict = {}


def _in_band(rank: str | None, rarity: int | None) -> bool:
    lo, hi = JEWEL_BAND[rank]
    if rank == "LR":
        return False
    if lo is None:
        return True
    return rarity is not None and lo <= rarity <= hi


def _rank_bonus_ids(rank: str | None) -> set[int] | None:
    """Bonos de set con al menos una pieza de ese rango; None = sin filtro (rank no dado)."""
    if rank is None:
        return None
    return {r["bonus_id"] for r in all_(
        "SELECT DISTINCT bonus_id FROM armor_sets WHERE bonus_id IS NOT NULL AND rank = ?", (rank,))}


def _skill_name(row: dict) -> str | None:
    return row.get("name_es") or row.get("name_en")


@router.get("/api/skills")
def skills_list(rank: RankQ = None):
    key = ("skills", rank)
    if key in _cache:
        return _cache[key]

    skills = all_("""SELECT id, name_en, name_es, description_en, description_es, icon_color, max_level, secret,
                            unlocks FROM skills ORDER BY id""")
    by_name = {s["name_en"]: s["id"] for s in skills}
    unlocks_id = {s["id"]: by_name.get(s["unlocks"]) for s in skills if s["unlocks"]}
    secret_for: dict[int, list[int]] = defaultdict(list)  # base skill id -> secret skill ids
    for s in skills:
        if s["unlocks"] and unlocks_id.get(s["id"]) is not None:
            secret_for[unlocks_id[s["id"]]].append(s["id"])
    skill_by_id = {s["id"]: s for s in skills}
    inherit_id = by_name.get("Inheritance")   # unlocks NULL: it opens the secret level of EVERY skill that has one
    rank_bonuses = _rank_bonus_ids(rank)

    bonus_ranks = all_("""SELECT br.skill_id, br.bonus_id, br.required, b.name_en bonus_en, b.name_es bonus_es
                          FROM armor_set_bonus_ranks br JOIN armor_set_bonuses b ON b.id = br.bonus_id
                          ORDER BY br.bonus_id, br.rowid""")
    ranks_by_skill: dict[int, list] = defaultdict(list)
    for r in bonus_ranks:
        if rank_bonuses is None or r["bonus_id"] in rank_bonuses:
            ranks_by_skill[r["skill_id"]].append(r)

    armor_counts: dict[int, dict] = defaultdict(lambda: {"LR": 0, "HR": 0, "MR": 0})
    for r in all_("""SELECT ak.skill_id, a.rank, count(*) n FROM armor_skills ak
                     JOIN armor a ON a.id = ak.armor_id GROUP BY ak.skill_id, a.rank"""):
        if r["rank"] in ("LR", "HR", "MR"):
            armor_counts[r["skill_id"]][r["rank"]] += r["n"]
    armor_ids = {r["skill_id"] for r in all_("SELECT DISTINCT skill_id FROM armor_skills")}
    deco_ids = {r["skill_id"] for r in all_("SELECT DISTINCT skill_id FROM decoration_skills")}
    charm_max = {r["skill_id"]: r["lvl"] for r in all_(
        "SELECT skill_id, max(level) lvl FROM charm_skills GROUP BY skill_id")}
    charm_ids = set(charm_max)

    jewels: dict[int, dict] = defaultdict(dict)  # skill id -> {(size, level, double): min_rarity}
    for r in all_("""SELECT ds.skill_id, d.slot, ds.level, d.rarity, instr(d.name_en, '+') > 0 plus
                     FROM decoration_skills ds JOIN decorations d ON d.id = ds.decoration_id"""):
        if not _in_band(rank, r["rarity"]):
            continue
        k = (r["slot"], r["level"], bool(r["plus"]))
        cur = jewels[r["skill_id"]].get(k)
        if cur is None or (r["rarity"] or 0) < cur:
            jewels[r["skill_id"]][k] = r["rarity"]

    out = []
    for s in skills:
        sid = s["id"]
        secret = s["secret"] or 0
        in_sets = sid in ranks_by_skill
        in_gear = sid in armor_ids or sid in deco_ids or sid in charm_ids
        out.append({
            "id": sid,
            "name": _skill_name(s),
            "name_es": s["name_es"],
            "name_en": s["name_en"],
            "description": s["description_es"] or s["description_en"],
            "icon_color": s["icon_color"],
            "max_level": s["max_level"],
            "secret": secret,
            "cap": (s["max_level"] or 0) - secret,
            "unlocks_skill_id": unlocks_id.get(sid),
            "unlocked_by": [
                {"bonus_id": r["bonus_id"], "name_es": r["bonus_es"] or r["bonus_en"], "required": r["required"],
                 "via": "secret"}
                for sec in secret_for.get(sid, []) for r in ranks_by_skill.get(sec, [])]
                + ([{"bonus_id": r["bonus_id"], "name_es": r["bonus_es"] or r["bonus_en"], "required": r["required"],
                     "via": "inheritance"}
                    for r in ranks_by_skill.get(inherit_id, [])] if secret and inherit_id is not None else []),
            "set_bonus_only": in_sets and not in_gear,
            "set_bonuses": [{"bonus_id": r["bonus_id"], "name_es": r["bonus_es"] or r["bonus_en"],
                             "required": r["required"]}
                            for r in ranks_by_skill.get(sid, [])],
            "jewels": [{"size": size, "level": level, "double": double, "min_rarity": mr}
                       for (size, level, double), mr in sorted(
                           jewels.get(sid, {}).items(),
                           key=lambda kv: (kv[0][0] or 0, kv[0][2], kv[0][1] or 0))],
            "charm_max_level": charm_max.get(sid),
            "armor_pieces": dict(armor_counts.get(sid, {"LR": 0, "HR": 0, "MR": 0})),
        })
    _cache[key] = out
    return out


def _set_rows(rank: str | None, bonus_id: int | None = None) -> list[dict]:
    return all_("""
      SELECT s.id, s.name_es, s.rank, s.monster_id, s.bonus_id,
             (SELECT max(a.rarity) FROM armor a WHERE a.armor_set_id = s.id) rarity_max
      FROM armor_sets s
      WHERE s.bonus_id IS NOT NULL AND (? IS NULL OR s.rank = ?) AND (? IS NULL OR s.bonus_id = ?)
      ORDER BY s.bonus_id, s.id""", (rank, rank, bonus_id, bonus_id))


def _bonus_ranks() -> dict[int, list[dict]]:
    skill_rows = {r["id"]: r for r in all_("SELECT id, name_en, name_es, description_en, description_es FROM skills")}
    unlocks = {r["id"]: r["unlocks"] for r in all_("SELECT id, unlocks FROM skills WHERE unlocks IS NOT NULL")}
    by_name = {r["name_en"]: r["id"] for r in all_("SELECT id, name_en FROM skills")}
    inherit_id = by_name.get("Inheritance")
    out: dict[int, list[dict]] = defaultdict(list)
    for r in all_("SELECT bonus_id, skill_id, required FROM armor_set_bonus_ranks ORDER BY bonus_id, rowid"):
        sk = skill_rows.get(r["skill_id"], {})
        base = by_name.get(unlocks[r["skill_id"]]) if r["skill_id"] in unlocks else None
        out[r["bonus_id"]].append({
            "required": r["required"],
            "skill_id": r["skill_id"],
            "skill_es": _skill_name(sk),
            "skill_name": _skill_name(sk),
            "skill_desc": sk.get("description_es") or sk.get("description_en"),
            "unlocks_skill_id": base,
            "unlocks_es": _skill_name(skill_rows[base]) if base is not None else None,
            "unlocks_all": r["skill_id"] == inherit_id,   # Inheritance: opens the secret level of every skill
        })
    return out


@router.get("/api/set-bonuses")
def set_bonuses_list(rank: RankQ = None):
    key = ("set-bonuses", rank)
    if key in _cache:
        return _cache[key]
    bonuses = all_("SELECT id, name_en, name_es FROM armor_set_bonuses ORDER BY id")
    ranks = _bonus_ranks()
    sets: dict[int, list[dict]] = defaultdict(list)
    for s in _set_rows(rank):
        sets[s["bonus_id"]].append({"id": s["id"], "name_es": s["name_es"], "rank": s["rank"],
                                    "rarity_max": s["rarity_max"], "monster_id": s["monster_id"]})
    out = []
    for b in bonuses:
        bsets = sets.get(b["id"], [])
        if rank is not None and not bsets:
            continue
        out.append({**b, "name": b["name_es"] or b["name_en"],
                    "monster_id": bsets[0]["monster_id"] if bsets else None,
                    "ranks": ranks.get(b["id"], []), "sets": bsets})
    _cache[key] = out
    return out


@router.get("/api/set-bonuses/{bonus_id}")
def set_bonus_detail(bonus_id: Annotated[int, PathParam(ge=1, le=1_000_000)], rank: RankQ = None):
    key = ("set-bonus", bonus_id, rank)
    if key in _cache:
        return _cache[key]
    b = all_("SELECT id, name_en, name_es FROM armor_set_bonuses WHERE id = ?", (bonus_id,))
    sets = _set_rows(rank, bonus_id)
    if not b or not sets:
        raise HTTPException(404, "No se encontró el bono de set")
    set_ids = [s["id"] for s in sets]
    marks = ",".join("?" * len(set_ids))
    pieces = all_(f"""SELECT a.id, a.name_es, a.rarity, a.type, a.slot_1, a.slot_2, a.slot_3, a.defense_max
                      FROM armor a WHERE a.armor_set_id IN ({marks}) AND (? IS NULL OR a.rank = ?)
                      ORDER BY a.id""", (*set_ids, rank, rank))
    skills: dict[int, list] = defaultdict(list)
    piece_ids = [p["id"] for p in pieces]
    if piece_ids:
        pm = ",".join("?" * len(piece_ids))
        for r in all_(f"""SELECT ak.armor_id, s.id skill_id, s.name_es, ak.level FROM armor_skills ak
                          JOIN skills s ON s.id = ak.skill_id WHERE ak.armor_id IN ({pm}) ORDER BY ak.rowid""",
                      tuple(piece_ids)):
            skills[r["armor_id"]].append({"skill_id": r["skill_id"], "name_es": r["name_es"], "level": r["level"]})
    by_slot: dict[str, list] = {slot: [] for slot in PIECE_SLOTS}
    for p in pieces:
        if p["type"] not in by_slot:
            continue
        by_slot[p["type"]].append({
            "id": p["id"], "name_es": p["name_es"], "rarity": p["rarity"],
            "slots": [v for v in (p["slot_1"], p["slot_2"], p["slot_3"]) if v],
            "skills": skills.get(p["id"], []), "defense_max": p["defense_max"]})
    out = {"id": b[0]["id"], "name_en": b[0]["name_en"], "name_es": b[0]["name_es"],
           "name": b[0]["name_es"] or b[0]["name_en"],
           "monster_id": sets[0]["monster_id"],
           "ranks": _bonus_ranks().get(bonus_id, []),
           "sets": [{"id": s["id"], "name_es": s["name_es"], "rank": s["rank"],
                     "rarity_max": s["rarity_max"], "monster_id": s["monster_id"]} for s in sets],
           "pieces": by_slot}
    _cache[key] = out
    return out
