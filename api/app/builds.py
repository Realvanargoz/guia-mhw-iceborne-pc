"""Solo-survival build recommender and skill evaluator.

- evaluate(): exact skill calculator for a loadout (armor skill points, set bonuses counted per bonus across
  alpha/beta/HR/MR pieces, secret skills raising caps, charm, decorations checked against slot sizes, defense
  and elemental resistances including the resistance / Defense Boost skills).
- recommend(): rule-based search for the safest solo set against one monster at one rank. Weights come from
  research/builds/solo_rules.json (each rule carries sources) plus the monster's ailments (MHWorldData) and
  per-monster overrides. Search = per-slot pruning + beam search over the five armor slots + charm choice +
  greedy decoration allocation by marginal score (smallest fitting slot). Pure Python, no extra deps.

Results are computed live (well under 2 s, memoised in-process). POST /api/builds/rebuild (manual only)
reloads data/rules and stores every monster x rank in build_recommendations (user.db), which GET serves while
the rules and the data signature still match.
"""
from __future__ import annotations

import hashlib
import logging
import json
import os
import threading
import time
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi import Path as PathParam
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from . import settings

_log = logging.getLogger(__name__)
from .db import J, all_, execute, now, one, transaction
from .validation import no_control_chars

router = APIRouter()
_b = APIRouter(prefix="/api/builds")
_c = APIRouter(prefix="/api")

SLOTS = ("head", "chest", "arms", "waist", "legs")
SLOT_ES = {"head": "cabeza", "chest": "torso", "arms": "brazos", "waist": "cintura", "legs": "piernas",
           "weapon": "arma", "charm": "amuleto"}
ELEMENTS = ("fire", "water", "thunder", "ice", "dragon")
ELEMENT_ES = {"fire": "fuego", "water": "agua", "thunder": "rayo", "ice": "hielo", "dragon": "dragón"}
RANKS = ("LR", "HR", "MR")
DISCLAIMER_ES = ("Sugerencia basada en reglas para sobrevivir cazando en solitario, no la única forma correcta. "
                 "Cambia piezas o joyas con libertad para pegar más fuerte o romper más partes; el evaluador "
                 "recalcula las habilidades al momento. No tiene en cuenta tu arma ni tu estilo de juego.")
BEAM = 220
PER_SLOT = 22
FINAL_STATES = 36
CHARMS_TRIED = 2

# Bump when the engine logic changes so cached results are invalidated (the module source is no longer hashed).
RULES_VERSION = 1

_lock = threading.Lock()
_cache: dict = {}


# ------------------------------------------------------------------ loading
def _rules_path() -> Path:
    cands = [settings.BUILD_RULES_PATH, str(settings.RESEARCH_DIR / "builds" / "solo_rules.json")]
    for c in cands:
        if c and Path(c).is_file():
            return Path(c)
    raise HTTPException(503, "No se encontró research/builds/solo_rules.json (¿falta el volumen /research en la API?)")


def ensure_tables() -> None:
    """No-op: userdb.migrate() creates build_recommendations and saved_builds."""
    return None


def _load() -> dict:
    with _lock:
        if _cache.get("data"):
            return _cache["data"]
        t0 = time.perf_counter()
        raw = _rules_path().read_bytes()
        rules = json.loads(raw)
        skills = {r["id"]: r for r in all_("SELECT id, name_en, name_es, max_level, secret, unlocks FROM skills")}
        by_name = {s["name_en"]: sid for sid, s in skills.items()}
        for s in skills.values():
            s["name_es"] = s["name_es"] or s["name_en"]
            s["cap"] = (s["max_level"] or 1) - (s["secret"] or 0)
        # secret skill id -> base skill id it unlocks
        unlocks = {sid: by_name[s["unlocks"]] for sid, s in skills.items() if s["unlocks"] in by_name}

        armor = {}
        for r in all_("""SELECT a.id, a.name_en, a.name_es, a.rarity, a.type, a.rank, a.armor_set_id, a.slot_1, a.slot_2,
                                a.slot_3, a.defense_base, a.defense_max, a.defense_augment_max, a.res_fire, a.res_water,
                                a.res_thunder, a.res_ice, a.res_dragon, s.name_en set_en, s.name_es set_es, s.bonus_id,
                                s.monster_id set_monster
                         FROM armor a LEFT JOIN armor_sets s ON s.id = a.armor_set_id ORDER BY a.id"""):
            r["slots"] = sorted([x for x in (r.pop("slot_1"), r.pop("slot_2"), r.pop("slot_3")) if x], reverse=True)
            r["res"] = {e: r.pop(f"res_{e}") or 0 for e in ELEMENTS}
            r["skills"] = {}
            armor[r["id"]] = r
        for r in all_("SELECT armor_id, skill_id, level FROM armor_skills"):
            if r["armor_id"] in armor:
                armor[r["armor_id"]]["skills"][r["skill_id"]] = r["level"]

        bonuses = {r["id"]: {**r, "ranks": []} for r in all_("SELECT id, name_en, name_es FROM armor_set_bonuses")}
        for r in all_("SELECT bonus_id, skill_id, required FROM armor_set_bonus_ranks ORDER BY required"):
            bonuses[r["bonus_id"]]["ranks"].append((r["required"], r["skill_id"]))

        decos = {r["id"]: {**r, "skills": {}} for r in all_("SELECT id, name_en, name_es, slot, rarity FROM decorations ORDER BY id")}
        for r in all_("SELECT decoration_id, skill_id, level FROM decoration_skills"):
            decos[r["decoration_id"]]["skills"][r["skill_id"]] = r["level"]
        charms = {r["id"]: {**r, "skills": {}} for r in all_("SELECT id, name_en, name_es, rarity FROM charms ORDER BY id")}
        for r in all_("SELECT charm_id, skill_id, level FROM charm_skills"):
            charms[r["charm_id"]]["skills"][r["skill_id"]] = r["level"]

        monsters = {r["id"]: r for r in all_("""
            SELECT m.id, m.name_en, m.name_es, m.size, a.data ailments,
                   (SELECT json_group_array(x) FROM (SELECT rank x FROM monster_rewards WHERE monster_id = m.id
                         UNION SELECT q.rank FROM quest_monsters qm JOIN quests q ON q.id = qm.quest_id
                         WHERE qm.monster_id = m.id) z WHERE x IS NOT NULL) AS "ranks [JSON]",
                   (SELECT count(*) FROM monster_breaks b WHERE b.monster_id = m.id) breaks
            FROM monsters m LEFT JOIN monster_ailments a ON a.monster_id = m.id""")}
        weak = {}
        for r in all_("SELECT monster_id, fire, water, thunder, ice, dragon FROM monster_weaknesses ORDER BY id"):
            weak.setdefault(r["monster_id"], r)
        own_set_rarity: dict = {}
        for a in armor.values():
            if a["set_monster"]:
                k = (a["set_monster"], a["rank"])
                own_set_rarity[k] = max(own_set_rarity.get(k, 0), a["rarity"] or 0)
        sig_row = one("""SELECT (SELECT count(*) || ':' || coalesce(sum(id), 0) FROM armor) || '|' ||
                                (SELECT count(*) FROM armor_skills) || '|' || (SELECT count(*) FROM decorations) || '|' ||
                                (SELECT count(*) FROM charms) || '|' || (SELECT count(*) FROM monster_ailments) AS s""")
        data = {
            "rules": rules, "rules_hash": hashlib.sha256(str(RULES_VERSION).encode() + raw).hexdigest()[:16],  # engine version + rules
            "data_sig": hashlib.sha256(sig_row["s"].encode()).hexdigest()[:16],
            "skills": skills, "skill_by_name": by_name, "unlocks": unlocks, "armor": armor, "bonuses": bonuses,
            "decos": decos, "charms": charms, "monsters": monsters, "weak": weak, "own_set_rarity": own_set_rarity,
            "load_ms": round((time.perf_counter() - t0) * 1000),
        }
        _cache.clear()
        _cache["data"] = data
        _cache["memo"] = {}
        return data


