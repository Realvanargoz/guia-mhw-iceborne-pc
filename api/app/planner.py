"""Phased-builder solver (Dem's method): POST /api/builds/plan/solve.

The user gives target skills with a level and a priority tier (1 = must have, 2 = nice to have, 3 = only if a
slot is left), an optional set bonus, locked pieces / charm / decorations, exclusions and a mode (only what the
save owns, or the whole catalog). The solver returns up to 5 diverse loadouts ranked by deficit
(tier 1, tier 2, tier 3), each one a superset of the recommender's `Build` plus coverage and trade-offs.

Pipeline (one search per scenario, results merged):
1. scenarios: a target above its normal cap (Artillery 5) or a skill that only comes from a set bonus needs a
   bonus; the cartesian product of the alternatives (secret-skill bonuses + Inheritance) that fit in 5 pieces.
2. pools like recommend(): rank, rarity band, owned only, exclusions; keep pieces that add target points, belong
   to a tracked bonus or have Pareto-max slots; collapse duplicates and drop dominated pieces per slot.
3. layered DP over the 5 armor slots: state = (clipped target points, slot counts by size, bonus counts),
   deduplicated with the best defense, pruned with a lower bound (decorations + charm can only cover so much)
   against the K-th incumbent, LAYER_CAP states per layer.
4. per final state: charm first (Dem's rule: the charm covers what would cost the most slots), then a greedy
   decoration fill by tier / scarcity, exact branch-and-bound polish on the best finalists.
Same input -> same result barring the time budget (a search cut short by time may differ). Pure Python, no extra deps.
"""
from __future__ import annotations

import heapq
import json
import threading
import time
from collections import defaultdict
from operator import add
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import builds
from .builds import SLOT_ES, SLOTS
from .plan_models import (DecoLock, ExcludeIn, Id, LocksIn, PieceName, SetBonusIn, TargetIn,  # noqa: F401
                          WeaponSlots)
from .db import one

router = APIRouter(prefix="/api/builds/plan")

TIER_W = (0, 1_000_000, 1_000, 1)          # lexicographic weights by tier (index = tier)
TIER_ES = {1: "Primaria", 2: "Secundaria", 3: "Terciaria"}
SLACK_W = (0, 4, 2, 1)
PER_SLOT_CAP = 40
LAYER_CAP = 2000
SEED_LAYER_CAP = 40
FINALS = 60
CHARMS_TRIED = 3
EXACT_NODES = 15_000
MAX_SCENARIOS = 6
MEMO_MAX = 64
CHECK_EVERY = 2000
NO_JEWEL_COST = 5
PIECES = SLOTS + ("weapon",)

_sem = threading.BoundedSemaphore(1)

# ------------------------------------------------------------------ input
class SolveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rank: Literal["LR", "HR", "MR"]
    cap: Literal["progress", "full"] = "full"
    ref_monster_id: Id | None = None
    weapon_slots: WeaponSlots | None = None
    weapon_id: Id | None = None
    targets: list[TargetIn] = Field(min_length=1, max_length=20)
    set_bonus: SetBonusIn | None = None
    locks: LocksIn = Field(default_factory=LocksIn)
    exclude: ExcludeIn = Field(default_factory=ExcludeIn)
    mode: Literal["owned", "ideal"] = "ideal"
    max_results: int = Field(3, ge=1, le=5)
    time_budget_ms: int = Field(1500, ge=300, le=3000)

    @model_validator(mode="after")
    def _rules(self):
        ids = [t.skill_id for t in self.targets]
        if len(set(ids)) != len(ids):
            raise ValueError("Hay habilidades repetidas en los objetivos")
        for d in self.locks.decorations:
            if d.piece == "weapon":
                if not self.weapon_slots and self.weapon_id is None:
                    raise ValueError("Para fijar una joya en el arma, indica sus ranuras")
            elif getattr(self.locks, d.piece) is None:
                raise ValueError("Para fijar una joya, fija también la pieza")
        return self


# ------------------------------------------------------------------ static data derived from the catalog
def _static(D: dict) -> dict:
    st = builds._cache.get("plan_static")
    if st is not None and st["sig"] == id(D):
        return st
    inv: dict = defaultdict(list)                      # bonus skill id -> [(bonus id, required)]
    for bid, b in D["bonuses"].items():
        for req, sid in b["ranks"]:
            inv[sid].append((bid, req))
    elsewhere = set()
    for coll in (D["armor"], D["decos"], D["charms"]):
        for x in coll.values():
            elsewhere.update(x["skills"])
    bonus_only = {sid for sid in inv if sid not in elsewhere}
    unlockers: dict = defaultdict(list)                # base skill id -> [(bonus id, required)]
    for sec, base in D["unlocks"].items():
        unlockers[base] += inv.get(sec, [])
    ua_alts = list(inv.get(D["unlock_all"], [])) if D.get("unlock_all") is not None else []
    st = {"sig": id(D), "inv": dict(inv), "bonus_only": bonus_only, "unlockers": dict(unlockers), "ua_alts": ua_alts}
    builds._cache["plan_static"] = st
    return st


def _bname(D: dict, bid: int) -> str:
    b = D["bonuses"][bid]
    return b["name_es"] or b["name_en"]


def _alts_es(D: dict, alts) -> str:
    return " o ".join(f"«{_bname(D, b)}» ({r} piezas)" for b, r in alts)


# ------------------------------------------------------------------ decoration table
class _Entry:
    __slots__ = ("idx", "size", "pts", "raw", "ids", "count", "rarity", "id", "hard")

    def __init__(self, idx, size, pts, raw, ids, count, rarity, did, hard):
        self.idx, self.size, self.pts, self.raw, self.ids = idx, size, pts, raw, ids
        self.count, self.rarity, self.id, self.hard = count, rarity, did, hard


class _Table:
    def __init__(self, entries: list, tiers: dict, order_idx: dict):
        self.entries = entries
        self.tier = tiers
        self.by_skill: dict = defaultdict(list)
        for e in entries:
            for s in e.pts:
                self.by_skill[s].append(e)
        self.minsize = {s: min(e.size for e in es) for s, es in self.by_skill.items()}
        self.supply = {s: (None if any(e.count is None for e in es) else sum(e.count * e.pts[s] for e in es))
                       for s, es in self.by_skill.items()}
        self.order = sorted(self.by_skill, key=lambda s: (tiers[s], -self.minsize[s], order_idx[s]))

    def cost(self, sid: int) -> int:
        return self.minsize.get(sid, NO_JEWEL_COST)


def _build_table(D: dict, ctx: dict, counts: dict | None) -> _Table:
    """Decorations that touch a target, merged by (size, target skills trimmed to the target level)."""
    band = ctx["band"]
    tiers = {t["sid"]: t["tier"] for t in ctx["targets"]}
    order_idx = {t["sid"]: t["idx"] for t in ctx["targets"]}
    levels = {t["sid"]: t["level"] for t in ctx["targets"]}
    if not band["deco"]:
        return _Table([], tiers, order_idx)
    dlo, dhi = band["deco"]
    groups: dict = {}
    for d in sorted(D["decos"].values(), key=lambda d: (d["rarity"] or 0, d["id"])):
        if not (dlo <= (d["rarity"] or 0) <= dhi) or d["id"] in ctx["excl_decos"]:
            continue
        if ctx["rank"] == "HR" and d["slot"] > 3:
            continue
        n = None
        if counts is not None:
            n = counts.get(d["id"], 0) - ctx["lock_deco_use"].get(d["id"], 0)
            if n <= 0:
                continue
        trimmed = tuple(sorted((s, min(lv, levels[s])) for s, lv in d["skills"].items() if s in levels))
        if not trimmed:
            continue
        g = groups.setdefault((d["slot"], trimmed), [])
        g.append((d["rarity"] or 0, d["id"], n))
    entries = []
    for (size, trimmed), ids in sorted(groups.items()):
        rar, did, _ = ids[0]
        if counts is None:
            ids = ids[:1]
        raw = {s: D["decos"][did]["skills"][s] for s, _ in trimmed}
        cnt = None if counts is None else sum(x[2] for x in ids)
        entries.append(_Entry(len(entries), size, dict(trimmed), raw, ids, cnt, rar, did,
                              builds._deco_difficulty(band, rar) == "difícil"))
    return _Table(entries, tiers, order_idx)


