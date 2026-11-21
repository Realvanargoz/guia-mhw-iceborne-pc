import hmac
import sqlite3
from collections import defaultdict
from contextlib import asynccontextmanager

from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import settings
from .areas import parse_areas
from .bestiary import router as bestiary_router
from .builds import router as builds_router
from .planner import router as planner_router
from .planner_store import router as planner_store_router
from .planner_rules import router as planner_rules_router
from .catalog_lists import router as catalog_lists_router
from .calendar import router as calendar_router
from .canteen import router as canteen_router
from . import db
from . import search as search_index  # el nombre no debe chocar con la ruta `search`
from .desktop import ActivityMiddleware, router as desktop_router
from .db import J, all_, execute, one, one_or_404
from .loot import router as loot_router
from .melder import router as melder_router
from .profile import router as profile_router
from .static import mount_web
from .validation import ID_PATTERN, Note, filter_q, limit_q, text_q

RANK_ORDER = {"MR": 0, "HR": 1, "LR": 2, None: 3}
TYPE_PRIORITY = ["item", "monster", "armor_set", "layered", "achievement", "quest", "guide", "location",
                 "armor", "weapon", "skill", "decoration", "charm"]
PROGRESS_TYPES = {"achievement", "layered", "armor_set", "monster_hunted", "monster_captured", "item", "quest",
                  "ingredient"}   # ingredient: entity_id = canteen_ingredients.id (ing_*)


@asynccontextmanager
async def lifespan(_app):
    db.init()
    db.open_pool()
    db.limit_threadpool(8)
    search_index.warm()  # índice de búsqueda en un hilo de fondo
    try:
        yield
    finally:
        db.close_pool()


class UTF8JSONResponse(JSONResponse):
    # Explicit charset: clients that guess Latin-1 for a bare "application/json" (e.g. Windows PowerShell 5.1
    # Invoke-RestMethod) turned "α" into "Î±". The body was always valid UTF-8.
    media_type = "application/json; charset=utf-8"


app = FastAPI(title="MHW Iceborne PC Guide API", lifespan=lifespan, root_path="",
              default_response_class=UTF8JSONResponse,
              docs_url="/docs" if settings.DOCS_ENABLED else None,
              redoc_url="/redoc" if settings.DOCS_ENABLED else None,
              openapi_url="/openapi.json" if settings.DOCS_ENABLED else None)
# No CORS on purpose: same-origin only. Host check + custom header + Origin check guard the local API.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)
app.add_middleware(ActivityMiddleware)  # marca actividad de /api (la usa el modo sin Edge del lanzador)
_ALLOWED_HOSTNAMES = {h.lower() for h in settings.ALLOWED_HOSTS}
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_MAX_JSON_BODY = 256 * 1024
_MAX_UPLOAD_BODY = 33 * 1024 * 1024


def _token_ok(candidate: str | None) -> bool:
    tok = settings.SESSION_TOKEN
    return bool(tok) and candidate is not None and hmac.compare_digest(candidate.encode("utf-8"), tok.encode("utf-8"))


@app.middleware("http")
async def _guard_writes(request: Request, call_next):
    # Error precedence for /api when SESSION_TOKEN is set: 401 (no/invalid session cookie, any method; only
    # GET /api/health is exempt) -> 400/411/413 (body framing) -> 403 (X-MHW-Client / Origin) -> handler.
    path = request.url.path
    if settings.SESSION_TOKEN:
        if request.method == "GET" and path == "/" and "t" in request.query_params:
            # Entry from the launcher: trade the one-time URL token for an HttpOnly cookie and drop it from the URL.
            if _token_ok(request.query_params.get("t")):  # bad token: falls through to the public SPA, no cookie
                resp = Response(status_code=302, headers={"Location": "/", "Cache-Control": "no-store",
                                                          "Referrer-Policy": "no-referrer"})
                resp.set_cookie("mhw_session", settings.SESSION_TOKEN, httponly=True, samesite="strict", path="/")
                return resp
        if (path == "/api" or path.startswith("/api/")) and not (request.method == "GET" and path == "/api/health"):
            if not _token_ok(request.cookies.get("mhw_session")):
                return JSONResponse({"detail": "Sesión no válida"}, status_code=401,
                                    headers={"Cache-Control": "no-store"})
    if request.method in _WRITE_METHODS and request.url.path.startswith("/api"):
        try:
            clen = int(request.headers.get("content-length") or 0)
        except ValueError:
            return JSONResponse({"detail": "Content-Length no válido"}, status_code=400)
        if "transfer-encoding" in request.headers:  # chunked bodies would bypass the Content-Length caps below
            return JSONResponse({"detail": "Se requiere Content-Length"}, status_code=411)
        is_upload = request.url.path == "/api/profile/upload"
        if clen < 0 or clen > (_MAX_UPLOAD_BODY if is_upload else _MAX_JSON_BODY):
            return JSONResponse({"detail": "Cuerpo demasiado grande"}, status_code=413)
        if request.headers.get("x-mhw-client") != "1":
            return JSONResponse({"detail": "Falta la cabecera X-MHW-Client"}, status_code=403)
        origin = request.headers.get("origin")
        if origin is not None:
            try:
                host = (urlsplit(origin).hostname or "").lower()
            except ValueError:
                host = ""
            if host not in _ALLOWED_HOSTNAMES:
                return JSONResponse({"detail": "Origen no permitido"}, status_code=403)
    resp = await call_next(request)
    if request.url.path.startswith("/api"):
        resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError):
    # Default handler echoes the offending input; JSON like {"x": 1e999999} (inf) made that serialisation raise
    # (500). Return only location + message, never the input.
    errs = [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "")), "type": str(e.get("type", ""))}
            for e in exc.errors()]
    return JSONResponse({"detail": errs}, status_code=422)