def reset_cache() -> None:
    with _lock:
        _cache.clear()


# ------------------------------------------------------------------ skill math (shared)
def _add(points: dict, skills: dict, mult: int = 1) -> None:
    for sid, lv in skills.items():
        points[sid] = points.get(sid, 0) + lv * mult


def _set_bonus_skills(D: dict, bonus_counts: dict) -> list[dict]:
    out = []
    for bid, n in bonus_counts.items():
        b = D["bonuses"].get(bid)
        if not b:
            continue
        for req, sid in b["ranks"]:
            out.append({"bonus_id": bid, "name_es": b["name_es"] or b["name_en"], "name_en": b["name_en"],
                        "skill_id": sid, "skill_es": D["skills"][sid]["name_es"], "skill_en": D["skills"][sid]["name_en"],
                        "required": req, "pieces": n, "active": n >= req})
    return out


def _levels(D: dict, points: dict, active_bonus_skills: set) -> dict:
    """skill id -> (effective level, cap, raw points)."""
    out = {}
    unlocked = {D["unlocks"][s] for s in active_bonus_skills if s in D["unlocks"]}
    for sid, p in points.items():
        s = D["skills"][sid]
        cap = s["max_level"] if sid in unlocked else s["cap"]
        out[sid] = (min(p, cap), cap, p)
    for sid in active_bonus_skills:
        if sid not in out:
            out[sid] = (1, 1, 1)
    return out


def _derived(D: dict, levels: dict, base_def: int, base_def_max: int, base_res: dict) -> tuple[dict, dict]:
    rules = D["rules"]["elemental_resistance_skills"]
    per = rules["per_level"]
    res = dict(base_res)
    dmax, dbase = base_def_max, base_def
    for e in ELEMENTS:
        sid = D["skill_by_name"].get(rules[e])
        lv = levels.get(sid, (0,))[0] if sid else 0
        if lv:
            res[e] += per[min(lv, len(per) - 1)]
            if lv >= 3:
                dmax += rules["lv3_defense"]
                dbase += rules["lv3_defense"]
    db = levels.get(D["skill_by_name"].get("Defense Boost"), (0,))[0]
    flat = [0, 5, 10, 10, 20, 20, 35, 35][db]
    pct = [0, 0, 0, 5, 5, 8, 8, 10][db]
    resb = [0, 0, 0, 0, 3, 3, 5, 5][db]
    dmax = round(dmax * (1 + pct / 100)) + flat
    dbase = round(dbase * (1 + pct / 100)) + flat
    for e in ELEMENTS:
        res[e] += resb
    return {"base": dbase, "max": dmax}, res


# ------------------------------------------------------------------ evaluate
def _fit(slots: list[tuple[str, int]], deco_sizes: list[tuple[int, object]]):
    """Place decorations (largest first) into the smallest free slot that fits. Returns placed, unplaced, free."""
    free = sorted(slots, key=lambda s: s[1])
    placed, unplaced = [], []
    for size, ref in sorted(deco_sizes, key=lambda d: -d[0]):
        idx = next((i for i, s in enumerate(free) if s[1] >= size), None)
        if idx is None:
            unplaced.append(ref)
        else:
            placed.append((free.pop(idx), ref))
    return placed, unplaced, free


def evaluate_loadout(pieces: dict, decorations: list, weapon_slots: list[int] | None = None) -> dict:
    D = _load()
    warnings: list[str] = []
    chosen = {}
    for slot in SLOTS:
        aid = pieces.get(slot)
        if aid is None:
            continue
        a = D["armor"].get(int(aid))
        if not a:
            warnings.append(f"La pieza {aid} no existe")
            continue
        if a["type"] != slot:
            warnings.append(f"{a['name_es'] or a['name_en']} es de {SLOT_ES.get(a['type'], a['type'])}, no de {SLOT_ES[slot]}")
        chosen[slot] = a
    charm = None
    if pieces.get("charm") is not None:
        charm = D["charms"].get(int(pieces["charm"]))
        if not charm:
            warnings.append(f"El amuleto {pieces['charm']} no existe")

    points: dict = {}
    sources: dict = {}
    bonus_counts: dict = {}
    base_def = base_max = base_aug = 0
    res = {e: 0 for e in ELEMENTS}
    slot_list: list[tuple[str, int]] = []
    for slot, a in chosen.items():
        _add(points, a["skills"])
        for sid, lv in a["skills"].items():
            sources.setdefault(sid, []).append({"from": slot, "id": a["id"], "name_es": a["name_es"] or a["name_en"], "points": lv})
        if a["bonus_id"]:
            bonus_counts[a["bonus_id"]] = bonus_counts.get(a["bonus_id"], 0) + 1
        base_def += a["defense_base"] or 0
        base_max += a["defense_max"] or 0
        base_aug += a["defense_augment_max"] or a["defense_max"] or 0
        for e in ELEMENTS:
            res[e] += a["res"][e]
        slot_list += [(slot, s) for s in a["slots"]]
    for s in weapon_slots or []:
        if 1 <= int(s) <= 4:
            slot_list.append(("weapon", int(s)))
        else:
            warnings.append(f"Ranura de arma {s} no válida (1-4)")
    if charm:
        _add(points, charm["skills"])
        for sid, lv in charm["skills"].items():
            sources.setdefault(sid, []).append({"from": "charm", "id": charm["id"], "name_es": charm["name_es"] or charm["name_en"], "points": lv})

    # decorations: [id] or [{"id":..,"piece":..}]
    explicit, auto = [], []
    for d in decorations or []:
        did, piece = (d.get("id") or d.get("decoration_id"), d.get("piece")) if isinstance(d, dict) else (d, None)
        deco = D["decos"].get(int(did)) if did is not None else None
        if not deco:
            warnings.append(f"La joya {did} no existe")
            continue
        (explicit if piece else auto).append((deco, piece))
    placements = []
    free = list(slot_list)
    for deco, piece in explicit:
        cand = sorted([s for s in free if s[0] == piece and s[1] >= deco["slot"]], key=lambda s: s[1])
        if not cand:
            warnings.append(f"{deco['name_es'] or deco['name_en']} (tamaño {deco['slot']}) no cabe en {SLOT_ES.get(piece, piece)}")
            continue
        free.remove(cand[0])
        placements.append((cand[0], deco))
    placed, unplaced, free = _fit(free, [(d["slot"], d) for d, _ in auto])
    placements += placed
    for d in unplaced:
        warnings.append(f"{d['name_es'] or d['name_en']} (tamaño {d['slot']}) no cabe: no quedan ranuras libres de ese tamaño")
    for (piece, size), deco in placements:
        _add(points, deco["skills"])
        for sid, lv in deco["skills"].items():
            sources.setdefault(sid, []).append({"from": "decoration", "piece": piece, "id": deco["id"],
                                                "name_es": deco["name_es"] or deco["name_en"], "points": lv})

    sb = _set_bonus_skills(D, bonus_counts)
    active = {b["skill_id"] for b in sb if b["active"]}
    lv = _levels(D, points, active)
    defense, res_total = _derived(D, lv, base_def, base_max, res)
    defense["augment_max"] = _derived(D, lv, 0, base_aug, res)[0]["max"]
    defense["note_es"] = "base = sin mejorar; max = mejorada al máximo; augment_max = con aumentos de defensa (lo que Kiranico llama máximo)."
    skills_out = []
    for sid, (level, cap, raw) in sorted(lv.items(), key=lambda kv: (-kv[1][0], D["skills"][kv[0]]["name_es"])):
        s = D["skills"][sid]
        src = sources.get(sid, [])
        if sid in active:
            src = src + [{"from": "set_bonus", "name_es": next(b["name_es"] for b in sb if b["skill_id"] == sid and b["active"])}]
        if raw > cap:
            warnings.append(f"{s['name_es']}: {raw} puntos, pero el máximo es {cap} (sobran {raw - cap})")
        skills_out.append({"skill_id": sid, "name_es": s["name_es"], "name_en": s["name_en"], "level": level,
                           "points": raw, "max": cap, "source": src})
    return {
        "pieces": {k: _piece_out(a) for k, a in chosen.items()},
        "charm": _charm_out(charm) if charm else None,
        "skills": skills_out,
        "set_bonuses": sb,
        "defense": defense,
        "resistances": res_total,
        "decorations": [{"piece": p, "slot_size": s, "decoration_id": d["id"], "name_es": d["name_es"] or d["name_en"],
                         "name_en": d["name_en"], "size": d["slot"]} for (p, s), d in placements],
        "slots_total": [{"piece": p, "size": s} for p, s in slot_list],
        "slots_used": len(placements),
        "slots_free": [{"piece": p, "size": s} for p, s in sorted(free, key=lambda x: (SLOTS + ("weapon",)).index(x[0]))],
        "warnings": warnings,
    }