# ------------------------------------------------------------------ context (validation, pools, tables)
def _context(D: dict, body: SolveBody, own: dict | None, mode: str) -> dict:
    S = D["skills"]
    st = _static(D)
    notes: list[str] = []
    warnings: list[str] = []
    targets = []
    for i, t in enumerate(body.targets):
        s = S.get(t.skill_id)
        if not s:
            raise HTTPException(422, f"Objetivo {i + 1}: la habilidad no existe")
        mx = s["max_level"] or 1
        if t.level > mx:
            raise HTTPException(422, f"Objetivo {i + 1}: el nivel supera el máximo de la habilidad ({mx})")
        targets.append({"idx": i, "sid": t.skill_id, "level": t.level, "tier": t.tier, "name_es": s["name_es"],
                        "cap": s["cap"], "max": mx, "bonus_only": t.skill_id in st["bonus_only"]})
    user_bonus = None
    if body.set_bonus:
        b = D["bonuses"].get(body.set_bonus.bonus_id)
        if not b:
            raise HTTPException(422, "El bono de set no existe")
        if body.set_bonus.required not in {r for r, _ in b["ranks"]}:
            raise HTTPException(422, "Ese número de piezas no activa ninguna habilidad del bono")
        user_bonus = (body.set_bonus.bonus_id, body.set_bonus.required)

    # weapon
    wslots = list(body.weapon_slots or [])
    if body.weapon_id is not None and body.weapon_slots:
        warnings.append("Se indicaron weapon_id y weapon_slots: se usan las ranuras del arma elegida y se ignora weapon_slots.")
    if body.weapon_id is not None:
        w = one("SELECT slot_1, slot_2, slot_3 FROM weapons WHERE id = ?", (body.weapon_id,))
        if not w:
            raise HTTPException(404, "No se encontró el arma")
        wslots = [x for x in (w["slot_1"], w["slot_2"], w["slot_3"]) if x and 1 <= x <= 4]
    wslots = sorted(wslots, reverse=True)

    # band / progress filter
    cap = body.cap
    m = {"id": -1, "name_en": "", "name_es": ""}
    if cap == "progress":
        if body.ref_monster_id is None:
            cap = "full"
            notes.append("Sin monstruo de referencia no se limita el progreso: se usa todo el catálogo del rango.")
        else:
            m = D["monsters"].get(body.ref_monster_id)
            if not m:
                raise HTTPException(404, "No se encontró el monstruo")
    band = builds._band(D, m, body.rank, cap)
    allowed = builds._progress_filter(D, m, body.rank, cap)

    # locks
    locks = {}
    for s in SLOTS:
        aid = getattr(body.locks, s)
        if aid is None:
            continue
        a = D["armor"].get(aid)
        if not a:
            raise HTTPException(422, f"La pieza fijada de {SLOT_ES[s]} no existe")
        if a["type"] != s:
            raise HTTPException(422, f"La pieza fijada de {SLOT_ES[s]} no corresponde a su hueco")
        locks[s] = a
    lock_charm = None
    if body.locks.charm is not None:
        lock_charm = D["charms"].get(body.locks.charm)
        if not lock_charm:
            raise HTTPException(422, "El amuleto fijado no existe")
    lock_decos: dict = defaultdict(list)       # piece -> [deco]
    lock_deco_use: dict = defaultdict(int)
    for x in body.locks.decorations:
        d = D["decos"].get(x.id)
        if not d:
            raise HTTPException(422, "Una joya fijada no existe")
        lock_decos[x.piece].append(d)
        lock_deco_use[d["id"]] += 1
    lock_place: dict = {}                      # piece -> (placed [((piece,size),deco)], free [(piece,size)])
    for p in PIECES:
        slots = [(p, z) for z in (wslots if p == "weapon" else (locks[p]["slots"] if p in locks else []))]
        if p in lock_decos:
            placed, unplaced, free = builds._fit(slots, [(d["slot"], d) for d in lock_decos[p]])
            if unplaced:
                raise HTTPException(422, f"Una joya fijada no cabe en {SLOT_ES[p]}")
            lock_place[p] = (placed, free)

    own_armor = own["armor"] if own else None
    own_decos = own["decorations"] if own else None
    own_charms = own.get("charms") if own else None
    owned_mode = mode == "owned" and own is not None
    lo, hi = band["armor"]
    excl_armor = set(body.exclude.armor)
    pool = {}
    for s in SLOTS:
        if s in locks:
            a = locks[s]
            pool[s] = [a]
            nm = a["name_es"] or a["name_en"]
            if owned_mode and a["id"] not in own_armor:
                warnings.append(f"{nm} (fijada) no está en tu save")
            if a["rank"] != body.rank or not (lo <= (a["rarity"] or 0) <= hi):
                warnings.append(f"{nm} (fijada) está fuera del rango o la rareza permitidos")
            continue
        pool[s] = [a for a in D["armor"].values() if a["type"] == s and a["rank"] == body.rank
                   and lo <= (a["rarity"] or 0) <= hi and a["id"] not in excl_armor
                   and (not owned_mode or a["id"] in own_armor) and allowed(a)]
    if allowed.excluded:
        notes.append(D["rules"]["progression"]["rule_es"])
    empty_slots = [s for s in SLOTS if not pool[s]]
    for s in empty_slots:
        notes.append(f"No hay ninguna pieza de {SLOT_ES[s]} disponible con estos filtros"
                     + (" (solo cuentan las que tienes en tu save)." if owned_mode else " (rango, rareza, exclusiones o progresión)."))
    if owned_mode:
        for d in [d for ds in lock_decos.values() for d in ds]:
            if own_decos.get(d["id"], 0) < lock_deco_use[d["id"]]:
                warnings.append(f"{d['name_es'] or d['name_en']} (fijada) no está en tu save en esa cantidad")
                break
        if lock_charm and own_charms is not None and lock_charm["id"] not in own_charms:
            warnings.append(f"{lock_charm['name_es'] or lock_charm['name_en']} (fijado) no está en tu save")
    bonus_avail: dict = defaultdict(int)       # bonus id -> number of slots that can hold one of its pieces
    for s in SLOTS:
        for bid in {a["bonus_id"] for a in pool[s] if a["bonus_id"]}:
            bonus_avail[bid] += 1

    ctx = {"rank": body.rank, "cap": cap, "band": band, "targets": targets, "user_bonus": user_bonus,
           "wslots": wslots, "locks": locks, "lock_charm": lock_charm, "lock_place": lock_place,
           "lock_deco_use": dict(lock_deco_use), "pool": pool, "empty_slots": empty_slots, "bonus_avail": dict(bonus_avail),
           "own": own, "owned_mode": owned_mode, "mode": "owned" if owned_mode else "ideal",
           "excl_decos": set(body.exclude.decorations), "notes": notes, "warnings": warnings,
           "max_results": body.max_results, "static": st}
    ctx["table"] = _build_table(D, ctx, own_decos if owned_mode else None)
    ctx["table_ideal"] = _build_table(D, ctx, None) if owned_mode else ctx["table"]
    clo, chi = band["charm"]
    if lock_charm:
        charms = [lock_charm]
    else:
        tset = {t["sid"] for t in targets}
        excl_c = set(body.exclude.charms)
        charms = [c for c in D["charms"].values() if clo <= (c["rarity"] or 0) <= chi and c["id"] not in excl_c
                  and (not owned_mode or own_charms is None or c["id"] in own_charms)
                  and any(s in tset for s in c["skills"])]
    ctx["charms_all"] = charms
    ctx["charms"] = _pareto_charms(charms, targets)
    if band["note_es"]:
        notes.append(band["note_es"])
    if not wslots:
        notes.append("No se cuentan las ranuras del arma (indica weapon_slots o weapon_id).")
    if owned_mode and own_charms is None:
        notes.append("El save no incluye amuletos: el amuleto sugerido puede que no lo tengas.")
    return ctx


def _pareto_charms(charms: list, targets: list) -> list:
    lv = {t["sid"]: t["level"] for t in targets}
    vec = {c["id"]: tuple(min(c["skills"].get(s, 0), l) for s, l in lv.items()) for c in charms}
    best: dict = {}
    for c in sorted(charms, key=lambda c: (c["rarity"] or 0, c["id"])):
        best.setdefault(vec[c["id"]], c)      # identical vectors: the most common (lowest rarity)
    keep = []
    items = list(best.items())
    for v, c in items:
        if not any(w != v and all(x >= y for x, y in zip(w, v)) for w, _ in items):
            keep.append(c)
    return sorted(keep, key=lambda c: c["id"])