@app.exception_handler(OverflowError)
async def _overflow_error(_request: Request, _exc: Exception):
    # ints beyond SQLite's 64-bit range coming from user input: 422 instead of a 500
    return JSONResponse({"detail": "Valor fuera de rango o no válido"}, status_code=422)


@app.exception_handler(sqlite3.DataError)
async def _data_error(_request: Request, _exc: Exception):
    # oversized strings/blobs, etc. coming from user input: 422 instead of a 500
    return JSONResponse({"detail": "Valor fuera de rango o no válido"}, status_code=422)


@app.exception_handler(sqlite3.Error)
async def _sqlite_error(_request: Request, _exc: Exception):
    return JSONResponse({"detail": "Error de base de datos"}, status_code=500)


app.include_router(calendar_router)
app.include_router(profile_router)
app.include_router(bestiary_router)
app.include_router(builds_router)
app.include_router(planner_router)
app.include_router(planner_rules_router)
app.include_router(planner_store_router)
app.include_router(catalog_lists_router)
app.include_router(canteen_router)
app.include_router(loot_router)
app.include_router(melder_router)
app.include_router(desktop_router)


def _by(rows: list[dict], key: str) -> dict:
    out = defaultdict(list)
    for r in rows:
        out[r[key]].append(r)
    return out


def _progress(entity_type: str, ids: list) -> dict:
    if not ids:
        return {}
    rows = all_("SELECT entity_id, done, notes FROM progress WHERE entity_type = ? "
                "AND entity_id IN (SELECT value FROM json_each(?))",
                (entity_type, J([str(i) for i in ids])))
    return {r["entity_id"]: r for r in rows}


def _guides_for(ref_type: str, name_en: str) -> list[dict]:
    return all_("SELECT slug, kind, title_es, summary_es, needs_review FROM guides "
                "WHERE EXISTS (SELECT 1 FROM json_each(related) j WHERE j.value->>'$.type' = ? "
                "AND j.value->>'$.name_en' = ?) ORDER BY kind, title_es NULLS LAST", (ref_type, name_en))


# ----------------------------------------------------------------- general

@app.get("/api/health")
def health():
    one("SELECT 1 AS ok")
    return {"ok": True}


@app.get("/api/stats")
def stats():
    counts = one("""
      SELECT (SELECT count(*) FROM items WHERE category <> 'hidden') items,
             (SELECT count(*) FROM monsters WHERE size = 'large') large_monsters,
             (SELECT count(*) FROM armor_sets) armor_sets,
             (SELECT count(*) FROM armor) armor,
             (SELECT count(*) FROM weapons) weapons,
             (SELECT count(*) FROM quests) quests,
             (SELECT count(*) FROM layered_armor) layered,
             (SELECT count(*) FROM achievements) achievements,
             (SELECT count(*) FROM guides) guides,
             (SELECT count(*) FROM locations) locations,
             (SELECT count(*) FROM festivals) festivals""")
    return {"counts": counts, "progress": progress_summary()}


@app.get("/api/search")
def search(q: str = text_q(..., min_length=1), type: str | None = filter_q(), limit: int = limit_q(40, 200)):
    q = q.strip()
    return {"q": q, "results": search_index.search(q, type, limit)}


# ------------------------------------------------------------------- items

@app.get("/api/items")
def items(category: str | None = filter_q(), rarity: int | None = Query(None, ge=0, le=99), q: str | None = text_q(),
          limit: int = limit_q(300)):
    return all_("""
      SELECT id, name_es, name_en, category, subcategory, rarity, icon_name, icon_color FROM items
      WHERE category <> 'hidden' AND (:c IS NULL OR category = :c)
        AND (:r IS NULL OR rarity = :r)
        AND (:q IS NULL OR f_norm(coalesce(name_es,'') || ' ' || name_en) LIKE '%' || f_norm(:q) || '%')
      ORDER BY rarity NULLS LAST, coalesce(name_es, name_en) LIMIT :l""", {"c": category, "r": rarity, "q": q, "l": limit})