def _piece_out(a: dict, owned: set | None = None) -> dict:
    out = {"id": a["id"], "type": a["type"], "name_es": a["name_es"] or a["name_en"], "name_en": a["name_en"],
           "set_id": a["armor_set_id"], "set_name_es": a["set_es"] or a["set_en"], "set_name_en": a["set_en"],
           "rarity": a["rarity"], "rank": a["rank"], "slots": a["slots"], "defense_base": a["defense_base"],
           "defense_max": a["defense_max"], "resistances": a["res"]}
    if owned is not None:
        out["owned"] = a["id"] in owned
    return out


def _charm_out(c: dict) -> dict:
    return {"id": c["id"], "name_es": c["name_es"] or c["name_en"], "name_en": c["name_en"], "rarity": c["rarity"],
            "skills": [{"skill_id": s, "level": l} for s, l in c["skills"].items()]}


# ------------------------------------------------------------------ monster profile
def _monster_profile(D: dict, m: dict) -> dict:
    rules = D["rules"]
    name = m["name_es"] or m["name_en"]
    notes: list[str] = []
    rule_sources: set = set()
    raw = m["ailments"]
    keys: list[str] = []
    if raw is None or raw == {}:
        notes.append(f"MHWorldData no tiene estados alterados para {name}; se usan las prioridades genéricas de supervivencia.")
    else:
        for k, v in raw.items():
            if k in ("roar", "wind", "tremor"):
                keys.append(f"{k}:{v}")
            elif k in rules["ignored_ailment_keys"]:
                continue
            elif v:
                keys.append(k)
    ov = rules["monster_overrides"].get(m["name_en"], {})
    for k in ov.get("add", []):
        if k not in keys and not (k.startswith("roar:") and any(x.startswith("roar:") for x in keys)):
            keys.append(k)
    if ov:
        rule_sources.update(ov.get("sources", []))
        if ov.get("note_es"):
            notes.append(ov["note_es"])

    weights: dict = {}   # skill id -> {"w","curve","why":[...]}
    def put(skill_name, w, curve=None, why=None, prefer_curve=False):
        sid = D["skill_by_name"].get(skill_name)
        if sid is None:
            return
        e = weights.setdefault(sid, {"w": 0.0, "curve": None, "why": []})
        e["w"] += w
        if curve and (prefer_curve or e["curve"] is None):
            e["curve"] = curve
        if why:
            e["why"].append(why)

    for sk, r in rules["skills"].items():
        if r["weight"] > 0:
            put(sk, r["weight"], r["curve"])
        elif r.get("curve"):
            put(sk, 0, r["curve"])
        rule_sources.update(r.get("sources", []))
    for k in keys:
        if k in rules["ailment_map"]:
            am = rules["ailment_map"][k]
            for s in am["skills"]:
                put(s["skill"], s["weight"], s.get("curve"), f"{name} {am['label_es']}", prefer_curve=True)
            rule_sources.update(am.get("sources", []))
    elements: dict = {}
    for k in keys:
        b = rules["blights"].get(k)
        if isinstance(b, dict):
            elements[b["element"]] = {"blight_weight": b["blight_weight"], "label_es": b["label_es"], "effect_es": b["effect_es"]}
            for x in b["extra"]:
                put(x["skill"], x["weight"], None, f"{b['effect_es']} ({name} {b['label_es']})")
            rule_sources.update(rules["blights"]["sources"])
    if elements:
        put("Blight Resistance", 0, rules["skills"]["Blight Resistance"]["curve"])
    for sk, w in ov.get("boost", {}).items():
        put(sk, w, None, f"recomendado expresamente contra {name}")
    for sid in list(weights):
        if weights[sid]["curve"] is None:
            weights[sid]["curve"] = [0] + [1.0] * D["skills"][sid]["max_level"]
    offense = {}
    for sk, r in rules["offense_skills"].items():
        if isinstance(r, dict) and sk in D["skill_by_name"]:
            offense[D["skill_by_name"][sk]] = (r["weight"], r["max"])
    return {"keys": keys, "weights": weights, "elements": elements, "notes": notes, "offense": offense,
            "rule_sources": rule_sources, "name": name}


class Scorer:
    def __init__(self, D: dict, prof: dict, def_ref: float):
        self.D, self.prof = D, prof
        sc = D["rules"]["scoring"]
        self.el = sc["element"]
        self.def_w = sc["defense_weight"]
        self.off_w = sc["offense_tiebreak"]
        self.def_ref = max(def_ref, 1)
        self.br = D["skill_by_name"]["Blight Resistance"]
        self.w = [(sid, e["w"], e["curve"], D["skills"][sid]["cap"], D["skills"][sid]["max_level"])
                  for sid, e in prof["weights"].items()]
        # base skills whose cap a set-bonus secret raises
        self.unlock_for = {}
        for sec, base in D["unlocks"].items():
            self.unlock_for[base] = sec
        self.relevant = set(prof["weights"]) | set(prof["offense"]) | set(self._res_skills()) | {D["skill_by_name"]["Defense Boost"]}
        self.max_total = sum(w for _, w, *_ in self.w) + self.def_w + sum(
            self.el["damage_weight"] + v["blight_weight"] for v in prof["elements"].values())
        self.off_total = sum(w for w, _ in prof["offense"].values()) or 1
        self.complex = set(self._res_skills()) | {D["skill_by_name"]["Defense Boost"], self.br}
        self.simple = {sid: (w, curve) for sid, w, curve, *_ in self.w if w > 0 and sid not in self.complex}

    def _res_skills(self):
        r = self.D["rules"]["elemental_resistance_skills"]
        return [self.D["skill_by_name"][r[e]] for e in ELEMENTS]

    def parts(self, points: dict, active: set, defmax: int, res: dict):
        lv = _levels(self.D, {k: v for k, v in points.items() if k in self.relevant or k in self.D["unlocks"]}, active)
        skill = 0.0
        for sid, w, curve, cap, mx in self.w:
            if w == 0:
                continue
            l = lv.get(sid, (0,))[0]
            if l:
                skill += w * curve[min(l, len(curve) - 1)]
        d, r = _derived(self.D, lv, 0, defmax, res)
        elem = 0.0
        brl = lv.get(self.br, (0,))[0]
        brc = self.prof["weights"].get(self.br, {}).get("curve") or [0, .5, .75, 1]
        for e, info in self.prof["elements"].items():
            v = max(self.el["clip_min"], min(self.el["clip_max"], r[e]))
            elem += self.el["damage_weight"] * v / self.el["clip_max"]
            blight = 1.0 if r[e] >= self.el["blight_threshold"] else brc[min(brl, 3)]
            elem += info["blight_weight"] * blight
        dfn = self.def_w * min(1.0, d["max"] / self.def_ref)
        off = 0.0
        for sid, (w, mx) in self.prof["offense"].items():
            l = lv.get(sid, (0,))[0]
            if l:
                off += w * min(l, mx) / mx
        return skill, elem, dfn, off, lv, d, r

    def caps(self, active: set) -> dict:
        unlocked = {self.D["unlocks"][x] for x in active if x in self.D["unlocks"]}
        return {sid: (mx if sid in unlocked else cap) for sid, _, _, cap, mx in self.w} | {
            sid: self.D["skills"][sid]["cap"] for sid in self.prof["offense"]}

    def contrib(self, sid: int, pts: int, caps: dict) -> float:
        """Score of one 'simple' skill at a raw point total (weighted curve + offense tiebreak)."""
        v = 0.0
        e = self.simple.get(sid)
        if e:
            w, curve = e
            l = min(pts, caps.get(sid, pts))
            if l:
                v += w * curve[min(l, len(curve) - 1)]
        o = self.prof["offense"].get(sid)
        if o:
            l = min(pts, caps.get(sid, pts), o[1])
            v += self.off_w * o[0] * l / o[1]
        return v

    def total(self, points, active, defmax, res) -> float:
        s, e, d, o, *_ = self.parts(points, active, defmax, res)
        return s + e + d + self.off_w * o