# ------------------------------------------------------------------ scenarios
def _expand_targets(D: dict, ctx: dict) -> tuple[list, list, set]:
    """Bonus requirements per scenario: {bonus id: pieces}. Returns (scenarios, notes, unreachable target sids)."""
    st = ctx["static"]
    avail = ctx["bonus_avail"]
    notes, unreachable = [], set()
    base = {}
    ub = ctx["user_bonus"]
    if ub:
        if avail.get(ub[0], 0) < ub[1]:
            have = avail.get(ub[0], 0)
            where = "en tus piezas" if ctx["owned_mode"] else f"en {ctx['rank']} con estos filtros"
            notes.append(f"No hay piezas suficientes del bono «{_bname(D, ub[0])}» {where} "
                         f"({have} de {ub[1]} huecos): no se puede activar.")
            return [], notes, unreachable
        base[ub[0]] = ub[1]
    needs = []
    for t in ctx["targets"]:
        if t["bonus_only"]:
            alts = st["inv"].get(t["sid"], [])
            why = f"{t['name_es']} solo sale de un bono de set"
        elif t["level"] > t["cap"]:
            alts = st["unlockers"].get(t["sid"], []) + st["ua_alts"]
            why = f"{t['name_es']} {t['level']} supera su tope normal ({t['cap']})"
        else:
            continue
        alts = sorted(set(alts), key=lambda x: (x[1], x[0]))
        if any(base.get(b, 0) >= r for b, r in alts):
            continue
        needs.append((t, alts, why))
    combos = [base]
    for t, alts, why in needs:
        new = []
        ok_alts = []
        for c in combos:
            for b, r in alts:
                c2 = dict(c)
                c2[b] = max(c2.get(b, 0), r)
                if sum(c2.values()) <= 5 and all(avail.get(x, 0) >= y for x, y in c2.items()):
                    new.append(c2)
                    if (b, r) not in ok_alts:
                        ok_alts.append((b, r))
        if not new:
            unreachable.add(t["sid"])
            notes.append(f"{why}, pero ningún bono que lo permita cabe con estas piezas: "
                         f"{t['name_es']} no puede llegar a {t['level']}.")
            continue
        combos = new
        notes.append(f"{why}: se prueba con " + _alts_es(D, ok_alts) + ".")
    uniq = {}
    for c in combos:
        uniq.setdefault(tuple(sorted(c.items())), c)
    combos = list(uniq.values())
    minimal = [c for c in combos if not any(o is not c and o != c and all(c.get(b, 0) >= r for b, r in o.items())
                                            for o in combos)]
    minimal.sort(key=lambda c: (sum(c.values()), len(c), sorted(c.items())))
    if len(minimal) > MAX_SCENARIOS:
        notes.append(f"Se prueban solo las {MAX_SCENARIOS} combinaciones de bonos con menos piezas.")
        minimal = minimal[:MAX_SCENARIOS]
    return minimal, notes, unreachable


# ------------------------------------------------------------------ per-scenario model
class _Scen:
    pass