@app.get("/api/items/{item_id}")
def item(item_id: int):
    it = one_or_404("SELECT * FROM items WHERE id = ?", (item_id,), "objeto")

    drops = all_("""
      SELECT m.id monster_id, m.name_es monster_es, m.name_en monster_en, m.size, r.rank,
             c.name_es condition_es, c.name_en condition_en, c.kind, r.stack, r.percentage
      FROM monster_rewards r JOIN monsters m ON m.id = r.monster_id JOIN reward_conditions c ON c.id = r.condition_id
      WHERE r.item_id = ? ORDER BY m.name_en NULLS LAST, r.rank NULLS LAST, r.percentage DESC NULLS FIRST""", (item_id,))
    by_monster = []
    for mid, rows in _by(drops, "monster_id").items():
        ranks = defaultdict(list)
        for r in rows:
            ranks[r["rank"]].append({k: r[k] for k in ("condition_es", "condition_en", "kind", "stack", "percentage")})
        best = max(rows, key=lambda r: (-RANK_ORDER.get(r["rank"], 3), r["percentage"] or 0))
        by_monster.append({"monster_id": mid, "monster_es": rows[0]["monster_es"], "monster_en": rows[0]["monster_en"],
                           "size": rows[0]["size"],
                           "ranks": dict(sorted(ranks.items(), key=lambda kv: RANK_ORDER.get(kv[0], 3))),
                           "best": {"rank": best["rank"], "condition_es": best["condition_es"],
                                    "percentage": best["percentage"]}})
    by_monster.sort(key=lambda m: (RANK_ORDER.get(m["best"]["rank"], 3), -(m["best"]["percentage"] or 0)))

    gathering = all_("""
      SELECT l.id location_id, l.name_es location_es, l.name_en location_en, li.area, li.rank, li.stack,
             li.percentage, li.nodes, li.notes_es, li.source,
             (SELECT group_concat(coalesce(cp.name_es, cp.name_en), ', ') FROM location_camps cp
               WHERE cp.location_id = l.id AND cp.area = li.area) AS camp_here
      FROM location_items li JOIN locations l ON l.id = li.location_id
      WHERE li.item_id = ? ORDER BY l.id, li.area NULLS LAST, li.rank NULLS FIRST""", (item_id,))

    quests = all_("""
      SELECT q.id quest_id, q.name_es, q.name_en, q.category, q.rank, q.stars, q.pc_available,
             qr."group", qr.stack, qr.percentage
      FROM quest_rewards qr JOIN quests q ON q.id = qr.quest_id
      WHERE qr.item_id = ? ORDER BY qr.percentage DESC NULLS FIRST, q.stars DESC NULLS FIRST LIMIT 60""", (item_id,))

    combos_make = all_("""
      SELECT ic.quantity, a.id a_id, a.name_es a_es, a.name_en a_en, b.id b_id, b.name_es b_es, b.name_en b_en
      FROM item_combinations ic LEFT JOIN items a ON a.id = ic.first_item_id LEFT JOIN items b ON b.id = ic.second_item_id
      WHERE ic.result_item_id = ?""", (item_id,))
    combos_use = all_("""
      SELECT ic.quantity, r.id result_id, r.name_es result_es, r.name_en result_en
      FROM item_combinations ic JOIN items r ON r.id = ic.result_item_id
      WHERE ic.first_item_id = ? OR ic.second_item_id = ?""", (item_id, item_id))

    armor_use = all_("""
      SELECT a.id, a.name_es, a.name_en, a.rank, a.type, a.rarity, ar.quantity, s.id set_id
      FROM armor_recipes ar JOIN armor a ON a.id = ar.armor_id LEFT JOIN armor_sets s ON s.id = a.armor_set_id
      WHERE ar.item_id = ? ORDER BY a.rarity NULLS LAST, a.id""", (item_id,))
    weapon_use = all_("""
      SELECT w.id, w.name_es, w.name_en, w.weapon_type, w.rarity, wr.type recipe_type, wr.quantity
      FROM weapon_recipes wr JOIN weapons w ON w.id = wr.weapon_id
      WHERE wr.item_id = ? ORDER BY w.rarity NULLS LAST, w.weapon_type NULLS LAST, w.id LIMIT 400""", (item_id,))
    charm_use = all_("""
      SELECT ch.id, ch.name_es, ch.name_en, ch.rarity, cr.type recipe_type, cr.quantity
      FROM charm_recipes cr JOIN charms ch ON ch.id = cr.charm_id WHERE cr.item_id = ? ORDER BY ch.rarity NULLS LAST""",
                     (item_id,))
    layered_use = all_("""
      SELECT slug, name_es, name_en, category, CAST(m.value->>'$.qty' AS TEXT) qty
      FROM layered_armor, json_each(materials) m
      WHERE CAST(m.value->>'$.item_id' AS INTEGER) = ?""", (item_id,))

    return {**it,
            "sources": {"monsters": by_monster, "gathering": gathering, "quests": quests, "combinations": combos_make},
            "used_in": {"armor": armor_use, "weapons": weapon_use, "charms": charm_use, "combinations": combos_use,
                        "layered": layered_use},
            "guides": _guides_for("item", it["name_en"])}