# ------------------------------------------------------------------ recommend
GOALS = {"recoleccion": "gathering_rules.json", "botin": "loot_rules.json"}


def _goal_rules(goal: str) -> dict:
    fname = GOALS[goal]
    cands = [str(settings.RESEARCH_DIR / "builds" / fname)]
    for c in cands:
        if Path(c).is_file():
            return json.loads(Path(c).read_text(encoding="utf-8"))
    raise HTTPException(503, f"No se encontró research/builds/{fname} (¿falta el volumen /research en la API?)")


def _goal_profile(D: dict, goal: str) -> dict:
    """Same shape as _monster_profile, but built from research/builds/<goal>_rules.json (no monster, no elements)."""
    gr = _goal_rules(goal)
    weights = {}
    for name, r in gr["weights"].items():
        sid = D["skill_by_name"].get(name)
        if sid is None:
            continue
        curve = r.get("curve") or [0] + [1.0] * D["skills"][sid]["max_level"]
        weights[sid] = {"w": float(r["weight"]), "curve": curve, "why": [r["reason_es"]] if r.get("reason_es") else []}
    return {"keys": [], "weights": weights, "elements": {}, "offense": {}, "notes": list(gr.get("notes_es", [])),
            "rule_sources": set(), "name": gr["label_es"], "goal_rules": gr}


def _band(D: dict, m: dict, rank: str, cap: str) -> dict:
    rr = D["rules"]["rank_rules"][rank]
    lo, hi = rr["armor_rarity"]
    own = D["own_set_rarity"].get((m["id"], rank))
    amax = hi if cap == "full" or not own else max(lo, min(hi, own))
    dr = rr.get("deco_rarity")
    clo, chi = rr["charm_rarity"]
    return {"armor": (lo, amax), "deco": tuple(dr) if dr else None, "charm": (clo, min(chi, amax)),
            "rare_from": rr.get("rare_deco_from"), "hard_from": rr.get("hard_deco_from"), "note_es": rr.get("note_es")}


def _progress_filter(D: dict, m: dict, rank: str, cap: str):
    """Armor filter for 'progress' mode in MR: no sets from later free title updates (see rules.progression)."""
    pr = D["rules"].get("progression") or {}
    tiers = {n: t["tier"] for t in pr.get("title_updates", []) for n in t["monsters"]}
    target = tiers.get(m["name_en"], 0)
    names = {mid: x["name_en"] for mid, x in D["monsters"].items()}
    active = cap != "full" and rank == pr.get("applies_to_rank", "MR")

    def tier(a):
        if a["set_en"] in pr.get("gamma_plus_sets", {}):
            return pr["gamma_plus_sets"][a["set_en"]]
        if a["set_monster"]:
            return tiers.get(names.get(a["set_monster"]), 0)
        if (a["rarity"] or 0) >= 12:
            return pr.get("monsterless_rarity12_tier", 0)
        return 0

    def allowed(a):
        ok = not active or tier(a) <= target
        if not ok:
            allowed.excluded = True
        return ok
    allowed.excluded = False
    return allowed


def _deco_difficulty(band: dict, rarity: int) -> str:
    if band["hard_from"] and rarity >= band["hard_from"]:
        return "difícil"
    if band["rare_from"] and rarity >= band["rare_from"]:
        return "rara"
    return "normal"


def _greedy_decos(sc: Scorer, points: dict, active: set, defmax: int, res: dict, slots: list, decos: list,
                  counts: dict | None, band: dict):
    """Greedy by marginal score. Skills that only add their own weighted curve are scored incrementally;
    decorations touching resistances / Defense Boost / Blight Resistance fall back to the full score."""
    points = dict(points)
    free = sorted(slots, key=lambda s: s[1])
    used: dict = {}
    placed = []
    caps = sc.caps(active)
    cur = sc.total(points, active, defmax, res)
    while free:
        best = None
        maxfree = free[-1][1]
        for d in decos:
            if d["slot"] > maxfree:
                continue
            if counts is not None and used.get(d["id"], 0) >= counts.get(d["id"], 0):
                continue
            if d["_complex"]:
                trial = dict(points)
                _add(trial, d["skills"])
                g = sc.total(trial, active, defmax, res) - cur
            else:
                g = 0.0
                for sid, lv in d["skills"].items():
                    p0 = points.get(sid, 0)
                    g += sc.contrib(sid, p0 + lv, caps) - sc.contrib(sid, p0, caps)
            if d["_hard"]:
                g *= 0.85
            g -= 0.001 * d["slot"]
            if g > 1e-6 and (best is None or g > best[0]):
                best = (g, d)
        if not best:
            break
        d = best[1]
        idx = next(i for i, s in enumerate(free) if s[1] >= d["slot"])
        placed.append((free.pop(idx), d))
        used[d["id"]] = used.get(d["id"], 0) + 1
        _add(points, d["skills"])
        cur = sc.total(points, active, defmax, res)
    return points, placed, free, cur


def owned_from_snapshot(snapshot: dict | None) -> dict | None:
    """Owned armor ids + decoration counts from the latest save snapshot, or None when it lacks the equipment box."""
    if not snapshot:
        return None
    slots = snapshot.get("slots") or []
    s = slots[0] if slots else None
    if not s or not isinstance(s.get("equipment"), dict):
        return None
    D = _load()
    by_name = {}
    for a in D["armor"].values():
        by_name.setdefault((a["name_en"] or "").strip().lower(), a["id"])
    armor_ids = set()
    for a in s["equipment"].get("armor") or []:
        aid = by_name.get((a.get("name_en") or "").strip().lower())
        if aid:
            armor_ids.add(aid)
    deco_by_name = {(d["name_en"] or "").strip().lower(): did for did, d in D["decos"].items()}
    deco_counts = {}
    for d in s.get("decorations") or []:
        did = deco_by_name.get((d.get("name_en") or "").strip().lower())
        if did:
            deco_counts[did] = deco_counts.get(did, 0) + int(d.get("count") or 0)
    return {"armor": armor_ids, "decorations": deco_counts, "charms": None}


def _latest_snapshot() -> dict | None:
    row = one("SELECT data FROM profile_snapshots ORDER BY taken_at DESC NULLS FIRST, id DESC NULLS FIRST LIMIT 1")
    return row["data"] if row else None