def _scenario(D: dict, ctx: dict, req: dict) -> _Scen:
    st = ctx["static"]
    sx = _Scen()
    sx.req = req
    active = {sid for bid, n in req.items() for r, sid in D["bonuses"][bid]["ranks"] if n >= r}
    sx.active = active
    unlocked = builds._unlocked(D, active)
    sx.label_es = ("Con " + " y ".join(f"«{_bname(D, b)}» ({r} piezas)" for b, r in sorted(req.items()))) if req else ""
    tracked = []
    for t in sorted(ctx["targets"], key=lambda t: (t["tier"], t["idx"])):
        if t["bonus_only"]:
            continue
        capk = t["max"] if t["sid"] in unlocked else t["cap"]
        L = min(t["level"], capk)
        if L <= 0 or (t["sid"] in active and L == 1):
            continue
        tracked.append((t, L))
    sx.tracked = tracked
    sx.K = K = len(tracked)
    sx.sids = [t["sid"] for t, _ in tracked]
    sx.L = [L for _, L in tracked]
    sx.tier = [t["tier"] for t, _ in tracked]
    # tracked bonuses: required ones + optional ones that give a tracked skill
    tb = {}
    for bid, r in sorted(req.items()):
        tb[bid] = {"cap": r, "req": r, "gives": []}
    used = sum(req.values())
    for k, sid in enumerate(sx.sids):
        for bid, r in st["inv"].get(sid, []):
            if ctx["bonus_avail"].get(bid, 0) >= r and (bid in tb or used + r <= 5):
                e = tb.setdefault(bid, {"cap": r, "req": 0, "gives": []})
                e["cap"] = max(e["cap"], r)
                e["gives"].append((r, k))
    sx.tb = sorted(tb.items())
    sx.tb_index = {bid: i for i, (bid, _) in enumerate(sx.tb)}
    B = len(sx.tb)
    sx.off_b = K + 4
    sx.caps = tuple(sx.L) + (99, 99, 99, 99) + tuple(e["cap"] for _, e in sx.tb)
    gives = [[] for _ in range(K)]
    for i, (bid, e) in enumerate(sx.tb):
        for r, k in e["gives"]:
            gives[k].append((sx.off_b + i, r, i))
    sx.gives = gives

    # decoration capacity per tier: P[t][z] = best tier-t points one slot of size <= z can hold
    tab = ctx["table"]
    Lsid = dict(zip(sx.sids, sx.L))
    tsid = dict(zip(sx.sids, sx.tier))
    P = [[0] * 5 for _ in range(4)]
    for e in tab.entries:
        val = [0, 0, 0, 0]
        for s, lv in e.pts.items():
            if s in Lsid:
                val[tsid[s]] += min(lv, Lsid[s])
        for t in (1, 2, 3):
            if val[t] > P[t][e.size]:
                P[t][e.size] = val[t]
    for t in (1, 2, 3):
        for z in range(1, 5):
            P[t][z] = max(P[t][z], P[t][z - 1])
    sx.P = P
    sx.jewelable = [sid in tab.by_skill for sid in sx.sids]
    sx.supply = None if not ctx["owned_mode"] else [tab.supply.get(sid) or 0 for sid in sx.sids]
    wfree = [z for _, z in ctx["lock_place"]["weapon"][1]] if "weapon" in ctx["lock_place"] else list(ctx["wslots"])
    sx.wcap = [0] + [sum(P[t][z] for z in wfree) for t in (1, 2, 3)]
    cm = [0, 0, 0, 0]
    for c in ctx["charms"]:
        v = [0, 0, 0, 0]
        for k, sid in enumerate(sx.sids):
            v[sx.tier[k]] += min(c["skills"].get(sid, 0), sx.L[k])
        for t in (1, 2, 3):
            cm[t] = max(cm[t], v[t])
    sx.charm_max = cm

    # base vector: points from decorations locked on the weapon
    base = [0] * (K + 4 + B)
    if "weapon" in ctx["lock_place"]:
        for _, d in ctx["lock_place"]["weapon"][0]:
            for s, lv in d["skills"].items():
                if s in Lsid:
                    k = sx.sids.index(s)
                    base[k] = min(base[k] + lv, sx.L[k])
    sx.zero = tuple(base)

    # layers
    layers = []
    for s in SLOTS:
        layers.append((s, _compress_slot(ctx, sx, s)))
    layers.sort(key=lambda x: (0 if x[0] in ctx["locks"] else 1, len(x[1]), SLOTS.index(x[0])))
    sx.layers = layers
    n = len(layers)
    opt_pts = [[0] * K for _ in range(n + 1)]
    opt_sl = [[0, 0, 0, 0] for _ in range(n + 1)]
    brest = [[0] * B for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        pieces = layers[i][1]
        for k in range(K):
            opt_pts[i][k] = opt_pts[i + 1][k] + max((p[0][k] for p in pieces), default=0)
        for t in (1, 2, 3):
            opt_sl[i][t] = opt_sl[i + 1][t] + max((sum(P[t][z] for z in p[4]) for p in pieces), default=0)
        for b in range(B):
            brest[i][b] = brest[i + 1][b] + (1 if any(p[0][sx.off_b + b] for p in pieces) else 0)
    sx.opt_pts, sx.opt_sl, sx.brest = opt_pts, opt_sl, brest
    # hard bonus feasibility after layer i: count >= req - remaining layers that can still add one
    sx.need_after = []
    for i in range(n):
        chk = []
        for b, (bid, e) in enumerate(sx.tb):
            if e["req"]:
                need = e["req"] - brest[i + 1][b]
                if need > 0:
                    chk.append((sx.off_b + b, need))
        sx.need_after.append(chk)
    sx.feasible = all(brest[0][b] >= e["req"] for b, (_, e) in enumerate(sx.tb) if e["req"])
    sx.lb = _make_lb(sx)
    return sx


def _compress_slot(ctx: dict, sx: _Scen, slot: str) -> list:
    """Pieces of one slot as (delta vector, defense, armor|None, owned flag, slots tuple), deduplicated and with
    dominated pieces removed. Locked pieces carry their locked decorations (points in, slots out)."""
    K = sx.K
    B = len(sx.tb)
    locked = slot in ctx["locks"]
    own = ctx["own"]
    own_armor = own["armor"] if own else None
    pref_owned = own_armor is not None and not ctx["owned_mode"]
    req_bonus = set(sx.req)
    cand = list(ctx["pool"][slot])
    if ctx["owned_mode"] and not locked:
        cand.append(None)
    items = []
    for a in cand:
        if a is None:
            sk, slots, bid, dfn = {}, [], None, 0
        else:
            sk = a["skills"]
            slots = list(a["slots"])
            bid, dfn = a["bonus_id"], a["defense_max"] or 0
            if locked and slot in ctx["lock_place"]:
                sk = dict(sk)
                placed, free = ctx["lock_place"][slot]
                for _, d in placed:
                    for s, lv in d["skills"].items():
                        sk[s] = sk.get(s, 0) + lv
                slots = sorted((z for _, z in free), reverse=True)
        pts = tuple(min(sk.get(s, 0), l) for s, l in zip(sx.sids, sx.L))
        bi = sx.tb_index.get(bid, -1) if bid else -1
        st = tuple((slots + [0, 0, 0])[:3])
        ow = 1 if (pref_owned and a is not None and a["id"] in own_armor) else 0
        items.append({"a": a, "pts": pts, "bi": bi, "slots": st, "def": dfn, "own": ow,
                      "req": bid in req_bonus})
    if not locked:
        # relevance: target points, tracked bonus, or Pareto-max slots
        sl = {it["slots"] for it in items}
        pmax = {s for s in sl if not any(o != s and all(x >= y for x, y in zip(o, s)) for o in sl)}
        items = [it for it in items if any(it["pts"]) or it["bi"] >= 0 or it["slots"] in pmax]
        # exact duplicates: keep owned, then best defense, then lowest id
        best: dict = {}
        for it in items:
            k = (it["pts"], it["slots"], it["bi"])
            cur = best.get(k)
            aid = it["a"]["id"] if it["a"] else 0
            if cur is None or (it["own"], it["def"], -aid) > (cur["own"], cur["def"], -(cur["a"]["id"] if cur["a"] else 0)):
                best[k] = it
        items = list(best.values())
        keep = []
        for it in items:
            dom = False
            for o in items:
                if o is it:
                    continue
                if (o["def"] >= it["def"] and o["own"] >= it["own"] and (it["bi"] < 0 or o["bi"] == it["bi"])
                        and all(x >= y for x, y in zip(o["pts"], it["pts"]))
                        and all(x >= y for x, y in zip(o["slots"], it["slots"]))):
                    dom = True
                    break
            if not dom:
                keep.append(it)
        items = keep
        if len(items) > PER_SLOT_CAP:
            P = sx.P

            def val(it):
                v = sum(TIER_W[sx.tier[k]] * it["pts"][k] for k in range(K))
                v += 0.8 * sum(TIER_W[t] * P[t][z] for z in it["slots"] for t in (1, 2, 3) if z)
                return v + it["def"] * 1e-3 + it["own"]
            ranked = sorted(items, key=lambda it: (-val(it), it["a"]["id"] if it["a"] else 0))
            must = [it for it in ranked if it["req"]]
            rest = [it for it in ranked if not it["req"]][:max(0, PER_SLOT_CAP - len(must))]
            items = must + rest
    out = []
    for it in sorted(items, key=lambda it: (it["a"]["id"] if it["a"] else 0)):
        cnt = [0, 0, 0, 0]
        for z in it["slots"]:
            if z:
                cnt[z - 1] += 1
        bvec = [0] * B
        if it["bi"] >= 0:
            bvec[it["bi"]] = 1
        out.append((it["pts"] + tuple(cnt) + tuple(bvec), it["def"], it["a"], it["own"], it["slots"]))
    return out


def _make_lb(sx: _Scen):
    K = sx.K
    Ls, tiers, jw, sup, gives = sx.L, sx.tier, sx.jewelable, sx.supply, sx.gives
    P1, P2, P3 = sx.P[1], sx.P[2], sx.P[3]
    w1, w2, w3 = sx.wcap[1], sx.wcap[2], sx.wcap[3]
    cm1, cm2, cm3 = sx.charm_max[1], sx.charm_max[2], sx.charm_max[3]
    opt_pts, opt_sl, brest = sx.opt_pts, sx.opt_sl, sx.brest
    rng = range(K)

    def lb(v, i):
        op = opt_pts[i]
        nj = [0, 0, 0, 0]
        jj = [0, 0, 0, 0]
        sh = [0, 0, 0, 0]
        for k in rng:
            a = v[k] + op[k]
            L = Ls[k]
            if a >= L:
                continue
            if a == 0 and gives[k]:
                br = brest[i]
                for off, r, b in gives[k]:
                    if v[off] + br[b] >= r:
                        a = 1
                        break
                if a >= L:
                    continue
            d = L - a
            t = tiers[k]
            if jw[k]:
                jj[t] += d
                if sup is not None and d > sup[k]:
                    sh[t] += d - sup[k]
            else:
                nj[t] += d
        c1, c2, c3, c4 = v[K], v[K + 1], v[K + 2], v[K + 3]
        os_ = opt_sl[i]
        cap1 = c1 * P1[1] + c2 * P1[2] + c3 * P1[3] + c4 * P1[4] + w1 + os_[1]
        cap2 = c1 * P2[1] + c2 * P2[2] + c3 * P2[3] + c4 * P2[4] + w2 + os_[2]
        cap3 = c1 * P3[1] + c2 * P3[2] + c3 * P3[3] + c4 * P3[4] + w3 + os_[3]
        x1 = nj[1] + max(jj[1] - cap1, sh[1], 0) - cm1
        x2 = nj[2] + max(jj[2] - cap2, sh[2], 0) - cm2
        x3 = nj[3] + max(jj[3] - cap3, sh[3], 0) - cm3
        slack = 4 * (cap1 - nj[1] - jj[1]) + 2 * (cap2 - nj[2] - jj[2]) + (cap3 - nj[3] - jj[3])
        return (x1 if x1 > 0 else 0, x2 if x2 > 0 else 0, x3 if x3 > 0 else 0), slack
    return lb


# ------------------------------------------------------------------ armor search
def _search_armor(sx: _Scen, layer_cap: int, threshold, deadline: float, stats: dict) -> list:
    """Layered DP. Returns up to FINALS final states as (lb, slack, def, combo indices per layer)."""
    if not sx.feasible:
        return []
    layers = sx.layers
    n = len(layers)
    caps = sx.caps
    lb = sx.lb
    states = [(sx.zero, 0, ())]
    t_start = time.perf_counter()
    for i, (_slot, pieces) in enumerate(layers):
        last = i == n - 1
        now = time.perf_counter()
        layer_deadline = now + max(0.0, deadline - now) / (n - i)
        chk = sx.need_after[i]
        nxt: dict = {}
        cnt = 0
        stop = False
        for v, dv, combo in states:
            for pi, p in enumerate(pieces):
                nv = tuple(map(min, map(add, v, p[0]), caps))
                if chk and any(nv[o] < need for o, need in chk):
                    continue
                nd = dv + p[1]
                cur = nxt.get(nv)
                if cur is None or nd > cur[0]:
                    nxt[nv] = (nd, combo + (pi,))
            cnt += len(pieces)
            if cnt >= CHECK_EVERY:
                stats["expansions"] = stats.get("expansions", 0) + cnt
                cnt = 0
                if time.perf_counter() > layer_deadline:
                    stop = True
                    break
        stats["expansions"] = stats.get("expansions", 0) + cnt
        if stop:
            stats["truncated"] = True
        scored = []
        for nv, (nd, combo) in nxt.items():
            b, slack = lb(nv, i + 1)
            if threshold is not None and b > threshold:
                continue
            scored.append((b, -slack, -nd, combo, nv))
        limit = FINALS if last else layer_cap
        if len(scored) > limit:
            scored = heapq.nsmallest(limit, scored)
            if not last:
                stats["truncated"] = True
        else:
            scored.sort()
        if last:
            stats["search_ms"] = stats.get("search_ms", 0) + (time.perf_counter() - t_start) * 1000
            return [(x[0], -x[1], -x[2], x[3], x[4]) for x in scored]
        states = [(x[4], -x[2], x[3]) for x in scored]
    return []


# ------------------------------------------------------------------ assessment of a concrete loadout
def _assess(D: dict, ctx: dict, armor: dict, charm: dict | None) -> dict:
    """Points from armor + locked decorations (+ charm), bonus counts, unlocked caps, free slots."""
    pts: dict = defaultdict(int)
    counts: dict = defaultdict(int)
    free = []
    dmax = 0
    for s in SLOTS:
        a = armor.get(s)
        if a is None:
            continue
        for sid, lv in a["skills"].items():
            pts[sid] += lv
        if a["bonus_id"]:
            counts[a["bonus_id"]] += 1
        dmax += a["defense_max"] or 0
        if s in ctx["lock_place"] and ctx["locks"].get(s) is a:
            free += ctx["lock_place"][s][1]
        else:
            free += [(s, z) for z in a["slots"]]
    if "weapon" in ctx["lock_place"]:
        free += ctx["lock_place"]["weapon"][1]
    else:
        free += [("weapon", z) for z in ctx["wslots"]]
    locked = []
    for p, (placed, _) in ctx["lock_place"].items():
        if p != "weapon" and ctx["locks"].get(p) is not armor.get(p):
            continue
        for slot, d in placed:
            locked.append((slot, d))
            for sid, lv in d["skills"].items():
                pts[sid] += lv
    if charm:
        for sid, lv in charm["skills"].items():
            pts[sid] += lv
    active = {sid for bid, n in counts.items() for r, sid in D["bonuses"][bid]["ranks"] if n >= r}
    unlocked = builds._unlocked(D, active, pts)
    return {"pts": pts, "counts": dict(counts), "active": active, "unlocked": unlocked, "free": free,
            "def": dmax, "locked": locked}


def _target_state(ctx: dict, pts: dict, active: set, unlocked: set) -> tuple[dict, dict, list]:
    """need: points still wanted per target (up to min(target, cap)); room: points until the cap;
    deficit per tier (including what no decoration can fix)."""
    need, room = {}, {}
    defi = [0, 0, 0, 0]
    for t in ctx["targets"]:
        sid = t["sid"]
        capk = t["max"] if sid in unlocked else t["cap"]
        p = pts.get(sid, 0)
        lvl = min(p, capk)
        if t["bonus_only"] or (lvl == 0 and sid in active):
            lvl = max(lvl, 1 if sid in active else 0)
        defi[t["tier"]] += max(0, t["level"] - lvl)
        if not t["bonus_only"]:
            need[sid] = max(0, min(t["level"], capk) - lvl)
            room[sid] = capk - p
    return need, room, defi


def _defi_after(ctx: dict, need0: dict, placed: list, base_defi: list) -> tuple:
    need = dict(need0)
    for _, e in placed:
        for s, lv in e.pts.items():
            if s in need:
                need[s] = max(0, need[s] - lv)
    d = list(base_defi)
    tiers = ctx["table"].tier
    for s, n0 in need0.items():
        d[tiers[s]] -= n0 - need[s]
    return (d[1], d[2], d[3])


# ------------------------------------------------------------------ decorations
def _fill_greedy(tab: _Table, need0: dict, room0: dict, slots: list, ctx: dict, base_defi: list):
    need = dict(need0)
    room = dict(room0)
    free = sorted(slots, key=lambda s: s[1])
    used: dict = defaultdict(int)
    placed = []
    tier = tab.tier
    for sid in tab.order:
        while need.get(sid, 0) > 0 and free:
            maxz = free[-1][1]
            best, bk = None, None
            for e in tab.by_skill[sid]:
                if e.size > maxz or (e.count is not None and used[e.idx] >= e.count):
                    continue
                g = min(e.pts[sid], need[sid])
                sec = sum(TIER_W[tier[s]] * min(lv, need.get(s, 0)) for s, lv in e.pts.items() if s != sid)
                # points over the cap are wasted (and /evaluate warns): allowed only when nothing cleaner helps as much
                over = _overflow(e, room)
                k = (g, sec, -over, -e.size, -e.rarity, -e.id)
                if bk is None or k > bk:
                    best, bk = e, k
            if best is None:
                break
            idx = next(i for i, s in enumerate(free) if s[1] >= best.size)
            placed.append((free.pop(idx), best))
            used[best.idx] += 1
            for s, lv in best.pts.items():
                if s in need:
                    need[s] = max(0, need[s] - lv)
            for s, lv in best.raw.items():
                room[s] = room.get(s, 0) - lv
    # one pass of simple swaps: drop a lower-tier decoration to cover a higher-tier point
    cur = _defi_after(ctx, need0, placed, base_defi)
    for sid in tab.order:
        if need.get(sid, 0) <= 0 or tier[sid] == 3:
            continue
        done = False
        for j, ((p, z), e) in enumerate(placed):
            if any(tier[s] <= tier[sid] for s in e.pts):
                continue
            for e2 in tab.by_skill[sid]:
                if e2.size > z or (e2.count is not None and used[e2.idx] - (e2 is e) >= e2.count):
                    continue
                trial = placed[:j] + [((p, z), e2)] + placed[j + 1:]
                d2 = _defi_after(ctx, need0, trial, base_defi)
                if d2 < cur:
                    used[e.idx] -= 1
                    used[e2.idx] += 1
                    placed, cur, done = trial, d2, True
                    break
            if done:
                break
        if done:
            need = dict(need0)
            for _, e in placed:
                for s, lv in e.pts.items():
                    if s in need:
                        need[s] = max(0, need[s] - lv)
    taken = [s for s, _ in placed]
    rest = list(slots)
    for s in taken:
        rest.remove(s)
    return placed, rest, cur


def _overflow(e: _Entry, room: dict) -> int:
    return sum(max(0, lv - max(0, room.get(s, 0))) for s, lv in e.raw.items())


def _total_overflow(placed: list, room0: dict) -> int:
    room = dict(room0)
    over = 0
    for _, e in placed:
        over += _overflow(e, room)
        for s, lv in e.raw.items():
            room[s] = room.get(s, 0) - lv
    return over


def _fill_exact(tab: _Table, need0: dict, room0: dict, slots: list, ctx: dict, base_defi: list, P: list,
                init: list, ideal: bool, deadline: float | None = None):
    """Branch and bound over slots (largest first).
    Objective: (deficit t1, t2, t3, hard jewels, points over the cap, used size)."""
    order = sorted(slots, key=lambda s: -s[1])
    n = len(order)
    remP = [[0, 0, 0, 0] for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for t in (1, 2, 3):
            remP[i][t] = remP[i + 1][t] + P[t][order[i][1]]
    tier = tab.tier
    cands = [e for e in tab.entries if any(need0.get(s, 0) > 0 for s in e.pts)]
    cands.sort(key=lambda e: (-sum(TIER_W[tier[s]] * min(lv, need0.get(s, 0)) for s, lv in e.pts.items()),
                              e.size, e.rarity, e.id))
    nc = len(cands)

    def sec_of(placed):
        return (sum(1 for _, e in placed if e.hard) if ideal else 0, _total_overflow(placed, room0),
                sum(e.size for _, e in placed))

    def obj(placed):
        return _defi_after(ctx, need0, placed, base_defi) + sec_of(placed)

    # map the initial (greedy) placements onto the same objective
    best = [obj(init), list(init)]
    need = dict(need0)
    room = dict(room0)
    used = [0] * nc
    chosen: list = []
    d0 = list(base_defi)
    nodes = [0]

    def cur_def():
        d = list(d0)
        for s, n0 in need0.items():
            d[tier[s]] -= n0 - need[s]
        return d

    def rec(i, last_j, sec_hard, sec_over, sec_size):
        nodes[0] += 1
        if nodes[0] > EXACT_NODES:
            return
        if deadline is not None and not nodes[0] & 1023 and time.perf_counter() > deadline:
            nodes[0] = EXACT_NODES + 1      # out of time: keep the best assignment found so far
            return
        d = cur_def()
        lbt = (max(0, d[1] - remP[i][1]), max(0, d[2] - remP[i][2]), max(0, d[3] - remP[i][3]))
        bd = best[0]
        if lbt > bd[:3] or (lbt == bd[:3] and (sec_hard, sec_over, sec_size) >= bd[3:]):
            return
        if i == n or all(v <= 0 for v in need.values()):
            o = (d[1], d[2], d[3], sec_hard, sec_over, sec_size)
            if o < bd:
                best[0] = o
                best[1] = list(chosen)
            return
        z = order[i][1]
        start = last_j if i > 0 and order[i - 1][1] == z else 0
        for j in range(start, nc + 1):
            if j == nc:
                rec(i + 1, j, sec_hard, sec_over, sec_size)
                break
            e = cands[j]
            if e.size > z or (e.count is not None and used[j] >= e.count):
                continue
            if not any(need.get(s, 0) > 0 for s in e.pts):
                continue
            over = _overflow(e, room)
            saved = {s: need[s] for s in e.pts if s in need}
            for s, lv in e.pts.items():
                if s in need:
                    need[s] = max(0, need[s] - lv)
            for s, lv in e.raw.items():
                room[s] = room.get(s, 0) - lv
            used[j] += 1
            chosen.append((order[i], e))
            rec(i + 1, j, sec_hard + (1 if (ideal and e.hard) else 0), sec_over + over, sec_size + e.size)
            chosen.pop()
            used[j] -= 1
            for s, lv in e.raw.items():
                room[s] += lv
            need.update(saved)
            if nodes[0] > EXACT_NODES:
                return

    rec(0, 0, 0, 0, 0)
    placed = best[1]
    taken = [s for s, _ in placed]
    rest = list(slots)
    for s in taken:
        rest.remove(s)
    return placed, rest, _defi_after(ctx, need0, placed, base_defi), nodes[0]


def _concrete(placed: list, owned_mode: bool) -> list:
    """Pick a concrete decoration id per merged entry (lowest rarity first; owned counts respected)."""
    out = []
    used: dict = defaultdict(int)
    for slot, e in sorted(placed, key=lambda x: (PIECES.index(x[0][0]), -x[1].size, x[1].id)):
        did = e.ids[0][1]
        if owned_mode:
            for rar, i, n in e.ids:
                if used[i] < (n or 0):
                    did = i
                    break
        used[did] += 1
        out.append((slot, did))
    return out


# ------------------------------------------------------------------ finals
def _charm_options(ctx: dict, need: dict, room: dict) -> list:
    if ctx["lock_charm"]:
        return [ctx["lock_charm"]]
    tab = ctx["table"]
    tiers = tab.tier
    scored = []
    for c in ctx["charms"]:
        sc = 0
        over = 0
        for sid, lv in c["skills"].items():
            if sid in need:
                sc += TIER_W[tiers[sid]] * min(lv, need[sid]) * tab.cost(sid)
                over += max(0, lv - room.get(sid, 0))
        if sc > 0:
            scored.append((-sc, over, c["rarity"] or 0, c["id"], c))
    scored.sort(key=lambda x: x[:4])
    out = []
    for x in scored[:CHARMS_TRIED]:
        c = _downgrade_charm(ctx, x[4], need, room)
        if c not in out:
            out.append(c)
    return out + [None]


def _downgrade_charm(ctx: dict, c: dict, need: dict, room: dict) -> dict:
    """Pareto pruning keeps the strongest charm of a family; when the extra levels are useless (they would go
    over the target or the cap), use the weakest one with the same useful coverage instead."""
    keys = set(c["skills"])

    def useful(x):
        return {s: min(x["skills"][s], need.get(s, 0)) for s in keys}
    want = useful(c)
    best, bk = c, None
    for x in ctx["charms_all"]:
        if set(x["skills"]) != keys or useful(x) != want:
            continue
        k = (sum(max(0, lv - room.get(s, lv)) for s, lv in x["skills"].items()), sum(x["skills"].values()),
             x["rarity"] or 0, x["id"])
        if bk is None or k < bk:
            best, bk = x, k
    return best


def _evaluate_final(D: dict, ctx: dict, sx: _Scen, armor: dict) -> list:
    """Charm first, then greedy decorations. Returns candidates (key, data)."""
    base = _assess(D, ctx, armor, None)
    need0, room0, _ = _target_state(ctx, base["pts"], base["active"], base["unlocked"])
    out = []
    for c in _charm_options(ctx, need0, room0):
        st = _assess(D, ctx, armor, c) if c else base
        need, room, defi = _target_state(ctx, st["pts"], st["active"], st["unlocked"])
        placed, rest, d = _fill_greedy(ctx["table"], need, room, st["free"], ctx, defi)
        out.append(_cand(ctx, sx, armor, c, st, need, room, defi, placed, rest, d, exact=False))
    return out


def _cand(ctx, sx, armor, charm, st, need, room, defi, placed, rest, d, exact):
    ideal = not ctx["owned_mode"]
    own = ctx["own"]
    hard = sum(1 for _, e in placed if e.hard) if ideal else 0
    owned_n = 0
    if ideal and own:
        owned_n = sum(1 for a in armor.values() if a is not None and a["id"] in own["armor"])
    free_cap = sum(z for _, z in rest)
    ids = tuple((armor.get(s) or {}).get("id", 0) for s in SLOTS) + ((charm or {}).get("id", 0),)
    jids = tuple(sorted(e.id for _, e in placed))
    key = (d[0], d[1], d[2], hard, -owned_n, -free_cap, -st["def"], ids, jids)
    return {"key": key, "armor": armor, "charm": charm, "st": st, "need": need, "room": room, "defi": defi,
            "placed": placed, "rest": rest, "deficit": d, "sx": sx, "exact": exact}


def _diverse(cands: list, k: int, ctx: dict) -> list:
    free_pos = [i for i, s in enumerate(SLOTS) if s not in ctx["locks"]] + ([] if ctx["lock_charm"] else [5])

    def diff(a, b):
        return sum(1 for i in free_pos if a["key"][7][i] != b["key"][7][i])
    picked = []
    for need in (2, 1):
        for c in cands:
            if len(picked) >= k:
                break
            if any(c is p for p in picked):
                continue
            if all(diff(c, p) >= need for p in picked):
                picked.append(c)
    picked.sort(key=lambda c: c["key"])
    return picked


# ------------------------------------------------------------------ output
def _skill_es(D: dict, sid: int) -> str:
    return D["skills"][sid]["name_es"]


def _covers_es(D: dict, deco: dict) -> str:
    return ", ".join(f"{_skill_es(D, s)} +{lv}" for s, lv in deco["skills"].items())


def _unlock_name(D: dict, sid: int, active: set) -> str | None:
    st = _static(D)
    for b, r in st["unlockers"].get(sid, []) + st["ua_alts"]:
        for req, s in D["bonuses"][b]["ranks"]:
            if s in active and (s == D.get("unlock_all") or D["unlocks"].get(s) == sid):
                return _bname(D, b)
    return None


def coverage(D: dict, ev: dict, targets: list, info: dict | None = None) -> list:
    """Per target: where its levels come from and whether it is complete. `targets`: dicts with sid/level/tier.
    `info` (optional): {"has_jewel": set, "not_owned": set, "rank": str} to explain what is missing."""
    info = info or {}
    st = _static(D)
    free_sizes = [f["size"] for f in ev.get("slots_free", [])]
    if "has_jewel" not in info:       # called from /evaluate: derive jewel availability from the catalog
        info = {**info, "has_jewel": {s for d in D["decos"].values() for s in d["skills"]}}
    by = {s["skill_id"]: s for s in ev["skills"]}
    active = {b["skill_id"] for b in ev["set_bonuses"] if b["active"]}
    out = []
    for t in targets:
        sid = t["sid"]
        s = D["skills"][sid]
        sk = by.get(sid)
        achieved = sk["level"] if sk else 0
        frm = {"armadura": 0, "amuleto": 0, "joya": 0}
        bonus = False
        for src in (sk["source"] if sk else []):
            f = src.get("from")
            if f in SLOTS:
                frm["armadura"] += src.get("points", 0)
            elif f == "charm":
                frm["amuleto"] += src.get("points", 0)
            elif f == "decoration":
                frm["joya"] += src.get("points", 0)
            elif f == "set_bonus":
                bonus = True
        unlocked = builds._unlocked(D, active, {x: by[x]["points"] for x in by})
        cap = s["max_level"] if sid in unlocked else s["cap"]
        cap_by = _unlock_name(D, sid, active) if cap > s["cap"] else None
        L = t["level"]
        status = "ok" if achieved >= L else ("parcial" if achieved > 0 else "falta")
        reason = None
        if status != "ok":
            if L > cap:
                reason = "cap_locked"
            elif sid in st["bonus_only"]:
                reason = "cap_locked"
            elif "has_jewel" in info and sid not in info["has_jewel"]:
                reason = "no_jewel"
            elif sid in info.get("not_owned", set()) or (
                    (info.get("owned_supply") or {}).get(sid, None) is not None
                    and info["owned_supply"][sid] < frm["joya"] + (L - achieved)):
                reason = "jewel_not_owned"
            else:
                need = min((d["slot"] for d in D["decos"].values() if sid in d["skills"]), default=NO_JEWEL_COST)
                # a free slot that fits the jewel exists: the gap is a missing jewel, not a lack of slots
                reason = "falta_joya" if any(z >= need for z in free_sizes) else "no_slot"
        parts = []
        for k, lab in (("armadura", "armadura"), ("amuleto", "amuleto"), ("joya", "joyas")):
            if frm[k]:
                parts.append(f"{lab} {frm[k]}")
        if bonus:
            parts.append("bono de set")
        text = f"{s['name_es']} {achieved}/{L}" + (f" ({', '.join(parts)})" if parts else "")
        out.append({"skill_id": sid, "name_es": s["name_es"], "tier": t["tier"], "target": L, "achieved": achieved,
                    "cap": cap, "cap_unlocked_by": cap_by, "from": frm, "bonus": bonus, "status": status,
                    "reason": reason, "text_es": text})
    return out


def _tradeoffs(D: dict, ctx: dict, cov: list, cand: dict, placed_out: list) -> list:
    st = _static(D)
    tab = ctx["table_ideal"]
    order = {"cap_locked": 0, "no_jewel": 1, "jewel_not_owned": 2, "falta_joya": 3, "no_slot": 4}
    lines = []
    for c in sorted([c for c in cov if c["reason"]], key=lambda c: (order[c["reason"]], c["tier"])):
        pre = TIER_ES[c["tier"]]
        name, a, L = c["name_es"], c["achieved"], c["target"]
        head = f"{pre}: {name} baja a {a}/{L}" if a else f"{pre}: {name} no entra"
        sid = c["skill_id"]
        if c["reason"] == "cap_locked":
            if sid in st["bonus_only"]:
                alts = st["inv"].get(sid, [])
                lines.append(f"{pre}: {name} no entra: solo la da el bono {_alts_es(D, sorted(set(alts), key=lambda x: (x[1], x[0])))}")
            else:
                alts = sorted(set(st["unlockers"].get(sid, []) + st["ua_alts"]), key=lambda x: (x[1], x[0]))
                rng = f"{c['cap'] + 1}-{L}" if L > c["cap"] + 1 else f"{L}"
                lines.append(f"{pre}: {name} {a}/{L}: " + (f"los niveles {rng} necesitan" if L > c["cap"] + 1
                                                          else f"el nivel {rng} necesita") + f" el bono {_alts_es(D, alts)}")
        elif c["reason"] == "no_jewel":
            lines.append(f"{head}: no hay joyas de esta habilidad en {ctx['rank']}")
        elif c["reason"] == "jewel_not_owned":
            lines.append(f"{head}: no tienes joyas suficientes de esta habilidad")
        elif c["reason"] == "falta_joya":
            lines.append(f"{head}: aún quedan ranuras libres donde cabe una joya de esta habilidad; falta colocarla")
        else:
            z = tab.cost(sid)
            occ = []
            for (p, size), dd in sorted(placed_out, key=lambda x: min((ctx["table"].tier.get(s, 9) for s in x[1]["skills"]), default=9)):
                if size >= z:
                    for s in dd["skills"]:
                        if s in ctx["table"].tier and _skill_es(D, s) not in occ:
                            occ.append(_skill_es(D, s))
            extra = f" (las ocupan {', '.join(occ[:3])})" if occ else ""
            lines.append(f"{head}: no queda ranura libre de tamaño {z} o más{extra}")
    ch = cand["charm"]
    if ch:
        tab0 = ctx["table"]
        def _contrib(cv: dict, l: int) -> int:   # only what the charm itself adds toward this target
            return min(l, cv["target"], cv["achieved"], cv["from"]["amuleto"])
        lv = sum(_contrib(c, l) for c in cov for s, l in ch["skills"].items() if s == c["skill_id"])
        slots = 0
        for s, l in ch["skills"].items():
            cv = next((c for c in cov if c["skill_id"] == s), None)
            if cv:
                n = _contrib(cv, l)
                es = tab0.by_skill.get(s) or []
                per = max((e.pts[s] for e in es if e.size == tab0.minsize.get(s)), default=1)
                slots += -(-n // per) if es else 0
        if lv:
            txt = f"El amuleto «{ch['name_es'] or ch['name_en']}» cubre {lv} nivel{'es' if lv != 1 else ''}"
            txt += f" que costarían {slots} ranura{'s' if slots != 1 else ''}" if slots else " (ninguna joya lo sustituye)"
            lines.append(txt)
    return lines


def _piece_role(D: dict, ctx: dict, a: dict, req_bonus: set) -> str:
    tset = {t["sid"] for t in ctx["targets"]}
    gives = [f"{_skill_es(D, s)} +{lv}" for s, lv in a["skills"].items() if s in tset]
    if gives:
        return "Aporta " + ", ".join(gives)
    if a["bonus_id"] and a["bonus_id"] in req_bonus:
        return f"Solo activa el bono «{_bname(D, a['bonus_id'])}»"
    if a["slots"]:
        return "Aporta ranuras " + "-".join(str(z) for z in a["slots"])
    return "No aporta a los objetivos"


def _missing(D: dict, ctx: dict, cand: dict, deco_ids: list) -> dict:
    own = ctx["own"]
    out = {"jewels": [], "pieces": [], "charm_owned": None}
    if own is None:
        return out
    band = ctx["band"]
    out["pieces"] = [a["id"] for a in cand["armor"].values() if a is not None and a["id"] not in own["armor"]]
    ch = cand["charm"]
    if ch is not None and own.get("charms") is not None:
        out["charm_owned"] = ch["id"] in own["charms"]
    have = dict(own["decorations"])
    for d in ctx["lock_deco_use"]:
        have[d] = have.get(d, 0) - ctx["lock_deco_use"][d]
    need: dict = defaultdict(int)
    if ctx["owned_mode"]:
        st = cand["st"]
        placed, _, d = _fill_greedy(ctx["table_ideal"], cand["need"], cand["room"], st["free"], ctx, cand["defi"])
        if d < cand["deficit"]:
            groups = defaultdict(int)       # owned count per (size, trimmed target skills)
            for e in ctx["table"].entries:
                groups[(e.size, tuple(sorted(e.pts.items())))] += e.count or 0
            for _, e in placed:
                need[(e.size, tuple(sorted(e.pts.items())), e.ids[0][1])] += 1
            for (size, key, did), n in sorted(need.items()):
                short = n - groups.get((size, key), 0)
                if short > 0:
                    out["jewels"].append(_miss_row(D, band, did, short))
    else:
        cnt: dict = defaultdict(int)
        for did in deco_ids:
            cnt[did] += 1
        for did, n in sorted(cnt.items()):
            short = n - max(0, have.get(did, 0))
            if short > 0:
                out["jewels"].append(_miss_row(D, band, did, short))
    return out


def _miss_row(D, band, did, n):
    d = D["decos"][did]
    diff = builds._deco_difficulty(band, d["rarity"] or 0)
    name = d["name_es"] or d["name_en"]
    cov = _covers_es(D, d)
    return {"decoration_id": did, "name_es": name, "count": n, "covers_es": cov, "difficulty": diff,
            "text_es": f"Te falta {n}× {name} ({cov}, {diff})"}


def _result_out(D: dict, ctx: dict, cand: dict, idx: int) -> dict:
    armor = cand["armor"]
    charm = cand["charm"]
    own = ctx["own"]
    owned_mode = ctx["owned_mode"]
    pieces = {s: a["id"] for s, a in armor.items() if a is not None}
    if charm:
        pieces["charm"] = charm["id"]
    lockedj = [(slot, d["id"], True) for slot, d in cand["st"]["locked"]]
    freej = [(slot, did, False) for slot, did in _concrete(cand["placed"], owned_mode)]
    allj = sorted(lockedj + freej, key=lambda x: (PIECES.index(x[0][0]), -D["decos"][x[1]]["slot"], x[1]))
    deco_list = [{"id": did, "piece": slot[0]} for slot, did, _ in allj]
    ev = builds.evaluate_loadout(pieces, deco_list, ctx["wslots"])
    band = ctx["band"]
    have = dict(own["decorations"]) if own else None
    placed_ev = [(x["piece"], x["slot_size"]) for x in ev["decorations"]]   # same order as deco_list
    deco_out = []
    for (slot, did, lk), (piece, size) in zip(allj, placed_ev):
        d = D["decos"][did]
        o = {"piece": piece, "slot_size": size, "decoration_id": did, "name_es": d["name_es"] or d["name_en"],
             "name_en": d["name_en"], "size": d["slot"], "rarity": d["rarity"],
             "difficulty": builds._deco_difficulty(band, d["rarity"] or 0), "locked": lk,
             "skills": [{"skill_id": s, "name_es": _skill_es(D, s), "level": l} for s, l in d["skills"].items()]}
        if have is not None:
            o["owned"] = have.get(did, 0) > 0
            if o["owned"]:
                have[did] -= 1
        deco_out.append(o)
    own_armor = own["armor"] if own else None
    req_bonus = set(cand["sx"].req)
    pieces_out = []
    for s in SLOTS:
        a = armor.get(s)
        if a is None:
            pieces_out.append({"type": s, "empty": True, "locked": False})
            continue
        po = builds._piece_out(a, own_armor)
        po["locked"] = s in ctx["locks"]
        po["aporta_es"] = _piece_role(D, ctx, a, req_bonus)
        pieces_out.append(po)
    charm_out = None
    if charm:
        sk = [f"{_skill_es(D, s)} {l}" for s, l in charm["skills"].items()]
        charm_out = {**builds._charm_out(charm), "generic_es": "Amuleto con " + " y ".join(sk),
                     "skills": [{"skill_id": s, "name_es": _skill_es(D, s), "level": l} for s, l in charm["skills"].items()],
                     "locked": ctx["lock_charm"] is not None}
        if own is not None and own.get("charms") is not None:
            charm_out["owned"] = charm["id"] in own["charms"]
    has_jewel = set(ctx["table_ideal"].by_skill)
    not_owned = set()
    if owned_mode:
        not_owned = {s for s in has_jewel if s not in ctx["table"].by_skill}
    cov = coverage(D, ev, ctx["targets"], {"has_jewel": has_jewel, "not_owned": not_owned, "rank": ctx["rank"],
                                           "owned_supply": dict(ctx["table"].supply) if owned_mode else None})
    placed_out = [(ps, D["decos"][did]) for ps, (_, did, _) in zip(placed_ev, allj)]
    missing = _missing(D, ctx, cand, [did for _, did, lk in allj if not lk])
    if owned_mode:
        short = {s for j in missing["jewels"] for s in D["decos"][j["decoration_id"]]["skills"]}
        for c in cov:
            if c["reason"] == "no_slot" and c["skill_id"] in short:
                c["reason"] = "jewel_not_owned"
    trade = _tradeoffs(D, ctx, cov, cand, placed_out)
    for a in armor.values():
        if a is not None and a["bonus_id"] in req_bonus:
            role = _piece_role(D, ctx, a, req_bonus)
            trade.append(f"{a['name_es'] or a['name_en']} ({SLOT_ES[a['type']]}): " + role[0].lower() + role[1:])
    set_names = []
    for s in SLOTS:
        a = armor.get(s)
        if a and (a["set_es"] or a["set_en"]) not in set_names:
            set_names.append(a["set_es"] or a["set_en"])
    d = cand["deficit"]
    out = dict(ev)
    out.update({
        "name_es": f"Opción {idx + 1}: " + " + ".join(set_names[:3]) + ("…" if len(set_names) > 3 else ""),
        "scenario_es": cand["sx"].label_es,
        "loadout": {"pieces": pieces, "charm": charm["id"] if charm else None, "decorations": deco_list,
                    "weapon_slots": list(ctx["wslots"])},
        "pieces": pieces_out,
        "charm": charm_out,
        "decorations": deco_out,
        "deficit": {"t1": d[0], "t2": d[1], "t3": d[2]},
        "set_bonuses": [b for b in ev["set_bonuses"] if b["active"]],
        "skills": [{k: s[k] for k in ("skill_id", "name_es", "name_en", "level", "max")} for s in ev["skills"]],
        "warnings": ctx["warnings"] + ev["warnings"],
        "coverage": cov,
        "tradeoffs_es": trade,
        "missing": missing,
    })
    return out


# ------------------------------------------------------------------ main
def solve_plan(body: SolveBody, own: dict | None) -> dict:
    t0 = time.perf_counter()
    budget = body.time_budget_ms / 1000.0
    D = builds._load()
    mode = body.mode
    notes_extra = []
    if mode == "owned" and own is None:
        notes_extra.append("Tu save no tiene todavía el cofre de equipo: se usa el catálogo completo.")
    ctx = _context(D, body, own, mode)
    ctx["notes"] += notes_extra
    scenarios, scen_notes, _unreachable = _expand_targets(D, ctx)
    stats: dict = {"truncated": False}
    base_out = {"mode": ctx["mode"], "owned_available": own is not None, "scenario_notes_es": scen_notes,
                "notes": ctx["notes"]}
    if not scenarios:
        return {**base_out, "results": [], "truncated": False,
                "elapsed_ms": round((time.perf_counter() - t0) * 1000)}
    K = body.max_results
    # time plan: armor search + charm/greedy decorations per scenario until 75 %, exact polish until 92 %,
    # the rest is left for building the output (evaluate_loadout per result)
    stage_end = t0 + budget * 0.75
    exact_end = t0 + budget * 0.92
    cands: list = []
    for i, req in enumerate(scenarios):
        sx = _scenario(D, ctx, req)
        if not sx.feasible:
            continue
        now = time.perf_counter()
        share = max(0.0, stage_end - now) / (len(scenarios) - i)
        fin_end = now + share
        # seed incumbents with a narrow pass, then the full search pruned against the K-th incumbent
        seed = _search_armor(sx, SEED_LAYER_CAP, None, now + share * 0.1, {})   # narrow on purpose: not "truncated"
        seen = set()
        for f in seed:
            armor = _armor_of(sx, f[3])
            seen.add(tuple((armor.get(s) or {}).get("id", 0) for s in SLOTS))
            cands += _evaluate_final(D, ctx, sx, armor)
        thr = _threshold(cands, K, ctx)
        finals = _search_armor(sx, LAYER_CAP, thr, now + share * 0.7, stats)
        for f in finals:                    # best lower bound first: stop when the scenario's time is up
            if time.perf_counter() > fin_end:
                stats["truncated"] = True
                break
            armor = _armor_of(sx, f[3])
            k = tuple((armor.get(s) or {}).get("id", 0) for s in SLOTS)
            if k in seen:
                continue
            seen.add(k)
            cands += _evaluate_final(D, ctx, sx, armor)
    cands.sort(key=lambda c: c["key"])
    # exact polish of the best finalists (greedy only when time is short)
    ideal = not ctx["owned_mode"]
    polished = []
    n_exact = 0
    for c in cands[:2 * K]:
        if time.perf_counter() > exact_end:
            stats["truncated"] = True
            break
        sx = c["sx"]
        placed, rest, d, _n = _fill_exact(ctx["table"], c["need"], c["room"], c["st"]["free"], ctx, c["defi"],
                                          sx.P, c["placed"], ideal, exact_end)
        polished.append(_cand(ctx, sx, c["armor"], c["charm"], c["st"], c["need"], c["room"], c["defi"],
                              placed, rest, d, exact=True))
        n_exact += 1
    polished += cands[n_exact:2 * K]
    allc = sorted(polished + cands[2 * K:], key=lambda c: c["key"])
    picked = _diverse(allc, K, ctx)
    results = [_result_out(D, ctx, c, i) for i, c in enumerate(picked)]
    notes = ctx["notes"]
    if stats.get("truncated"):
        notes.append("La búsqueda se recortó por tiempo o tamaño: puede haber combinaciones algo mejores.")
    if not results:
        if ctx["empty_slots"]:
            notes.append("No hay combinación posible: falta al menos una pieza de "
                         + ", ".join(SLOT_ES[s] for s in ctx["empty_slots"]) + ".")
        else:
            notes.append("No se encontró ninguna combinación que cumpla los bonos obligatorios con estas piezas.")
    return {**base_out, "results": results, "truncated": bool(stats.get("truncated")),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000),
            "stats": {"expansions": stats.get("expansions", 0), "scenarios": len(scenarios),
                      "candidates": len(cands)}}


def _armor_of(sx: _Scen, combo: tuple) -> dict:
    out = {s: None for s in SLOTS}
    for (slot, pieces), pi in zip(sx.layers, combo):
        out[slot] = pieces[pi][2]
    return out


def _threshold(cands: list, k: int, ctx: dict):
    if not cands:
        return None
    srt = sorted(cands, key=lambda c: c["key"])
    picked = _diverse(srt, k, ctx)
    if len(picked) < k:
        return None
    return max(c["key"][:3] for c in picked)


def _memo_key(D: dict, body: SolveBody, own: dict | None) -> str:
    osig = None
    if own is not None:
        osig = (sorted(own["armor"]), sorted(own["decorations"].items()),
                None if own.get("charms") is None else sorted(own["charms"]))
    return json.dumps([body.model_dump(mode="json"), osig, D["data_sig"], D["rules_hash"]], sort_keys=True)


@router.post("/solve")
def solve(body: SolveBody):
    D = builds._load()
    own = builds.owned_from_snapshot(builds._latest_snapshot())
    key = _memo_key(D, body, own)
    memo = builds._cache.setdefault("plan_memo", {})
    if key in memo:
        return {**memo[key], "cached": True}
    if not _sem.acquire(timeout=body.time_budget_ms / 1000.0):
        raise HTTPException(429, "Ya hay un cálculo en curso")
    try:
        out = solve_plan(body, own)
    finally:
        _sem.release()
    memo = builds._cache.setdefault("plan_memo", {})
    while len(memo) >= MEMO_MAX:
        memo.pop(next(iter(memo)))
    memo[key] = out
    return {**out, "cached": False}