# ---------------------------------------------------------------- monsters

@app.get("/api/monsters")
def monsters(size: str | None = filter_q()):
    rows = all_("""
      SELECT m.id, m.name_es, m.name_en, m.size, m.ecology_en,
             (SELECT NULLIF(json_group_array(rk), '[]') FROM
               (SELECT DISTINCT r.rank AS rk FROM monster_rewards r WHERE r.monster_id = m.id
                ORDER BY r.rank NULLS LAST)) AS "ranks [JSON]"
      FROM monsters m WHERE (:s IS NULL OR m.size = :s) ORDER BY m.size NULLS LAST, m.id""", {"s": size})
    prog_h = _progress("monster_hunted", [r["id"] for r in rows])
    prog_c = _progress("monster_captured", [r["id"] for r in rows])
    for r in rows:
        r["hunted"] = bool(prog_h.get(str(r["id"]), {}).get("done"))
        r["captured"] = bool(prog_c.get(str(r["id"]), {}).get("done"))
    return rows


@app.get("/api/monsters/{monster_id}")
def monster(monster_id: int):
    m = one_or_404("SELECT * FROM monsters WHERE id = ?", (monster_id,), "monstruo")
    habitats = all_("""
      SELECT h.*, l.name_es location_es, l.name_en location_en, l.zone_count FROM monster_habitats h
      JOIN locations l ON l.id = h.location_id WHERE h.monster_id = ? ORDER BY l.id""", (monster_id,))
    for h in habitats:
        h["areas"] = parse_areas(h["move_area"], h["zone_count"])
    rewards = all_("""
      SELECT r.rank, c.name_es condition_es, c.name_en condition_en, c.kind, i.id item_id, i.name_es item_es,
             i.name_en item_en, i.rarity, r.stack, r.percentage
      FROM monster_rewards r JOIN reward_conditions c ON c.id = r.condition_id JOIN items i ON i.id = r.item_id
      WHERE r.monster_id = ? ORDER BY r.rank NULLS LAST, c.id, r.percentage DESC NULLS FIRST""", (monster_id,))
    by_rank = {}
    for rank, rows in sorted(_by(rewards, "rank").items(), key=lambda kv: RANK_ORDER.get(kv[0], 3)):
        by_rank[rank] = [{"condition_es": cs[0]["condition_es"], "condition_en": cs[0]["condition_en"],
                          "kind": cs[0]["kind"], "items": cs} for _, cs in _by(rows, "condition_en").items()]
    return {
        **m,
        "weaknesses": all_("SELECT * FROM monster_weaknesses WHERE monster_id = ? ORDER BY id", (monster_id,)),
        "hitzones": all_("SELECT * FROM monster_hitzones WHERE monster_id = ? ORDER BY id", (monster_id,)),
        "breaks": all_("SELECT * FROM monster_breaks WHERE monster_id = ? ORDER BY id", (monster_id,)),
        "ailments": (one("SELECT data FROM monster_ailments WHERE monster_id = ?", (monster_id,)) or {}).get("data"),
        "habitats": habitats,
        "rewards": by_rank,
        "armor_sets": all_("SELECT id, name_es, name_en, rank FROM armor_sets WHERE monster_id = ? ORDER BY id",
                           (monster_id,)),
        "quests": all_("""
          SELECT q.id, q.name_es, q.name_en, q.category, q.rank, q.stars, qm.quantity, qm.is_objective, q.pc_available
          FROM quest_monsters qm JOIN quests q ON q.id = qm.quest_id WHERE qm.monster_id = ?
          ORDER BY CASE q.rank WHEN 'LR' THEN 0 WHEN 'HR' THEN 1 ELSE 2 END, q.stars NULLS LAST, q.id""", (monster_id,)),
        "guides": _guides_for("monster", m["name_en"]),
        "progress": {"hunted": bool(_progress("monster_hunted", [monster_id]).get(str(monster_id), {}).get("done")),
                     "captured": bool(_progress("monster_captured", [monster_id]).get(str(monster_id), {}).get("done"))},
    }


# ------------------------------------------------------------------- armor