def recommend(monster_id: int, rank: str, owned: dict | None = None, cap: str = "progress",
              weapon_slots: list[int] | None = None, top: int = 3, goal: str | None = None) -> dict:
    t0 = time.perf_counter()
    D = _load()
    rank = rank.upper()
    if rank not in RANKS:
        raise HTTPException(422, "rank debe ser LR, HR o MR")
    if goal:
        # Objective profile (recoleccion / botin): a synthetic "monster" so the same engine runs unchanged.
        prof = _goal_profile(D, goal)
        m = {"id": -1, "name_en": goal, "name_es": prof["name"], "size": "large", "ranks": [rank], "ailments": None,
             "breaks": 0}
    else:
        m = D["monsters"].get(monster_id)
        if not m:
            raise HTTPException(404, "No se encontró el monstruo")
        prof = _monster_profile(D, m)
    band = _band(D, m, rank, cap)
    notes = list(prof["notes"])
    base = {"monster": {"id": m["id"], "name_es": prof["name"], "name_en": m["name_en"]}, "rank": rank, "cap": cap,
            "disclaimer_es": DISCLAIMER_ES, "owned_mode": owned is not None, "rules_version": D["rules"]["version"],
            "rules_hash": D["rules_hash"], "profile": {"ailments": prof["keys"], "elements": list(prof["elements"])},
            "constraints": {"armor_rarity": list(band["armor"]), "deco_rarity": list(band["deco"]) if band["deco"] else None,
                            "charm_rarity": list(band["charm"]), "weapon_slots": weapon_slots or []}}
    if m["size"] != "large":
        notes.append("Es un monstruo pequeño: las reglas están pensadas para monstruos grandes.")
    if rank not in (m["ranks"] or []):
        notes.append(f"{prof['name']} no aparece en {rank} según MHWorldData (misiones y recompensas); no se genera set.")
        alt = [x for x in D["monsters"].values() if x["id"] != m["id"] and x["size"] == "large" and rank in (x["ranks"] or [])
               and x["name_en"].endswith(" " + m["name_en"])]
        if alt:
            notes.append("Variante en " + rank + ": " + ", ".join(f"{a['name_es'] or a['name_en']} (id {a['id']})" for a in alt))
            base["related"] = [{"id": a["id"], "name_es": a["name_es"] or a["name_en"], "name_en": a["name_en"]} for a in alt]
        return {**base, "available": False, "builds": [], "notes": notes, "sources": _sources(D, prof["rule_sources"]),
                "elapsed_ms": round((time.perf_counter() - t0) * 1000)}
    if goal:
        notes.append("Perfil de equipo por objetivo (no por monstruo): " + prof["goal_rules"]["scope_es"])
        base["goal"] = goal
    elif cap != "full" and (m["id"], rank) not in D["own_set_rarity"]:
        notes.append(f"{prof['name']} no tiene set propio en {rank}: se permite toda la rareza del rango.")
    if band["note_es"]:
        notes.append(band["note_es"])
    if not weapon_slots:
        notes.append("No se cuentan las ranuras del arma (pásalas en weapon_slots o en el evaluador).")

    lo, hi = band["armor"]
    owned_armor = owned["armor"] if owned else None
    allowed = _progress_filter(D, m, rank, cap)
    pool = {s: [a for a in D["armor"].values() if a["type"] == s and a["rank"] == rank and lo <= (a["rarity"] or 0) <= hi
                and (owned_armor is None or a["id"] in owned_armor) and allowed(a)] for s in SLOTS}
    if allowed.excluded:
        notes.append(D["rules"]["progression"]["rule_es"])
    def_ref = sum(max([a["defense_max"] or 0 for a in D["armor"].values()
                       if a["type"] == s and a["rank"] == rank and lo <= (a["rarity"] or 0) <= hi] or [1]) for s in SLOTS)
    sc = Scorer(D, prof, def_ref)

    if band["deco"]:
        dlo, dhi = band["deco"]
        decos = [d for d in D["decos"].values() if dlo <= (d["rarity"] or 0) <= dhi
                 and any(s in sc.relevant for s in d["skills"])]
        if rank == "HR":
            decos = [d for d in decos if d["slot"] <= 3]
    else:
        decos = []
    dcounts = owned["decorations"] if owned else None
    if dcounts is not None:
        decos = [d for d in decos if dcounts.get(d["id"], 0) > 0]
    useful = {sid for sid, e in prof["weights"].items() if e["w"] > 0} | set(prof["offense"]) | sc.complex
    uniq: dict = {}
    for d in sorted(decos, key=lambda d: (d["rarity"] or 0, d["id"])):
        rel = tuple(sorted((k, v) for k, v in d["skills"].items() if k in useful))
        if not rel:
            continue
        d = {**d, "_complex": any(k in sc.complex for k, _ in rel), "_hard": _deco_difficulty(band, d["rarity"]) == "difícil"}
        k = (d["slot"], rel)
        if dcounts is None:
            uniq.setdefault(k, d)       # equivalent jewels: keep the most common (lowest rarity)
        else:
            uniq[(k, d["id"])] = d
    decos = list(uniq.values())
    clo, chi = band["charm"]
    charms = [c for c in D["charms"].values() if clo <= (c["rarity"] or 0) <= chi and any(s in sc.relevant for s in c["skills"])]

    # slot value estimate: best single-deco gain from an empty build per slot size
    empty_total = sc.total({}, set(), 0, {e: 0 for e in ELEMENTS})
    slot_val = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
    for d in decos:
        g = sc.total(dict(d["skills"]), set(), 0, {e: 0 for e in ELEMENTS}) - empty_total
        for size in range(d["slot"], 5):
            slot_val[size] = max(slot_val[size], g)
    for size in (2, 3, 4):
        slot_val[size] = max(slot_val[size], slot_val[size - 1])
    slot_val = {k: v * 0.6 for k, v in slot_val.items()}   # diminishing returns once several slots compete

    def piece_value(a):
        pts = dict(a["skills"])
        v = sc.total(pts, set(), a["defense_max"] or 0, a["res"]) - empty_total
        return v + sum(slot_val[s] for s in a["slots"])

    valuable_bonus = set()
    for bid, b in D["bonuses"].items():
        for req, sid in b["ranks"]:
            w = prof["weights"].get(sid, {}).get("w", 0)
            base_sid = D["unlocks"].get(sid)
            if base_sid and prof["weights"].get(base_sid, {}).get("w", 0) > 0:
                w = max(w, 2.0)
            if w >= 2:
                valuable_bonus.add(bid)
    cands = {}
    for s in SLOTS:
        ranked = sorted(pool[s], key=piece_value, reverse=True)
        keep = ranked[:PER_SLOT]
        extra = [a for a in ranked[PER_SLOT:] if a["bonus_id"] in valuable_bonus][:8]
        cands[s] = keep + extra or [None]
        if owned_armor is not None:
            cands[s] = (keep + extra) + [None]

    def bonus_credit(counts):
        credit, active = 0.0, set()
        for bid, n in counts.items():
            for req, sid in D["bonuses"][bid]["ranks"]:
                if n >= req:
                    active.add(sid)
                elif bid in valuable_bonus:
                    credit += 1.5 * n / req
        return credit, active

    beam = [((), {}, {}, 0, {e: 0 for e in ELEMENTS}, [])]
    for s in SLOTS:
        nxt = []
        for combo, pts, counts, dmax, res, slots in beam:
            for a in cands[s]:
                if a is None:
                    nxt.append((combo + (None,), pts, counts, dmax, res, slots))
                    continue
                p2 = dict(pts)
                _add(p2, a["skills"])
                c2 = dict(counts)
                if a["bonus_id"]:
                    c2[a["bonus_id"]] = c2.get(a["bonus_id"], 0) + 1
                r2 = {e: res[e] + a["res"][e] for e in ELEMENTS}
                nxt.append((combo + (a,), p2, c2, dmax + (a["defense_max"] or 0), r2, slots + [(s, x) for x in a["slots"]]))
        scored = []
        for st in nxt:
            credit, active = bonus_credit(st[2])
            h = sc.total(st[1], active, st[3], st[4]) + credit + sum(slot_val[x] for _, x in st[5])
            scored.append((h, st))
        scored.sort(key=lambda x: -x[0])
        beam = [st for _, st in scored[:BEAM]]

    finals = []
    wslots = [("weapon", int(x)) for x in (weapon_slots or []) if 1 <= int(x) <= 4]
    for combo, pts, counts, dmax, res, slots in beam[:FINAL_STATES]:
        _, active = bonus_credit(counts)
        allslots = slots + wslots
        ch_ranked = sorted(((sc.total({**pts, **{k: pts.get(k, 0) + v for k, v in c["skills"].items()}}, active, dmax, res), c)
                            for c in charms), key=lambda x: -x[0])[:CHARMS_TRIED] or [(0, None)]
        for _, c in ch_ranked:
            p2 = dict(pts)
            if c:
                _add(p2, c["skills"])
            p3, placed, free, total = _greedy_decos(sc, p2, active, dmax, res, allslots, decos, dcounts, band)
            finals.append((total, combo, c, placed, free, counts))
    finals.sort(key=lambda x: -x[0])

    picked = []
    for f in finals:
        ids = [a["id"] if a else None for a in f[1]]
        if all(sum(1 for x, y in zip(ids, [a["id"] if a else None for a in p[1]]) if x != y) >= 2 for p in picked):
            picked.append(f)
        if len(picked) >= top:
            break
    builds = [_build_out(D, sc, prof, band, f, i, owned, m) for i, f in enumerate(picked)]
    if owned is not None:
        if not any(pool[s] for s in SLOTS):
            notes.append(f"No tienes piezas de {rank} en la rareza permitida; prueba con cap=full o sin owned.")
        notes.append("El save no incluye amuletos: el amuleto sugerido puede que no lo tengas.")
    return {**base, "available": True, "builds": builds, "notes": notes, "sources": _goal_sources(prof) if goal else _sources(D, prof["rule_sources"]),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000)}


