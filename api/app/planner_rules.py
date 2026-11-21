"""Reglas y plantillas del planificador: arquetipos por arma, estilos de juego y plantilla de objetivos.

GET /api/builds/plan/rules     -> research/builds/planner_rules.json con nombres resueltos a ids del catalogo.
GET /api/builds/plan/template  -> objetivos por tiers (monstruo | objetivo recoleccion/botin) mezclados con un
                                  arquetipo y estilos de juego. Reutiliza los perfiles y las recomendaciones
                                  cacheadas de builds.py; no duplica el motor.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from . import builds, settings

log = logging.getLogger("planner_rules")
router = APIRouter(prefix="/api/builds/plan")

_lock = threading.Lock()
_cache: dict = {}
MAX_LEVEL_FALLBACK_CURVE = 0.6
_ORIGIN_ES = {"monster": "monstruo", "goal": "objetivo"}


def _rules_file() -> Path:
    p = settings.RESEARCH_DIR / "builds" / "planner_rules.json"
    if not p.is_file():
        raise HTTPException(503, "No se encontró research/builds/planner_rules.json")
    return p


def _raw() -> dict:
    p = _rules_file()
    mtime = p.stat().st_mtime_ns
    with _lock:
        if _cache.get("mtime") != mtime:
            _cache["raw"] = json.loads(p.read_text(encoding="utf-8"))
            _cache["mtime"] = mtime
            _cache.pop("resolved", None)
        return _cache["raw"]


def _skill_ref(D: dict, name: str, ctx: str) -> dict | None:
    sid = D["skill_by_name"].get(name)
    if sid is None:
        log.warning("planner_rules: habilidad desconocida %r (%s); se omite", name, ctx)
        return None
    return {"skill_id": sid, "name_en": name, "name_es": D["skills"][sid]["name_es"], "max_level": D["skills"][sid]["max_level"]}


def _resolve_entry(D: dict, e: dict, ctx: str) -> dict | None:
    ref = _skill_ref(D, e["skill"], ctx)
    if ref is None:
        return None
    out = {**e, **ref}
    if "level" in e:
        out["level"] = min(int(e["level"]), ref["max_level"])
    return out


def _bonus_refs(D: dict, names: list[str], ctx: str) -> list[dict]:
    by_name = {b["name_en"]: b for b in D["bonuses"].values()}
    out = []
    for n in names:
        b = by_name.get(n)
        if b is None:
            log.warning("planner_rules: bonus de set desconocido %r (%s); se omite", n, ctx)
            continue
        out.append({"bonus_id": b["id"], "name_en": n, "name_es": b["name_es"] or n})
    return out


def _resolved() -> dict:
    raw = _raw()
    D = builds._load()
    key = (_cache.get("mtime"), D["data_sig"])
    with _lock:
        if _cache.get("resolved") and _cache["resolved"][0] == key:
            return _cache["resolved"][1]
    out = {k: v for k, v in raw.items() if k not in ("archetypes", "play_styles")}
    archs = {}
    for aid, a in raw["archetypes"].items():
        r = {k: v for k, v in a.items() if k not in ("skills", "discard", "requires_bonus_any")}
        r["skills"] = [x for x in (_resolve_entry(D, e, f"archetype {aid}") for e in a["skills"]) if x]
        r["discard"] = [x for x in (_resolve_entry(D, e, f"archetype {aid} discard") for e in a.get("discard", [])) if x]
        if "requires_bonus_any" in a:
            r["requires_bonus_any"] = _bonus_refs(D, a["requires_bonus_any"], f"archetype {aid}")
        archs[aid] = r
    styles = {}
    for sid, s in raw["play_styles"].items():
        r = {k: v for k, v in s.items() if k != "add"}
        r["add"] = [x for x in (_resolve_entry(D, e, f"style {sid}") for e in s["add"]) if x]
        styles[sid] = r
    out["archetypes"], out["play_styles"] = archs, styles
    with _lock:
        _cache["resolved"] = (key, out)
    return out


@router.get("/rules")
def plan_rules():
    return _resolved()


# ------------------------------------------------------------------ template
def _tier_from_weight(w: float, ailment: bool) -> int:
    t = 1 if w >= 6 else 2 if w >= 3 else 3
    return min(t, 2) if ailment else t


def _curve_level(curve: list, max_level: int) -> int:
    for i, v in enumerate(curve):
        if i and v >= MAX_LEVEL_FALLBACK_CURVE:
            return min(i, max_level)
    return max(1, min(len(curve) - 1, max_level))


def _objective_targets(D: dict, prof: dict, rec: dict | None) -> list[dict]:
    rec_levels = {}
    if rec and rec.get("available") and rec.get("builds"):
        rec_levels = {s["skill_id"]: s["level"] for s in rec["builds"][0]["skills"]}
    out = []
    for sid, e in prof["weights"].items():
        if e["w"] < 1:
            continue
        s = D["skills"][sid]
        lvl = rec_levels.get(sid) or _curve_level(e["curve"], s["max_level"])
        why = e["why"][0] if e["why"] else (D["rules"]["skills"].get(s["name_en"], {}).get("reason_es") or
                                              (prof.get("goal_rules", {}).get("weights", {}).get(s["name_en"], {}).get("reason_es")) or "")
        out.append({"skill_id": sid, "name_es": s["name_es"], "level": int(lvl), "tier": _tier_from_weight(e["w"], bool(e["why"])),
                    "why_es": why, "_w": e["w"]})
    out.sort(key=lambda t: (t["tier"], -t["_w"]))
    return out


def _merge(D: dict, acc: dict, items: list[dict], origin: str) -> None:
    for it in items:
        sid = it["skill_id"]
        lvl = min(int(it["level"]), D["skills"][sid]["max_level"])
        cur = acc.get(sid)
        if cur is None:
            acc[sid] = {"skill_id": sid, "name_es": D["skills"][sid]["name_es"], "level": lvl, "tier": it["tier"],
                        "why_es": it.get("why_es", ""), "origin": [origin]}
            continue
        if it["tier"] < cur["tier"]:
            cur["tier"] = it["tier"]
            if it.get("why_es"):
                cur["why_es"] = it["why_es"]
        cur["level"] = max(cur["level"], lvl)
        if origin not in cur["origin"]:
            cur["origin"].append(origin)


def _bonus_suggestion(D: dict, rules: dict, arch: dict | None, targets: list[dict]) -> dict | None:
    over = [t for t in targets if t["level"] > D["skills"][t["skill_id"]]["cap"]]
    if not over:
        return None
    if arch and arch.get("requires_bonus_any"):
        names = [b["name_es"] for b in arch["requires_bonus_any"]]
        return {"bonus_ids": [b["bonus_id"] for b in arch["requires_bonus_any"]],
                "names_es": names,
                "reason_es": "Para llegar a " + ", ".join(f"{t['name_es']} {t['level']}" for t in over)
                             + " hace falta un bonus de set que levante el límite: " + " o ".join(names) + "."}
    ids, names = [], []
    need = {t["skill_id"] for t in over}
    for b in D["bonuses"].values():
        for _req, sk in b["ranks"]:
            if sk == D["unlock_all"] or D["unlocks"].get(sk) in need:
                if b["id"] not in ids:
                    ids.append(b["id"])
                    names.append(b["name_es"] or b["name_en"])
    if not ids:
        return None
    return {"bonus_ids": ids, "names_es": names,
            "reason_es": "Hay habilidades por encima de su límite normal (" + ", ".join(t["name_es"] for t in over)
                         + "); necesitas uno de estos bonus de set."}


@router.get("/template")
def plan_template(monster: int | None = Query(None, ge=0, le=1_000_000),
                  goal: Literal["recoleccion", "botin"] | None = None,
                  rank: Literal["LR", "HR", "MR", "lr", "hr", "mr"] = "HR",
                  cap: Literal["progress", "full"] = "progress",
                  archetype: str | None = Query(None, max_length=40, pattern=r"^[a-z_]*$"),
                  styles: str | None = Query(None, max_length=120, pattern=r"^[a-z_,]*$")):
    if monster is not None and goal is not None:
        raise HTTPException(422, "Indica monster o goal, no ambos")
    rules = _resolved()
    arch = None
    if archetype:
        arch = rules["archetypes"].get(archetype)
        if arch is None:
            raise HTTPException(422, "archetype no válido")
    style_ids = [s for s in (styles or "").split(",") if s]
    for s in style_ids:
        if s not in rules["play_styles"]:
            raise HTTPException(422, "styles contiene un valor no válido")
    if monster is None and goal is None and arch is None and not style_ids:
        raise HTTPException(422, "Indica monster, goal, archetype o styles")

    D = builds._load()
    rank = rank.upper()
    acc: dict = {}
    notes: list[str] = []
    objective: dict = {"type": "archetype", "rank": rank}
    if monster is not None:
        m = D["monsters"].get(monster)
        if not m:
            raise HTTPException(404, "No se encontró el monstruo")
        prof = builds._monster_profile(D, m)
        rec = builds.monster_builds(monster, rank, 0, cap, None)
        objective = {"type": "monster", "monster_id": monster, "name_es": prof["name"], "rank": rank, "cap": cap}
        notes += prof["notes"] + list(rec.get("notes", []))
        _merge(D, acc, _objective_targets(D, prof, rec), "monster")
    elif goal is not None:
        prof = builds._goal_profile(D, goal)
        rec = builds.goal_builds(goal, rank, 0, cap, None)
        objective = {"type": "goal", "goal": goal, "name_es": prof["name"], "rank": rank, "cap": cap}
        notes += prof["notes"]
        _merge(D, acc, _objective_targets(D, prof, rec), "goal")
    discard: list[dict] = []
    if arch:
        _merge(D, acc, arch["skills"], "archetype")
        discard = [{"skill_id": d["skill_id"], "name_es": d["name_es"], "why_es": d["why_es"]} for d in arch["discard"]]
        if arch.get("notes_es"):
            notes.append(arch["notes_es"])
    for s in style_ids:
        _merge(D, acc, rules["play_styles"][s]["add"], f"style:{s}")
    # an explicit discard hint from the archetype must not coexist with a target of the same skill
    dropped = {d["skill_id"] for d in discard}
    clash = [t for t in acc.values() if t["skill_id"] in dropped]
    if clash:
        notes.append("Aviso: " + ", ".join(t["name_es"] for t in clash) + " aparece como objetivo pero el arquetipo lo descarta.")
    targets = sorted(acc.values(), key=lambda t: (t["tier"], -t["level"], t["name_es"]))
    for t in targets:
        t["origin"] = "+".join(t["origin"])
    return {"objective": objective, "targets": targets, "set_bonus_suggestion": _bonus_suggestion(D, rules, arch, targets),
            "discard_hints": discard, "notes_es": notes}