@app.get("/api/armor-sets")
def armor_sets(rank: str | None = filter_q()):
    rows = all_("""
      SELECT s.id, s.name_es, s.name_en, s.rank, s.monster_id, m.name_es monster_es, m.name_en monster_en,
             (SELECT max(a.rarity) FROM armor a WHERE a.armor_set_id = s.id) rarity
      FROM armor_sets s LEFT JOIN monsters m ON m.id = s.monster_id
      WHERE (:r IS NULL OR s.rank = :r)
      ORDER BY CASE s.rank WHEN 'LR' THEN 0 WHEN 'HR' THEN 1 ELSE 2 END, rarity NULLS LAST, s.id""", {"r": rank})
    prog = _progress("armor_set", [r["id"] for r in rows])
    for r in rows:
        r["done"] = bool(prog.get(str(r["id"]), {}).get("done"))
    return rows


def _armor_pieces(where: str, params) -> list[dict]:
    pieces = all_(f"""
      SELECT a.* FROM armor a WHERE {where}
      ORDER BY CASE a.type WHEN 'head' THEN 1 WHEN 'chest' THEN 2 WHEN 'arms' THEN 3 WHEN 'waist' THEN 4
                         WHEN 'legs' THEN 5 ELSE 99 END, a.id""", params)
    ids = [p["id"] for p in pieces]
    skills = _by(all_("""
      SELECT ak.armor_id, s.id skill_id, s.name_es, s.name_en, ak.level FROM armor_skills ak
      JOIN skills s ON s.id = ak.skill_id WHERE ak.armor_id IN (SELECT value FROM json_each(?)) ORDER BY ak.rowid""", (J(ids),)), "armor_id")
    recipes = _by(all_("""
      SELECT ar.armor_id, i.id item_id, i.name_es, i.name_en, i.rarity, ar.quantity FROM armor_recipes ar
      JOIN items i ON i.id = ar.item_id WHERE ar.armor_id IN (SELECT value FROM json_each(?)) ORDER BY ar.rowid""", (J(ids),)), "armor_id")
    for p in pieces:
        p["skills"] = skills.get(p["id"], [])
        p["recipe"] = recipes.get(p["id"], [])
    return pieces


@app.get("/api/armor-sets/{set_id}")
def armor_set(set_id: int):
    s = one_or_404("""
      SELECT s.*, m.name_es monster_es, m.name_en monster_en, b.name_es bonus_es, b.name_en bonus_en
      FROM armor_sets s LEFT JOIN monsters m ON m.id = s.monster_id LEFT JOIN armor_set_bonuses b ON b.id = s.bonus_id
      WHERE s.id = ?""", (set_id,), "set de armadura")
    pieces = _armor_pieces("a.armor_set_id = ?", (set_id,))
    totals = defaultdict(lambda: {"quantity": 0})
    for p in pieces:
        for r in p["recipe"]:
            t = totals[r["item_id"]]
            t.update({k: r[k] for k in ("item_id", "name_es", "name_en", "rarity")})
            t["quantity"] += r["quantity"]
    bonus = all_("""
      SELECT sk.id skill_id, sk.name_es, sk.name_en, br.required FROM armor_set_bonus_ranks br
      JOIN skills sk ON sk.id = br.skill_id WHERE br.bonus_id = ? ORDER BY br.required NULLS LAST""", (s["bonus_id"],)) \
        if s["bonus_id"] else []
    return {**s, "pieces": pieces, "total_materials": sorted(totals.values(), key=lambda t: -t["quantity"]),
            "bonus_ranks": bonus, "guides": _guides_for("armor_set", s["name_en"]),
            "done": bool(_progress("armor_set", [set_id]).get(str(set_id), {}).get("done"))}


@app.get("/api/armor/{armor_id}")
def armor(armor_id: int):
    pieces = _armor_pieces("a.id = ?", (armor_id,))
    if not pieces:
        raise HTTPException(404, "No se encontró la pieza de armadura")
    p = pieces[0]
    p["set"] = one("SELECT id, name_es, name_en, rank FROM armor_sets WHERE id = ?", (p["armor_set_id"],)) \
        if p["armor_set_id"] else None
    return p


# ----------------------------------------------------------------- weapons

@app.get("/api/weapons")
def weapons(weapon_type: str | None = filter_q(), q: str | None = text_q(), limit: int = limit_q(500)):
    return all_("""
      SELECT id, name_es, name_en, weapon_type, previous_id, category, rarity, attack, element1, element1_attack,
             slot_1, slot_2, slot_3
      FROM weapons WHERE (:t IS NULL OR weapon_type = :t)
        AND (:q IS NULL OR f_norm(coalesce(name_es,'') || ' ' || name_en) LIKE '%' || f_norm(:q) || '%')
      ORDER BY weapon_type NULLS LAST, rarity NULLS LAST, id LIMIT :l""", {"t": weapon_type, "q": q, "l": limit})