def _goal_sources(prof: dict) -> list[dict]:
    gr = prof["goal_rules"]
    used = {i for w in gr["weights"].values() for i in w.get("sources", [])}
    return [{"id": k, **v} for k, v in sorted(gr.get("sources", {}).items()) if k in used]


def _sources(D: dict, ids: set) -> list[dict]:
    src = D["rules"]["sources"]
    return [{"id": i, **src[i]} for i in sorted(ids) if i in src]


def _build_out(D, sc: Scorer, prof, band, f, idx, owned, m) -> dict:
    total, combo, charm, placed, free, counts = f
    pieces = {s: a["id"] for s, a in zip(SLOTS, combo) if a}
    if charm:
        pieces["charm"] = charm["id"]
    deco_list = [{"id": d["id"], "piece": p} for (p, size), d in placed]
    wslots = [s for (p, s), _ in placed if p == "weapon"] + [s for p, s in free if p == "weapon"]
    ev = evaluate_loadout(pieces, deco_list, wslots)
    owned_armor = owned["armor"] if owned else None
    sb = ev["set_bonuses"]
    active = {b["skill_id"] for b in sb if b["active"]}
    points = {}
    for s in ev["skills"]:
        points[s["skill_id"]] = s["points"]
    base_max = sum(a["defense_max"] or 0 for a in combo if a)
    base_res = {e: sum(a["res"][e] for a in combo if a) for e in ELEMENTS}
    skill, elem, dfn, off, lv, d, r = sc.parts(points, active, base_max, base_res)
    defense_score = round(100 * (skill + elem + dfn) / sc.max_total, 1) if sc.max_total else 0
    offense_score = round(100 * off / sc.off_total, 1)

    why, gaps = [], []
    for sid, e in sorted(prof["weights"].items(), key=lambda kv: -kv[1]["w"]):
        if e["w"] <= 0:
            continue
        l = lv.get(sid, (0,))[0]
        s = D["skills"][sid]
        rule = D["rules"]["skills"].get(s["name_en"], {})
        if l:
            if e["why"]:
                why.append(f"{s['name_es']} {l} porque {e['why'][0]}")
            elif rule.get("reason_es"):
                why.append(f"{s['name_es']} {l}: {rule['reason_es']}")
        elif e["why"] and e["w"] >= 4:
            gaps.append(f"Falta {s['name_es']} ({e['why'][0]}): no cabía sin perder más supervivencia; añádela si te molesta.")
    for el, info in prof["elements"].items():
        v = r[el]
        if v >= sc.el["blight_threshold"]:
            why.append(f"Resistencia a {ELEMENT_ES[el]} {v} (≥20 evita la plaga) porque {prof['name']} {info['label_es']}")
        else:
            br = lv.get(sc.br, (0,))[0]
            extra = f"; Anti plagas {br} reduce la plaga" if br else ""
            why.append(f"Resistencia a {ELEMENT_ES[el]} {v}: reduce su daño de {ELEMENT_ES[el]}; con 20 evitarías la plaga ({info['effect_es']}){extra}")
    for b in sb:
        if b["active"]:
            why.append(f"Bonus de set «{b['name_es']}» ({b['pieces']}/{b['required']} piezas): {b['skill_es']}")

    deco_out = []
    for (p, size), dd in placed:
        o = {"piece": p, "slot_size": size, "decoration_id": dd["id"], "name_es": dd["name_es"] or dd["name_en"],
             "name_en": dd["name_en"], "size": dd["slot"], "rarity": dd["rarity"], "difficulty": _deco_difficulty(band, dd["rarity"]),
             "skills": [{"skill_id": s, "name_es": D["skills"][s]["name_es"], "level": l} for s, l in dd["skills"].items()]}
        if owned is not None:
            o["owned"] = True
        deco_out.append(o)
    charm_out = None
    if charm:
        sk = [f"{D['skills'][s]['name_es']} {l}" for s, l in charm["skills"].items()]
        charm_out = {**_charm_out(charm), "generic_es": "Amuleto con " + " y ".join(sk),
                     "skills": [{"skill_id": s, "name_es": D["skills"][s]["name_es"], "level": l} for s, l in charm["skills"].items()]}
        if owned is not None:
            charm_out["owned"] = None
    set_names = []
    for a in combo:
        if a and (a["set_es"] or a["set_en"]) not in set_names:
            set_names.append(a["set_es"] or a["set_en"])
    return {
        "name_es": f"Opción {idx + 1}: " + " + ".join(set_names[:3]) + ("…" if len(set_names) > 3 else ""),
        "pieces": [_piece_out(a, owned_armor) if a else {"type": s, "empty": True} for s, a in zip(SLOTS, combo)],
        "charm": charm_out,
        "decorations": deco_out,
        "slots_free": [{"piece": p, "size": s} for p, s in free],
        "skills": [{k: s[k] for k in ("skill_id", "name_es", "name_en", "level", "max")} for s in ev["skills"]],
        "set_bonuses": [b for b in sb if b["active"]],
        "defense": ev["defense"], "resistances": ev["resistances"],
        "defense_score": defense_score, "offense_score": offense_score, "score": round(total, 2),
        "why_es": why, "gaps_es": gaps,
        "swap_hints": _swap_hints(D, prof, lv, r, m, sc),
        "warnings": ev["warnings"],
    }


def _swap_hints(D, prof, lv, res, m, sc) -> list[dict]:
    S = D["skill_by_name"]
    L = lambda n: lv.get(S.get(n), (0,))[0]
    hints = []
    def h(text):
        hints.append({"tipo": "sugerencia", "text_es": text})
    if L("Divine Blessing") and L("Health Boost") >= 3:
        h("Cuando te sepas sus ataques, cambia las joyas de Protección divina por Bonus ataque (joya ataque) o Bonus afinidad (joya experto).")
    if L("Evade Window") >= 3:
        h("Si ya esquivas con soltura, deja Intervalo de evasión en 2 y usa esas ranuras para Bonus punto débil (joya ternura) o Bonus críticos.")
    if L("Recovery Up") or L("Recovery Speed"):
        h("Bonus curación y Recuperación rápida son lo primero que puedes quitar si apenas te curas.")
    roar = next((k for k in prof["keys"] if k.startswith("roar:")), None)
    if L("Earplugs") and roar == "roar:small":
        h("Su rugido es débil: puedes evitarlo rodando a tiempo y liberar Anti rugidos para habilidades de daño.")
    if (m.get("breaks") or 0) >= 3:
        h(f"Para romper sus {m['breaks']} partes rompibles, añade Bonus rompe-partes (joya destructor, tamaño 2).")
    w = D["weak"].get(m["id"])
    if w:
        best = max(ELEMENTS, key=lambda e: w.get(e) or 0)
        if (w.get(best) or 0) >= 2:
            h(f"Es débil a {ELEMENT_ES[best]}: con un arma de {ELEMENT_ES[best]}, Ataque de {ELEMENT_ES[best]} sube mucho el daño.")
    for el in prof["elements"]:
        if res[el] >= sc.el["blight_threshold"]:
            h(f"Si cambias piezas, intenta mantener la resistencia a {ELEMENT_ES[el]} en 20 o más para seguir sin plaga.")
            break
    return hints[:6]


# ------------------------------------------------------------------ endpoints
Id = Annotated[int, Field(ge=0, le=1_000_000)]


class DecoIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Id | None = None
    decoration_id: Id | None = None
    piece: Literal["head", "chest", "arms", "waist", "legs", "weapon"] | None = None


class EvalBody(BaseModel):
    pieces: dict[Literal["head", "chest", "arms", "waist", "legs", "charm"], Id | None] = Field(
        default_factory=dict, max_length=6, description="head/chest/arms/waist/legs/charm -> id (o null)")
    decorations: list[Id | DecoIn] = Field(default_factory=list, max_length=60,
                                           description="ids de joyas, o {id, piece} para fijar dónde va cada una")
    weapon_slots: list[Annotated[int, Field(ge=1, le=4)]] | None = Field(None, max_length=4)


@_b.post("/evaluate")
def evaluate(body: EvalBody):
    decos = [d.model_dump() if isinstance(d, DecoIn) else d for d in body.decorations]
    out = evaluate_loadout(body.pieces, decos, body.weapon_slots)
    out["disclaimer_es"] = DISCLAIMER_ES
    return out


@_b.get("/rules")
def rules():
    D = _load()
    r = D["rules"]
    return {"rules_hash": D["rules_hash"], "disclaimer_es": DISCLAIMER_ES, **r}


def _memo_put(key, value):
    memo = _cache.setdefault("memo", {})
    if len(memo) >= 300:   # bound memory: inputs are user-controlled
        memo.clear()
    memo[key] = value


def _memo_key(*a):
    return json.dumps(a, sort_keys=True, default=str)


@_b.get("/monster/{monster_id}")
def monster_builds(monster_id: int = PathParam(ge=0, le=1_000_000), rank: Literal["LR", "HR", "MR", "lr", "hr", "mr"] = "HR",
                   owned: int = Query(0, ge=0, le=1), cap: Literal["progress", "full"] = "progress",
                   weapon_slots: str | None = Query(None, max_length=16, pattern=r"^[0-9, ]*$", description="tamaños separados por comas, p. ej. 2,1")):
    D = _load()
    rank = rank.upper()
    ws = [int(x) for x in weapon_slots.split(",") if x.strip().isdigit() and 1 <= int(x) <= 4][:4] if weapon_slots else []
    if owned:
        snap = _latest_snapshot()
        own = owned_from_snapshot(snap)
        if own is None:
            out = recommend(monster_id, rank, None, cap, ws)
            return {**out, "owned_available": False,
                    "notes": out["notes"] + ["Tu save no tiene todavía el cofre de equipo: se muestra la recomendación general."]}
        key = _memo_key("own", monster_id, rank, cap, ws, sorted(own["armor"]), sorted(own["decorations"].items()))
        if key not in _cache.get("memo", {}):
            _memo_put(key, recommend(monster_id, rank, own, cap, ws))
        return {**_cache["memo"][key], "owned_available": True}
    if not ws:
        row = one("SELECT data FROM build_recommendations WHERE monster_id=? AND rank=? AND cap=? "
                  "AND rules_hash=? AND data_sig=?", (monster_id, rank, cap, D["rules_hash"], D["data_sig"]))
        if row:
            return {**row["data"], "owned_available": None, "from_table": True}
    key = _memo_key("gen", monster_id, rank, cap, ws)
    if key not in _cache.get("memo", {}):
        _memo_put(key, recommend(monster_id, rank, None, cap, ws))
    return {**_cache["memo"][key], "owned_available": None, "from_table": False}


@_b.get("/goal/{goal}")
def goal_builds(goal: Literal["recoleccion", "botin"], rank: Literal["LR", "HR", "MR", "lr", "hr", "mr"] = "MR",
                owned: int = Query(0, ge=0, le=1), cap: Literal["progress", "full"] = "full",
                weapon_slots: str | None = Query(None, max_length=16, pattern=r"^[0-9, ]*$", description="tamaños separados por comas, p. ej. 2,1")):
    """Equipo recomendado para un objetivo (recoleccion | botin) en vez de para un monstruo. Mismo motor y mismo
    formato de respuesta que /monster/{id}, más `goal` y `rules_hint`. Pesos en research/builds/<objetivo>_rules.json."""
    rank = rank.upper()
    ws = [int(x) for x in weapon_slots.split(",") if x.strip().isdigit() and 1 <= int(x) <= 4][:4] if weapon_slots else []
    own = None
    if owned:
        own = owned_from_snapshot(_latest_snapshot())
    key = _memo_key("goal", goal, rank, cap, ws, None if own is None else (sorted(own["armor"]), sorted(own["decorations"].items())))
    _load()
    if key not in _cache.get("memo", {}):
        _memo_put(key, recommend(0, rank, own, cap, ws, goal=goal))
    out = _cache["memo"][key]
    return {**out, "owned_available": (own is not None) if owned else None}


@_b.post("/rebuild")
def rebuild(cap: Literal["progress", "full", "both"] = "both"):
    """Manual only: reload rules + data and precompute every large monster x rank into build_recommendations."""
    reset_cache()
    D = _load()
    t0 = time.perf_counter()
    caps = ("progress", "full") if cap == "both" else (cap,)
    n, errors, slow = 0, [], []
    execute("DELETE FROM build_recommendations WHERE rules_hash <> ? OR data_sig <> ?", (D["rules_hash"], D["data_sig"]))
    for mid, m in sorted(D["monsters"].items()):
        if m["size"] != "large":
            continue
        for rk in RANKS:
            for cp in caps:
                try:
                    t1 = time.perf_counter()
                    out = recommend(mid, rk, None, cp)
                    dt = time.perf_counter() - t1
                    if dt > 2:
                        slow.append({"monster_id": mid, "rank": rk, "cap": cp, "s": round(dt, 2)})
                    execute("""INSERT INTO build_recommendations (monster_id, rank, cap, rules_hash, data_sig, data, built_at)
                               VALUES (?,?,?,?,?,?,?) ON CONFLICT (monster_id, rank, cap) DO UPDATE
                               SET rules_hash=EXCLUDED.rules_hash, data_sig=EXCLUDED.data_sig, data=EXCLUDED.data, built_at=EXCLUDED.built_at""",
                            (mid, rk, cp, D["rules_hash"], D["data_sig"], J(out), now()))
                    n += 1
                except Exception as e:  # keep going; report the error type only (details stay in the local log)
                    _log.exception("rebuild failed for monster %s rank %s cap %s", mid, rk, cp)
                    errors.append({"monster_id": mid, "rank": rk, "cap": cp, "error": type(e).__name__})
    return {"stored": n, "errors": errors, "slow": slow, "rules_hash": D["rules_hash"], "data_sig": D["data_sig"],
            "elapsed_s": round(time.perf_counter() - t0, 1)}