@app.get("/api/weapons/{weapon_id}")
def weapon(weapon_id: int):
    w = one_or_404("SELECT * FROM weapons WHERE id = ?", (weapon_id,), "arma")
    chain = all_("""
      WITH RECURSIVE up AS (
        SELECT id, name_es, name_en, previous_id, rarity, 0 depth FROM weapons WHERE id = ?
        UNION ALL SELECT w.id, w.name_es, w.name_en, w.previous_id, w.rarity, up.depth + 1
        FROM weapons w JOIN up ON w.id = up.previous_id)
      SELECT * FROM up ORDER BY depth DESC""", (weapon_id,))
    return {**w,
            "recipe": all_("""
              SELECT wr.type, i.id item_id, i.name_es, i.name_en, i.rarity, wr.quantity FROM weapon_recipes wr
              JOIN items i ON i.id = wr.item_id WHERE wr.weapon_id = ?""", (weapon_id,)),
            "tree": chain,
            "upgrades": all_("SELECT id, name_es, name_en, rarity FROM weapons WHERE previous_id = ?", (weapon_id,))}


# --------------------------------------------------- skills, decos, charms

@app.get("/api/skills/{skill_id}")
def skill(skill_id: int):
    s = one_or_404("SELECT * FROM skills WHERE id = ?", (skill_id,), "habilidad")
    return {**s,
            "levels": all_("SELECT * FROM skill_levels WHERE skill_id = ? ORDER BY level NULLS LAST", (skill_id,)),
            "decorations": all_("""
              SELECT d.id, d.name_es, d.name_en, d.slot, d.rarity, ds.level FROM decoration_skills ds
              JOIN decorations d ON d.id = ds.decoration_id WHERE ds.skill_id = ? ORDER BY d.slot NULLS LAST, d.rarity NULLS LAST""",
                                (skill_id,)),
            "charms": all_("""
              SELECT c.id, c.name_es, c.name_en, c.rarity, cs.level FROM charm_skills cs JOIN charms c ON c.id = cs.charm_id
              WHERE cs.skill_id = ? ORDER BY cs.level NULLS LAST""", (skill_id,)),
            "armor": all_("""
              SELECT a.id, a.name_es, a.name_en, a.rank, a.type, a.rarity, ak.level FROM armor_skills ak
              JOIN armor a ON a.id = ak.armor_id WHERE ak.skill_id = ? ORDER BY a.rarity DESC NULLS FIRST, ak.level DESC NULLS FIRST, ak.rowid LIMIT 120""",
                         (skill_id,)),
            "set_bonuses": all_("""
              SELECT b.id, b.name_es, b.name_en, br.required FROM armor_set_bonus_ranks br
              JOIN armor_set_bonuses b ON b.id = br.bonus_id WHERE br.skill_id = ? ORDER BY br.rowid""", (skill_id,))}


@app.get("/api/decorations/{deco_id}")
def decoration(deco_id: int):
    d = one_or_404("SELECT * FROM decorations WHERE id = ?", (deco_id,), "adorno")
    return {**d,
            "skills": all_("""SELECT s.id skill_id, s.name_es, s.name_en, ds.level FROM decoration_skills ds
                             JOIN skills s ON s.id = ds.skill_id WHERE ds.decoration_id = ?""", (deco_id,)),
            "droprates": all_("SELECT feystone, percentage FROM decoration_droprates WHERE rarity = ? ORDER BY percentage DESC NULLS FIRST",
                              (d["rarity"],))}


@app.get("/api/charms/{charm_id}")
def charm(charm_id: int):
    ch = one_or_404("SELECT * FROM charms WHERE id = ?", (charm_id,), "amuleto")
    return {**ch,
            "skills": all_("""SELECT s.id skill_id, s.name_es, s.name_en, cs.level FROM charm_skills cs
                             JOIN skills s ON s.id = cs.skill_id WHERE cs.charm_id = ?""", (charm_id,)),
            "recipe": all_("""SELECT cr.type, i.id item_id, i.name_es, i.name_en, i.rarity, cr.quantity
                             FROM charm_recipes cr JOIN items i ON i.id = cr.item_id WHERE cr.charm_id = ?""", (charm_id,)),
            "previous": one("SELECT id, name_es, name_en FROM charms WHERE id = ?", (ch["previous_id"],))
            if ch["previous_id"] else None}


# ------------------------------------------------------- quests and events

@app.get("/api/quests")
def quests(category: str | None = filter_q(), rank: str | None = filter_q()):
    return all_("""
      SELECT q.id, q.name_es, q.name_en, q.category, q.rank, q.stars, q.quest_type, q.pc_available,
             l.name_es location_es, l.name_en location_en
      FROM quests q LEFT JOIN locations l ON l.id = q.location_id
      WHERE (:c IS NULL OR q.category = :c) AND (:r IS NULL OR q.rank = :r)
      ORDER BY CASE q.rank WHEN 'LR' THEN 0 WHEN 'HR' THEN 1 ELSE 2 END, q.stars NULLS LAST, q.id""", {"c": category, "r": rank})