# ------------------------------------------------------------------ saved builds (user.db)
MAX_SAVED = 200
MAX_PAYLOAD_BYTES = 64 * 1024
SavedName = Annotated[str, StringConstraints(min_length=1, max_length=60, strip_whitespace=True),
                      AfterValidator(no_control_chars)]


class SavedPayload(BaseModel):
    """LoadoutState (web/src/build.ts): armor/charm entries are an object, a numeric id or null."""
    model_config = ConfigDict(extra="forbid")
    head: dict[str, Any] | Id | None = None
    chest: dict[str, Any] | Id | None = None
    arms: dict[str, Any] | Id | None = None
    waist: dict[str, Any] | Id | None = None
    legs: dict[str, Any] | Id | None = None
    charm: dict[str, Any] | Id | None = None
    decos: dict[Literal["head", "chest", "arms", "waist", "legs", "weapon"],
                Annotated[list[Id | None], Field(max_length=4)]] = Field(default_factory=dict)
    weapon: list[Annotated[int, Field(ge=1, le=4)]] = Field(default_factory=list, max_length=4)


def _check_payload(p: SavedPayload) -> dict:
    out = p.model_dump()
    if len(json.dumps(out, ensure_ascii=False).encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise HTTPException(413, "El equipo guardado es demasiado grande (máx. 64 KB)")
    return out


class SavedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: SavedName
    payload: SavedPayload


class SavedPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: SavedName | None = None
    payload: SavedPayload | None = None

    @model_validator(mode="after")
    def _any(self):
        if self.name is None and self.payload is None:
            raise ValueError("Indica name y/o payload")
        return self


_SAVED_COLS = "id, name, payload, created_at, updated_at"


@_b.get("/saved")
def saved_list():
    return all_(f"SELECT {_SAVED_COLS} FROM saved_builds ORDER BY created_at DESC NULLS FIRST, id DESC NULLS FIRST")


@_b.post("/saved", status_code=201)
def saved_create(body: SavedIn):
    payload = _check_payload(body.payload)
    t = now()
    with transaction() as c:
        if c.one("SELECT count(*) n FROM saved_builds")["n"] >= MAX_SAVED:
            raise HTTPException(409, f"Máximo {MAX_SAVED} equipos guardados; borra alguno antes de guardar otro")
        return c.one(f"INSERT INTO saved_builds (name, payload, created_at, updated_at) VALUES (?,?,?,?) "
                     f"RETURNING {_SAVED_COLS}", (body.name, J(payload), t, t))


@_b.put("/saved/{saved_id}")
def saved_update(body: SavedPatch, saved_id: int = PathParam(ge=0, le=2_000_000_000)):
    payload = _check_payload(body.payload) if body.payload is not None else None
    with transaction() as c:
        row = c.one(f"SELECT {_SAVED_COLS} FROM saved_builds WHERE id = ?", (saved_id,))
        if row is None:
            raise HTTPException(404, "No se encontró el equipo guardado")
        return c.one(f"UPDATE saved_builds SET name = ?, payload = ?, updated_at = ? WHERE id = ? RETURNING {_SAVED_COLS}",
                     (body.name if body.name is not None else row["name"],
                      J(payload) if payload is not None else J(row["payload"]), now(), saved_id))


@_b.delete("/saved/{saved_id}")
def saved_delete(saved_id: int = PathParam(ge=0, le=2_000_000_000)):
    if execute("DELETE FROM saved_builds WHERE id = ?", (saved_id,)) == 0:
        raise HTTPException(404, "No se encontró el equipo guardado")
    return {"ok": True, "id": saved_id}


# ------------------------------------------------------------------ catalog lists for the Builder
def _group(rows: list[dict], key: str) -> dict:
    out: dict = {}
    for r in rows:
        out.setdefault(r[key], []).append(r)
    return out


def _strip(rows: list[dict], k: str) -> list[dict]:
    return [{a: b for a, b in x.items() if a != k} for x in rows]


@_c.get("/decorations")
def decorations_list():
    """Same items as GET /api/decorations/{id}."""
    decos = all_("SELECT * FROM decorations ORDER BY id")
    skills = _group(all_("""SELECT ds.decoration_id, s.id skill_id, s.name_es, s.name_en, ds.level FROM decoration_skills ds
                            JOIN skills s ON s.id = ds.skill_id ORDER BY ds.decoration_id, s.id"""), "decoration_id")
    rates = _group(all_("SELECT rarity, feystone, percentage FROM decoration_droprates ORDER BY percentage DESC NULLS FIRST"), "rarity")
    return [{**d, "skills": _strip(skills.get(d["id"], []), "decoration_id"),
             "droprates": _strip(rates.get(d["rarity"], []), "rarity")} for d in decos]


@_c.get("/charms")
def charms_list():
    """Same items as GET /api/charms/{id}."""
    charms = all_("SELECT * FROM charms ORDER BY id")
    by_id = {c["id"]: c for c in charms}
    skills = _group(all_("""SELECT cs.charm_id, s.id skill_id, s.name_es, s.name_en, cs.level FROM charm_skills cs
                            JOIN skills s ON s.id = cs.skill_id ORDER BY cs.charm_id, cs.rowid"""), "charm_id")
    recipes = _group(all_("""SELECT cr.charm_id, cr.type, i.id item_id, i.name_es, i.name_en, i.rarity, cr.quantity
                             FROM charm_recipes cr JOIN items i ON i.id = cr.item_id ORDER BY cr.charm_id, cr.rowid"""), "charm_id")
    out = []
    for c in charms:
        prev = by_id.get(c["previous_id"]) if c["previous_id"] else None
        out.append({**c, "skills": _strip(skills.get(c["id"], []), "charm_id"),
                    "recipe": _strip(recipes.get(c["id"], []), "charm_id"),
                    "previous": {"id": prev["id"], "name_es": prev["name_es"], "name_en": prev["name_en"]} if prev else None})
    return out


@_c.get("/armor-pieces")
def armor_pieces_list(rank: Literal["LR", "HR", "MR", "lr", "hr", "mr"] | None = None):
    """Same items as GET /api/armor/{id} (head..legs order, then id), optionally for one rank."""
    pieces = all_("""SELECT a.* FROM armor a WHERE (? IS NULL OR a.rank = ?)
                     ORDER BY CASE a.type WHEN 'head' THEN 1 WHEN 'chest' THEN 2 WHEN 'arms' THEN 3
                                          WHEN 'waist' THEN 4 WHEN 'legs' THEN 5 ELSE 99 END, a.id""",
                  (rank.upper() if rank else None,) * 2)
    skills = _group(all_("""SELECT ak.armor_id, s.id skill_id, s.name_es, s.name_en, ak.level FROM armor_skills ak
                            JOIN skills s ON s.id = ak.skill_id ORDER BY ak.armor_id, ak.rowid"""), "armor_id")
    recipes = _group(all_("""SELECT ar.armor_id, i.id item_id, i.name_es, i.name_en, i.rarity, ar.quantity FROM armor_recipes ar
                             JOIN items i ON i.id = ar.item_id ORDER BY ar.armor_id, ar.rowid"""), "armor_id")
    sets = {r["id"]: r for r in all_("SELECT id, name_es, name_en, rank FROM armor_sets")}
    for p in pieces:
        p["skills"] = skills.get(p["id"], [])
        p["recipe"] = recipes.get(p["id"], [])
        p["set"] = sets.get(p["armor_set_id"]) if p["armor_set_id"] else None
    return pieces


router.include_router(_b)
router.include_router(_c)