@app.get("/api/quests/{quest_id}")
def quest(quest_id: int):
    q = one_or_404("""SELECT q.*, l.name_es location_es, l.name_en location_en FROM quests q
                      LEFT JOIN locations l ON l.id = q.location_id WHERE q.id = ?""", (quest_id,), "misión")
    return {**q,
            "monsters": all_("""SELECT m.id, m.name_es, m.name_en, qm.quantity, qm.is_objective FROM quest_monsters qm
                               JOIN monsters m ON m.id = qm.monster_id WHERE qm.quest_id = ?""", (quest_id,)),
            "rewards": all_("""SELECT qr."group", i.id item_id, i.name_es, i.name_en, i.rarity, qr.stack, qr.percentage
                              FROM quest_rewards qr JOIN items i ON i.id = qr.item_id WHERE qr.quest_id = ?
                              ORDER BY qr."group" NULLS LAST, qr.percentage DESC NULLS FIRST""", (quest_id,)),
            "events": all_("SELECT * FROM events WHERE quest_id = ? ORDER BY platform NULLS LAST, start_at NULLS LAST", (quest_id,)),
            "layered": all_("SELECT slug, name_es, name_en, category FROM layered_armor WHERE EXISTS "
                            "(SELECT 1 FROM json_each(quests) j WHERE j.value->>'$.name_en' = ?)",
                            (q["name_en"],)),
            "guides": _guides_for("quest", q["name_en"])}


@app.get("/api/events")
def events(platform: str = filter_q("pc")):
    return all_("""
      SELECT id, external_id, platform, type, name_en, name_es, expansion, quest_rank, master_rank, requirements,
             success_conditions, description_en, location_id, quest_id, start_at, end_at, source,
             location_es, location_en, quest_es, pc_available
      FROM (
        SELECT e.*, l.name_es location_es, l.name_en location_en, q.name_es quest_es, q.pc_available,
               row_number() OVER (PARTITION BY e.name_en ORDER BY e.start_at DESC NULLS FIRST, e.id) AS rn
        FROM events e LEFT JOIN locations l ON l.id = e.location_id LEFT JOIN quests q ON q.id = e.quest_id
        WHERE e.platform = ?)
      WHERE rn = 1 ORDER BY name_en NULLS LAST""", (platform,))


# --------------------------------------------------------------- locations

@app.get("/api/locations")
def locations():
    return all_("""
      SELECT l.*, (SELECT count(*) FROM location_camps c WHERE c.location_id = l.id) camps,
             (SELECT count(DISTINCT item_id) FROM location_items li WHERE li.location_id = l.id) gather_items,
             (SELECT count(DISTINCT monster_id) FROM monster_habitats h WHERE h.location_id = l.id) monsters
      FROM locations l ORDER BY l.id""")


@app.get("/api/locations/{location_id}")
def location(location_id: int):
    loc = one_or_404("SELECT * FROM locations WHERE id = ?", (location_id,), "mapa")
    camps = all_("SELECT * FROM location_camps WHERE location_id = ? ORDER BY area NULLS LAST", (location_id,))
    gather = all_("""
      SELECT li.area, li.rank, li.stack, li.percentage, li.nodes, li.notes_es, li.source, i.id item_id, i.name_es,
             i.name_en, i.rarity
      FROM location_items li JOIN items i ON i.id = li.item_id WHERE li.location_id = ?
      ORDER BY li.area NULLS LAST, li.rank NULLS FIRST, li.percentage DESC NULLS FIRST""", (location_id,))
    habitats = all_("""
      SELECT h.*, m.name_es, m.name_en, m.size FROM monster_habitats h JOIN monsters m ON m.id = h.monster_id
      WHERE h.location_id = ? ORDER BY m.id""", (location_id,))
    zone_count = loc["zone_count"] or max([g["area"] or 0 for g in gather] + [c["area"] or 0 for c in camps] + [0])
    areas = {n: {"area": n, "camps": [], "items": [], "monsters": []} for n in range(1, (zone_count or 0) + 1)}
    unplaced = []
    for c in camps:
        areas.setdefault(c["area"], {"area": c["area"], "camps": [], "items": [], "monsters": []})["camps"].append(c)
    for g in gather:
        if g["area"] is None:
            unplaced.append(g)
        else:
            areas.setdefault(g["area"], {"area": g["area"], "camps": [], "items": [], "monsters": []})["items"].append(g)
    for h in habitats:
        h["areas"] = parse_areas(h["move_area"], zone_count)
        for a in h["areas"]:
            if a in areas:
                areas[a]["monsters"].append({"id": h["monster_id"], "name_es": h["name_es"], "name_en": h["name_en"],
                                             "rest": str(a) in (h["rest_area"] or "").split(",")})
    return {**loc, "camps": camps, "areas": [areas[k] for k in sorted(areas)], "unplaced_items": unplaced,
            "monsters": habitats,
            "quests": all_("""SELECT id, name_es, name_en, category, rank, stars FROM quests WHERE location_id = ?
                             ORDER BY CASE rank WHEN 'LR' THEN 0 WHEN 'HR' THEN 1 ELSE 2 END, stars NULLS LAST LIMIT 200""",
                           (location_id,)),
            "guides": _guides_for("location", loc["name_en"])}


# ----------------------------------------------------- research entities

@app.get("/api/layered")
def layered(category: str | None = filter_q(), owner: str | None = filter_q()):
    rows = all_("""
      SELECT slug, name_es, name_en, category, owner, pc_available, needs_review, json_array_length(pieces) pieces
      FROM layered_armor WHERE (:c IS NULL OR category = :c) AND (:o IS NULL OR owner = :o)
      ORDER BY category NULLS LAST, coalesce(name_es, name_en)""", {"c": category, "o": owner})
    prog = _progress("layered", [r["slug"] for r in rows])
    for r in rows:
        r["done"] = bool(prog.get(r["slug"], {}).get("done"))
    return rows


@app.get("/api/layered/{slug}")
def layered_one(slug: str = Path(pattern=ID_PATTERN)):
    row = one_or_404("SELECT * FROM layered_armor WHERE slug = ?", (slug,), "armadura superpuesta")
    row["done"] = bool(_progress("layered", [slug]).get(slug, {}).get("done"))
    return row


@app.get("/api/achievements")
def achievements():
    rows = all_("""SELECT slug, name_es, name_en, description_es, description_en, category, hidden, needs_review, sort_order
                   FROM achievements ORDER BY sort_order NULLS LAST, slug""")
    prog = _progress("achievement", [r["slug"] for r in rows])
    for r in rows:
        r["done"] = bool(prog.get(r["slug"], {}).get("done"))
    return rows


@app.get("/api/achievements/{slug}")
def achievement(slug: str = Path(pattern=ID_PATTERN)):
    row = one_or_404("SELECT * FROM achievements WHERE slug = ?", (slug,), "logro")
    row["done"] = bool(_progress("achievement", [slug]).get(slug, {}).get("done"))
    return row


@app.get("/api/guides")
def guides(kind: str | None = filter_q()):
    return all_("""SELECT slug, kind, title_es, title_en, summary_es, needs_review, json_array_length(videos) AS video_count FROM guides
                   WHERE (:k IS NULL OR kind = :k) ORDER BY kind NULLS LAST, title_es NULLS LAST""", {"k": kind})


@app.get("/api/guides/{slug}")
def guide(slug: str = Path(pattern=ID_PATTERN)):
    return one_or_404("SELECT * FROM guides WHERE slug = ?", (slug,), "guía")


# ---------------------------------------------------------------- progress

class ProgressIn(BaseModel):
    done: bool = True
    notes: Note | None = None


@app.put("/api/progress/{entity_type}/{entity_id}")
def set_progress(entity_type: str = Path(max_length=40), entity_id: str = Path(pattern=ID_PATTERN),
                 body: ProgressIn = ...):
    if entity_type not in PROGRESS_TYPES:
        raise HTTPException(400, f"Tipo no válido. Usa uno de: {sorted(PROGRESS_TYPES)}")
    execute("""
      INSERT INTO progress (entity_type, entity_id, done, notes, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET done = excluded.done, notes = excluded.notes,
                                                         updated_at = excluded.updated_at""",
            (entity_type, entity_id, body.done, body.notes, db.now()))
    return {"entity_type": entity_type, "entity_id": entity_id, **body.model_dump()}


@app.get("/api/progress")
def list_progress(entity_type: str | None = filter_q()):
    return all_("""SELECT * FROM progress WHERE (:t IS NULL OR entity_type = :t) AND done
                   ORDER BY updated_at DESC NULLS FIRST""", {"t": entity_type})


@app.get("/api/progress/summary")
def progress_summary():
    totals = one("""
      SELECT (SELECT count(*) FROM achievements) achievement, (SELECT count(*) FROM layered_armor) layered,
             (SELECT count(*) FROM armor_sets) armor_set,
             (SELECT count(*) FROM monsters WHERE size = 'large') monster_hunted,
             (SELECT count(*) FROM monsters WHERE size = 'large') monster_captured,
             (SELECT count(*) FROM canteen_ingredients) ingredient""")
    done = {r["entity_type"]: r["n"] for r in all_(
        "SELECT entity_type, count(*) n FROM progress WHERE done GROUP BY entity_type")}
    return {k: {"done": done.get(k, 0), "total": v} for k, v in totals.items()}


# Must stay LAST so the /api routes above win over the SPA fallback (no-op unless MHW_WEB_DIST is set).
mount_web(app)
