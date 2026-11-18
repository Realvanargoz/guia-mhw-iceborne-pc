"""Hunter profile read from the player's own save file (SOLO LECTURA sobre la partida).

Safety rules (see the plan, "Garantias de seguridad"):
* /mhw/save and /mhw/stats are bind-mounted ``:ro``. This module only ever opens files under them with 'rb'.
* The save is copied to a temp file inside /data/saves and only the copy is parsed (by ``mhw-savereader``).
* Exactly ONE binary copy is kept: /data/saves/SAVEDATA1000.copy. It is replaced (os.replace) only after the
  new copy parsed correctly; on failure the temp is deleted and the previous copy is kept.
* Nothing runs automatically: the only triggers are POST /sync and POST /upload. No watchers, no tasks.
* History keeps only the parsed JSON (profile_snapshots), never the binary.
"""
from __future__ import annotations

import glob
import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from datetime import date, datetime, timezone

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from pydantic import BaseModel, Field

from . import savepaths, settings, steamstats
from .safepath import ensure_writable
from . import db
from .db import all_, one, pool

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/profile")

SAVE_DIR = settings.SAVE_MOUNT
STATS_DIR = settings.STATS_MOUNT
STORE_DIR = settings.SAVE_STORE
SAVE_NAME = "SAVEDATA1000"
STORED_COPY = os.path.join(STORE_DIR, SAVE_NAME + ".copy")
READER = settings.SAVEREADER_BIN
MAX_UPLOAD = 16 * 1024 * 1024
HARD_UPLOAD_LIMIT = 32 * 1024 * 1024  # absolute cap enforced in-app while reading the upload
READER_TIMEOUT = 60
RETRIES = 3
RETRY_DELAY = 2.0
CHUNK = 1024 * 1024

# Names that differ between the save reader's table and mhw.monsters.name_en (lower-case keys).
MONSTER_ALIAS = {
    "xeno'jiiva": "xeno'jiiva",
    "tobi kadachi": "tobi-kadachi",
    "kulu ya ku": "kulu-ya-ku",
    "tzitzi ya ku": "tzitzi-ya-ku",
    "safi'jiiva": "safi'jiiva",
    "gold rathian": "gold rathian",
    "pink rathian": "pink rathian",
}

_lock = threading.Lock()


def ensure_tables() -> None:
    """No-op: userdb.migrate() creates profile_snapshots / progress (kept so main.py's import keeps working)."""


# ------------------------------------------------------------------ helpers

def _norm(name: str) -> str:
    n = (name or "").strip().lower().replace("’", "'")
    return MONSTER_ALIAS.get(n, n)


def _short(sha: str | None) -> str | None:
    return sha[:12] if sha else None


def _snap_meta(r: dict | None) -> dict | None:
    if not r:
        return None
    return {"id": r["id"], "taken_at": r["taken_at"].isoformat(), "source": r["source"], "slot": r["slot"],
            "sha256_short": _short(r["sha256"])}


_SNAP_COLS = {"id, taken_at, source, slot, sha256", "id, taken_at, source, slot, sha256, data", "data",
              "id, taken_at, source, slot, sha256, "
              "coalesce(json_type(data, '$.slots[0].quests') IS NOT NULL, 0) AS has_equipment"}   # closed allowlist


def _last_snapshot(cols: str = "id, taken_at, source, slot, sha256") -> dict | None:
    if cols not in _SNAP_COLS:
        raise ValueError("columnas no permitidas")
    return one(f"SELECT {cols} FROM profile_snapshots ORDER BY id DESC LIMIT 1")


def _iso_mtime(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _resolve_save() -> dict:
    return savepaths.resolve(SAVE_DIR)


def _save_path() -> str:
    return _resolve_save()["path"]


def _stats_files() -> tuple[str | None, str | None]:
    found = sorted(glob.glob(os.path.join(STATS_DIR, "UserGameStats_*_582010.bin")))
    schema = os.path.join(STATS_DIR, "UserGameStatsSchema_582010.bin")
    if found:
        return found[0], (schema if os.path.isfile(schema) else None)
    return savepaths.find_stats(_resolve_save()["account_id"])  # native Windows: Steam's appcache\stats


def _copy_to_temp(src_fileobj, *, limit: int | None = None) -> tuple[str, str, int]:
    """Stream an already-open (read-only / upload) file into a temp file in STORE_DIR. Returns (path, sha, size)."""
    ensure_writable(STORE_DIR)
    os.makedirs(STORE_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".part", dir=STORE_DIR)
    h = hashlib.sha256()
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = src_fileobj.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > HARD_UPLOAD_LIMIT:
                    raise HTTPException(413, "El archivo supera el límite de 32 MB")
                if limit is not None and size > limit:
                    raise HTTPException(413, "El archivo supera el límite de 16 MB")
                h.update(chunk)
                out.write(chunk)
        return tmp, h.hexdigest(), size
    except BaseException:
        _rm(tmp)
        raise


def _rm(path: str | None) -> None:
    if path:
        try:
            os.remove(ensure_writable(path))
        except FileNotFoundError:
            pass
        except OSError:
            log.warning("profile: could not delete temp file")


try:  # lector en proceso (Python puro + pycryptodome); sin .NET ni subprocess
    from .savereader import SaveReadError, read_save as _py_read_save
    _PY_READER = True
except ImportError:  # imagen Docker antigua sin pycryptodome: se usa el binario .NET (se retira con Docker)
    _PY_READER = False


def _reader_available() -> bool:
    return _PY_READER or shutil.which(READER) is not None


def _run_reader(path: str) -> tuple[dict | None, str | None]:
    """Run the reader on a copy. Returns (data, error_code)."""
    if _PY_READER:
        try:
            data = _py_read_save(path)
        except SaveReadError as e:
            return None, getattr(e, "kind", None) or "io_error"
        except (MemoryError, RecursionError):
            return None, "bad_format"
        except Exception:  # un archivo corrupto nunca debe tumbar la API
            log.exception("profile: save reader failed")
            return None, "bad_format"
        if not data.get("signature_ok", True) or not data.get("slots"):
            return None, "bad_format"
        return data, None
    try:
        p = subprocess.run([READER, path, "--json"], capture_output=True, timeout=READER_TIMEOUT, text=True,
                           encoding="utf-8")
    except FileNotFoundError:
        return None, "reader_missing"
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if p.returncode != 0:
        try:
            return None, json.loads(p.stderr).get("error", "io_error")
        except Exception:
            return None, "io_error"
    try:
        data = json.loads(p.stdout)
    except Exception:
        return None, "bad_format"
    if not data.get("signature_ok", True) or not data.get("slots"):
        return None, "bad_format"
    return data, None


ERR_ES = {
    "truncated": "El archivo está incompleto (¿el juego estaba guardando?). Inténtalo de nuevo en unos segundos.",
    "bad_format": "El archivo no es una partida válida de Monster Hunter: World.",
    "not_found": "No se encontró el archivo de la partida.",
    "io_error": "No se pudo leer el archivo de la partida.",
    "timeout": "El lector tardó demasiado en procesar la partida.",
    "reader_missing": "El lector de partidas no está instalado en la API.",
}


def _first_slot(data: dict, slot: int | None = None) -> dict | None:
    for s in data.get("slots", []):
        if slot is None or s.get("slot") == slot:
            return s
    return None


def _monster_ids() -> dict[str, tuple[int, str]]:
    return {_norm(r["name_en"]): (r["id"], r["name_en"]) for r in all_("SELECT id, name_en FROM monsters")}


PROGRESS_NOTE_PREFIX = "desde la partida"

# Overwrites only rows that are not done AND have no manual note (same rule as before this change).
_MARK_SQL = """
  INSERT INTO progress (entity_type, entity_id, done, notes, updated_at) VALUES (?, ?, 1, ?, ?)
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET done = 1, notes = excluded.notes,
                                                     updated_at = excluded.updated_at
  WHERE progress.done = 0
    AND (progress.notes IS NULL OR substr(progress.notes, 1, 16) = 'desde la partida')
  RETURNING 1"""


def _armor_catalog() -> list[dict]:
    return all_("""SELECT a.id, a.name_en, a.name_es, a.type, a.rank, a.rarity, a.armor_set_id,
                          s.name_en AS set_name_en, s.name_es AS set_name_es
                   FROM armor a LEFT JOIN armor_sets s ON s.id = a.armor_set_id ORDER BY a.id""")


def _owned_armor(slot: dict, catalog: list[dict]) -> tuple[set[int], list[dict]]:
    """Map the reader's equipment box (names from the game master data) onto mhw.armor ids by English name."""
    by_name = {(r["name_en"] or "").strip().lower(): r["id"] for r in catalog}
    owned: set[int] = set()
    not_in_guide: list[dict] = []
    for a in ((slot.get("equipment") or {}).get("armor") or []):
        aid = by_name.get((a.get("name_en") or "").strip().lower())
        if aid is None:
            not_in_guide.append({k: a.get(k) for k in ("type", "id", "name_en", "name_es", "rarity", "count")})
        else:
            owned.add(aid)
    return owned, not_in_guide


def _empty_rank() -> dict:
    return {"pieces_owned": 0, "pieces_total": 0, "sets_complete": 0, "sets_total": 0}


def armor_summary(slot: dict, catalog: list[dict] | None = None) -> dict:
    catalog = catalog if catalog is not None else _armor_catalog()
    owned, not_in_guide = _owned_armor(slot, catalog)
    sets: dict[int, dict] = {}
    by_rank: dict[str, dict] = {}
    for r in catalog:
        rk = by_rank.setdefault(r["rank"] or "?", _empty_rank())
        rk["pieces_total"] += 1
        has = r["id"] in owned
        rk["pieces_owned"] += int(has)
        if r["armor_set_id"] is not None:
            st = sets.setdefault(r["armor_set_id"], {"id": r["armor_set_id"], "name_en": r["set_name_en"],
                                                     "name_es": r["set_name_es"], "rank": r["rank"],
                                                     "pieces_total": 0, "owned_piece_ids": []})
            st["pieces_total"] += 1
            if has:
                st["owned_piece_ids"].append(r["id"])
    complete: list[int] = []
    started: list[dict] = []
    for st in sets.values():
        n = len(st["owned_piece_ids"])
        st["pieces_owned"] = n
        st["complete"] = n == st["pieces_total"]
        rk = by_rank.setdefault(st["rank"] or "?", _empty_rank())
        rk["sets_total"] += 1
        if st["complete"]:
            rk["sets_complete"] += 1
            complete.append(st["id"])
        if n:
            started.append(st)
    for rk in by_rank.values():
        rk["percent"] = round(100.0 * rk["pieces_owned"] / rk["pieces_total"], 1) if rk["pieces_total"] else 0.0
    total = len(catalog)
    return {
        "semantics": "piezas que hay ahora en el cofre de equipo (las vendidas o fundidas no cuentan)",
        "pieces_owned": len(owned), "pieces_total": total,
        "percent": round(100.0 * len(owned) / total, 1) if total else 0.0,
        "sets_complete": len(complete), "sets_total": len(sets),
        "sets_percent": round(100.0 * len(complete) / len(sets), 1) if sets else 0.0,
        "by_rank": {k: by_rank[k] for k in ("LR", "HR", "MR") if k in by_rank},
        "owned_piece_ids": sorted(owned),
        "complete_set_ids": sorted(complete),
        "sets": sorted(started, key=lambda x: x["id"]),
        "not_in_guide": not_in_guide,
    }


def plan_progress(data: dict) -> tuple[list[tuple[str, str]], list[str]]:
    """Pure planning step: which (entity_type, entity_id) rows the save says are done. Reads only catalog tables."""
    unmatched: list[str] = []
    todo: list[tuple[str, str]] = []
    slot = _first_slot(data)
    if slot:
        ids = _monster_ids()
        for m in slot.get("monsters", []):
            hit = ids.get(_norm(m.get("name_en", "")))
            if not hit:
                if (m.get("hunted") or m.get("captured")) and m.get("name_en") not in unmatched:
                    unmatched.append(m.get("name_en"))
                continue
            if m.get("hunted", 0) > 0:
                todo.append(("monster_hunted", str(hit[0])))
            if m.get("captured", 0) > 0:
                todo.append(("monster_captured", str(hit[0])))
        if slot.get("equipment"):
            for set_id in armor_summary(slot)["complete_set_ids"]:
                todo.append(("armor_set", str(set_id)))
        # Quests: cleared bitfield mapped through the game's questNoList (verified, see research/save_format).
        cleared = ((slot.get("quests") or {}).get("cleared")) or []
        if cleared:
            known = {r["id"] for r in all_("SELECT id FROM quests")}
            for qid in cleared:
                if qid in known:
                    todo.append(("quest", str(qid)))
        todo.extend(_derived_ingredients(cleared))
    ach = (data.get("steam_achievements") or {}).get("achievements") or {}
    if ach:
        by_order = {r["sort_order"]: r["slug"] for r in all_("SELECT slug, sort_order FROM achievements")}
        for key, a in ach.items():
            if a.get("unlocked") and key.startswith("Achievement") and key[11:].isdigit():
                s = by_order.get(int(key[11:]) + 1)
                if s:
                    todo.append(("achievement", s))
    return todo, unmatched


def _qkey(name: str | None) -> str:
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


def _derived_ingredients(cleared_ids: list) -> list[tuple[str, str]]:
    """Canteen ingredients the save does NOT store (field not located yet) but that follow from cleared quests.

    base -> available from the start; quest / delivery / bounty -> unlocked once the quest named in the seed is
    cleared. Gathering-unlocked ones (Flourish events, nodes) cannot be inferred and stay manual.
    """
    cleared = {int(c) for c in cleared_ids}
    by_name: dict[str, list[int]] = {}
    for r in all_("SELECT id, name_en FROM quests"):
        by_name.setdefault(_qkey(r["name_en"]), []).append(r["id"])
    out = []
    for r in all_("SELECT id, unlock_type, json_extract(unlock, '$.quest_en') AS quest_en FROM canteen_ingredients"):
        if r["unlock_type"] == "base":
            out.append(("ingredient", r["id"]))
        elif r["unlock_type"] in ("quest", "delivery", "bounty") and r["quest_en"]:
            if any(q in cleared for q in by_name.get(_qkey(r["quest_en"]), [])):
                out.append(("ingredient", r["id"]))
    return out


def dry_run_progress(data: dict) -> dict:
    """What _update_progress WOULD change, without writing (read-only SELECT on progress). For tests."""
    todo, unmatched = plan_progress(data)
    existing = {(r["entity_type"], r["entity_id"]): r for r in
                all_("SELECT entity_type, entity_id, done, notes FROM progress")}
    would: dict[str, list[str]] = {}
    already: dict[str, int] = {}
    for etype, eid in todo:
        r = existing.get((etype, eid))
        if r is None or (not r["done"] and (r["notes"] is None or r["notes"].startswith(PROGRESS_NOTE_PREFIX))):
            would.setdefault(etype, []).append(eid)
        else:
            already[etype] = already.get(etype, 0) + 1
    return {"would_mark": would, "would_mark_counts": {k: len(v) for k, v in would.items()},
            "already_done_or_manual": already, "unmatched_monsters": unmatched}


def _update_progress(data: dict) -> dict:
    """Mark in progress what the save says. Never un-marks nor overwrites manual entries."""
    note = f"{PROGRESS_NOTE_PREFIX}, {date.today().isoformat()}"
    todo, unmatched = plan_progress(data)
    counts = {"monster_hunted": 0, "monster_captured": 0, "achievement": 0, "armor_set": 0, "quest": 0, "ingredient": 0}
    ts = db.now()
    with db.transaction() as conn:
        for etype, eid in todo:
            n = note + " (ingrediente deducido de misiones)" if etype == "ingredient" else note
            if conn.one(_MARK_SQL, (etype, eid, n, ts)):
                counts[etype] = counts.get(etype, 0) + 1
    return {"marked": counts, "unmatched_monsters": unmatched}


def _store_snapshot(tmp: str, sha: str, source: str, data: dict) -> dict:
    """Atomically promote the temp file to THE stored copy, then insert the parsed snapshot."""
    os.replace(ensure_writable(tmp), ensure_writable(STORED_COPY))
    slot = _first_slot(data)
    row = one("""INSERT INTO profile_snapshots (taken_at, source, sha256, slot, data) VALUES (?, ?, ?, ?, ?)
                 RETURNING id, taken_at, source, slot, sha256""",
              (db.now(), source, sha, slot["slot"] if slot else None, db.J(data)))
    prog = _update_progress(data)
    return {"changed": True, "snapshot": _snap_meta(row), "profile": _summary(data), **prog}


def _summary(data: dict) -> dict | None:
    s = _first_slot(data)
    if not s:
        return None
    return {k: s.get(k) for k in ("slot", "name", "hr", "mr", "zenny", "research_points", "playtime_seconds")}


def _unchanged(sha: str) -> dict | None:
    last = _last_snapshot("id, taken_at, source, slot, sha256, "
                          "coalesce(json_type(data, '$.slots[0].quests') IS NOT NULL, 0) AS has_equipment")
    # Same file, but parsed by an older reader (no per-quest / gear sections): parse it again once.
    if last and last["sha256"] == sha and last["has_equipment"]:
        when = last["taken_at"].date().isoformat()
        return {"changed": False, "message": f"sin cambios desde {when}", "snapshot": _snap_meta(last)}
    return None


# ------------------------------------------------------------------ endpoints

@router.get("/status")
def status():
    res = _resolve_save()
    sp = res["path"]
    mounted = os.path.isfile(sp)
    st = os.stat(sp) if mounted else None
    stats_file, schema = _stats_files()
    stored = os.path.getsize(STORED_COPY) if os.path.isfile(STORED_COPY) else None
    return {"save_mounted": mounted, "save_path": sp, "save_mtime": _iso_mtime(st.st_mtime) if st else None,
            "save_size": st.st_size if st else None, "stats_mounted": bool(stats_file and schema),
            "reader_installed": _reader_available(),
            "last_snapshot": _snap_meta(_last_snapshot()), "stored_copy_bytes": stored,
            "save_source": res["source"] if mounted else None, "candidates": len(res["candidates"])}


@router.get("/save-candidates")
def save_candidates():
    """Saves found under the Steam userdata folder (metadata only; content is never read)."""
    res = _resolve_save()
    return {"selected": res["path"] if res["source"] else None, "source": res["source"],
            "candidates": [{k: c[k] for k in ("account_id", "path", "size", "mtime")} for c in res["candidates"]]}


class SavePathBody(BaseModel):
    path: str | None = Field(None, max_length=savepaths.MAX_PATH_LEN)


@router.put("/save-path")
def set_save_path(body: SavePathBody):
    """Persist (or clear, with null) the manual save path. Validated strictly; the save is never touched."""
    try:
        savepaths.set_override(body.path)
    except savepaths.SavePathError as e:
        raise HTTPException(422, str(e))
    except OSError:
        raise HTTPException(500, "No se pudo guardar la configuración.")
    return status()


@router.post("/sync")
def sync():
    """Copy the save (read-only) -> parse the copy -> store. Only runs when the user presses the button."""
    sp = _save_path()
    if not os.path.isfile(sp):
        raise HTTPException(404, "La partida no está montada. Configura MHW_SAVE_DIR en .env y reinicia la API.")
    if not _reader_available():
        raise HTTPException(503, ERR_ES["reader_missing"])
    if not _lock.acquire(blocking=False):
        raise HTTPException(409, "Ya hay una actualización en curso")
    try:
        err = "io_error"
        for attempt in range(RETRIES):
            if attempt:
                time.sleep(RETRY_DELAY)
            tmp = None
            try:
                with open(sp, "rb") as src:  # read-only open of the original
                    tmp, sha, _ = _copy_to_temp(src)
                same = _unchanged(sha)
                if same:
                    _rm(tmp)
                    return same
                data, err = _run_reader(tmp)
                if data is None:
                    _rm(tmp)
                    if err in ("truncated", "bad_format", "io_error"):
                        continue
                    break
                stats_file, schema = _stats_files()
                data["steam_achievements"] = (steamstats.read_achievements(stats_file, schema)
                                              if stats_file and schema else None)
                return _store_snapshot(tmp, sha, "steam-local", data)
            except OSError:
                _rm(tmp)
                err = "io_error"
            except BaseException:
                _rm(tmp)
                raise
        raise HTTPException(422, ERR_ES.get(err, ERR_ES["io_error"]) + " Se conserva la copia anterior.")
    finally:
        _lock.release()


@router.post("/upload")
def upload(file: UploadFile = File(...)):
    if not _reader_available():
        raise HTTPException(503, ERR_ES["reader_missing"])
    if not _lock.acquire(blocking=False):
        raise HTTPException(409, "Ya hay una actualización en curso")
    tmp = None
    try:
        tmp, sha, _ = _copy_to_temp(file.file, limit=MAX_UPLOAD)
        same = _unchanged(sha)
        if same:
            _rm(tmp)
            return same
        data, err = _run_reader(tmp)
        if data is None:
            _rm(tmp)
            raise HTTPException(422, ERR_ES.get(err, ERR_ES["bad_format"]) + " No se ha guardado nada.")
        stats_file, schema = _stats_files()
        data["steam_achievements"] = (steamstats.read_achievements(stats_file, schema)
                                      if stats_file and schema else None)
        return _store_snapshot(tmp, sha, "upload", data)
    except BaseException:
        _rm(tmp)  # no-op if the temp was already promoted by os.replace
        raise
    finally:
        _lock.release()


@router.get("")
def profile(slot: int | None = Query(None, ge=0, le=99)):
    row = _last_snapshot("id, taken_at, source, slot, sha256, data")
    if not row:
        return {"empty": True}
    data = dict(row["data"])
    if slot is not None:
        sel = [s for s in data.get("slots", []) if s.get("slot") == slot]
        if not sel:
            return {"empty": True, "message": f"No hay datos para el espacio {slot}"}
        data["slots"] = sel
    return {"empty": False, "snapshot": _snap_meta(row), "taken_at": row["taken_at"].isoformat(), "data": data}


@router.get("/history")
def history():
    rows = all_("""SELECT id, taken_at, source, slot, sha256,
                   length(CAST(data AS BLOB)) AS data_bytes,
                   CAST(json_extract(data, '$.slots[0].hr') AS TEXT) AS hr,
                   CAST(json_extract(data, '$.slots[0].mr') AS TEXT) AS mr,
                   CAST(json_extract(data, '$.slots[0].playtime_seconds') AS TEXT) AS playtime_seconds
                   FROM profile_snapshots ORDER BY id DESC""")
    return [{**_snap_meta(r), "data_bytes": r["data_bytes"], "hr": r["hr"], "mr": r["mr"],
             "playtime_seconds": r["playtime_seconds"]} for r in rows]


@router.delete("/history/{snapshot_id}")
def delete_one(snapshot_id: int):
    if not one("DELETE FROM profile_snapshots WHERE id = ? RETURNING id", (snapshot_id,)):
        raise HTTPException(404, "No se encontró esa entrada del historial")
    return {"deleted": snapshot_id}


@router.delete("/history")
def delete_all():
    rows = all_("DELETE FROM profile_snapshots RETURNING id")
    return {"deleted": len(rows)}


@router.get("/monster/{monster_id}")
def monster_stats(monster_id: int, slot: int | None = Query(None, ge=0, le=99)):
    row = _last_snapshot("data")
    m = one("SELECT name_en FROM monsters WHERE id = ?", (monster_id,))
    if not row or not m:
        return None
    s = _first_slot(row["data"], slot)
    if not s:
        return None
    want = _norm(m["name_en"])
    for mon in s.get("monsters", []):
        if _norm(mon.get("name_en", "")) == want:
            return {k: mon.get(k) for k in ("hunted", "slayed", "captured", "research_level", "largest_pct",
                                            "smallest_pct", "base_size", "largest_size", "smallest_size", "crown")}
    return None


def _latest_slot(slot: int | None) -> tuple[dict | None, dict | None]:
    row = _last_snapshot("id, taken_at, source, slot, sha256, data")
    if not row:
        return None, None
    return row, _first_slot(row["data"], slot)


@router.get("/armor")
def armor(slot: int | None = Query(None, ge=0, le=99)):
    """Armor owned according to the last snapshot, mapped onto the guide's armor table."""
    row, s = _latest_slot(slot)
    if not row or not s:
        return {"empty": True}
    if "equipment" not in s:
        return {"empty": False, "available": False, "snapshot": _snap_meta(row),
                "message": "Esta instantánea es anterior a la lectura del equipo. Pulsa «Actualizar perfil»."}
    return {"empty": False, "available": True, "snapshot": _snap_meta(row), **armor_summary(s)}


# Story milestones (AchievementN indices): LR/HR assignments, Zorah, Xeno'jiiva, MR assignments, Shara, Guiding
# Lands, Ruiner Nergigante (MR cap). Read from the save's own achievement bitfield.
STORY_ACHIEVEMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 51, 52, 53, 54, 55, 56, 57, 61]


@router.get("/quests")
def quests(slot: int | None = Query(None, ge=0, le=99)):
    """Cleared quests (per quest id) and per-category counters from the last snapshot."""
    row, s = _latest_slot(slot)
    if not row or not s:
        return {"empty": True}
    qc = s.get("quest_counts")
    cleared = set(((s.get("quests") or {}).get("cleared")) or [])
    per_quest = "quests" in s
    rows = all_("SELECT id, name_en, name_es, category, rank, stars FROM quests ORDER BY id")
    by_category: dict[str, dict] = {}
    for r in rows:
        c = by_category.setdefault(r["category"], {"total": 0, "cleared": 0, "by_rank": {}})
        rk = c["by_rank"].setdefault(r["rank"], {"total": 0, "cleared": 0})
        c["total"] += 1
        rk["total"] += 1
        if r["id"] in cleared:
            c["cleared"] += 1
            rk["cleared"] += 1
    for c in by_category.values():
        c["percent"] = round(100.0 * c["cleared"] / c["total"], 1) if c["total"] else 0.0
    known = {r["id"] for r in rows}
    unlocked = s.get("achievements_unlocked")
    if unlocked is None:  # older snapshot: fall back to the Steam cache
        ach = (row["data"].get("steam_achievements") or {}).get("achievements") or {}
        unlocked = [int(k[11:]) for k, a in ach.items() if a.get("unlocked") and k[11:].isdigit()]
    unlocked = set(unlocked)
    names = {r["sort_order"] - 1: r for r in all_(
        "SELECT sort_order, slug, name_en, name_es FROM achievements WHERE sort_order IS NOT NULL")}
    story = [{"achievement": i, "slug": names.get(i, {}).get("slug"), "name_en": names.get(i, {}).get("name_en"),
              "name_es": names.get(i, {}).get("name_es"), "unlocked": i in unlocked} for i in STORY_ACHIEVEMENTS]
    in_guide = sorted(q for q in cleared if q in known)
    return {
        "empty": False, "snapshot": _snap_meta(row),
        "counts_available": qc is not None, "counts": qc,
        "total_cleared": sum(qc.values()) if qc else None,
        "per_quest_available": per_quest,
        "per_quest_reason": None if per_quest else "Instantánea anterior a la lectura por misión: pulsa «Actualizar perfil».",
        "cleared": in_guide,
        "cleared_not_in_guide": sorted(q for q in cleared if q not in known),
        "cleared_count": len(in_guide), "catalog_total": len(rows),
        "percent": round(100.0 * len(in_guide) / len(rows), 1) if rows else 0.0,
        "by_category": by_category,
        "story": story,
    }


def _by_name(sql: str) -> dict[str, dict]:
    return {(r["name_en"] or "").strip().lower(): r for r in all_(sql)}


def owned_gear(slot: dict) -> dict:
    """Stable, guide-id based view of what the hunter owns (for set recommendations)."""
    eq = slot.get("equipment") or {}
    cat = _armor_catalog()
    by_armor = {(r["name_en"] or "").strip().lower(): r for r in cat}
    weap = _by_name("SELECT id, name_en, name_es, weapon_type, rarity FROM weapons")
    deco = _by_name("SELECT id, name_en, name_es, rarity FROM decorations")
    charm = _by_name("SELECT id, name_en, name_es, rarity FROM charms")

    def mapped(items, table, extra=()):
        out, missing = [], []
        for it in items or []:
            r = table.get((it.get("name_en") or "").strip().lower())
            base = {"name_en": it.get("name_en"), "name_es": it.get("name_es"), "count": it.get("count", 1)}
            if r is None:
                missing.append({**base, "game_type": it.get("type"), "game_id": it.get("id")})
            else:
                out.append({"id": r["id"], **base, **{k: r.get(k) for k in extra}})
        return out, missing

    armor, armor_missing = mapped(eq.get("armor"), by_armor, ("type", "rank", "rarity", "armor_set_id"))
    weapons, weapons_missing = mapped(eq.get("weapons"), weap, ("weapon_type", "rarity"))
    charms, charms_missing = mapped(eq.get("charms"), charm, ("rarity",))
    decos, decos_missing = mapped(slot.get("decorations"), deco, ("rarity",))

    def ref(r):
        if not r:
            return None
        name = (r.get("name_en") or "").strip().lower()
        table = {"armor": by_armor, "weapon": weap, "charm": charm}.get(r.get("category"), {})
        hit = table.get(name)
        return {"id": hit["id"] if hit else None, "category": r.get("category"), "type": r.get("type"),
                "name_en": r.get("name_en"), "name_es": r.get("name_es")}

    gear = slot.get("gear") or {}
    current = {k: ref(v) for k, v in (gear.get("current") or {}).items()}
    loadouts = [{"slot": l.get("slot"), "name": l.get("name"),
                 **{k: ref(l.get(k)) for k in ("weapon", "head", "chest", "arms", "waist", "legs", "charm")},
                 "decoration_item_ids": l.get("decorations") or []} for l in gear.get("loadouts") or []]
    return {
        "format": 1,
        "semantics": "lo que hay ahora en el cofre de equipo; ids = ids de la guía (mhw.armor / weapons / charms / decorations)",
        "armor": armor, "weapons": weapons, "charms": charms, "decorations": decos,
        "not_in_guide": {"armor": armor_missing, "weapons": weapons_missing, "charms": charms_missing,
                         "decorations": decos_missing},
        "current": current, "loadouts": loadouts,
    }


@router.get("/equipment")
def equipment(slot: int | None = Query(None, ge=0, le=99)):
    row, s = _latest_slot(slot)
    if not row or not s:
        return {"empty": True}
    if "equipment" not in s:
        return {"empty": False, "available": False, "snapshot": _snap_meta(row),
                "message": "Esta instantánea es anterior a la lectura del equipo. Pulsa «Actualizar perfil»."}
    return {"empty": False, "available": True, "snapshot": _snap_meta(row), **owned_gear(s)}


def _achievements_progress(data: dict, s: dict) -> dict:
    """Steam list when available (AchievementN indices, base 0); otherwise the save's bitfield."""
    ach = (data.get("steam_achievements") or {}).get("achievements") or {}
    steam = sorted(int(k[11:]) for k, a in ach.items()
                   if a.get("unlocked") and k.startswith("Achievement") and k[11:].isdigit()) if ach else None
    save = s.get("achievements_unlocked")
    save_sorted = sorted(save) if save is not None else None
    return {
        "achievements_unlocked": steam if steam is not None else save_sorted,
        "achievements_source": "steam" if steam is not None else ("save" if save is not None else None),
        "achievements_save_matches_steam": (steam == save_sorted) if (steam is not None and save is not None) else None,
    }


@router.get("/stats")
def stats(slot: int | None = Query(None, ge=0, le=99)):
    """Everything the save gives, grouped by section, for the «Estadísticas del cazador» page."""
    row, s = _latest_slot(slot)
    if not row or not s:
        return {"empty": True}
    mons = s.get("monsters") or []
    large = [m for m in mons if m.get("name_en")]
    return {
        "empty": False, "snapshot": _snap_meta(row),
        "hunter": s.get("hunter") or {k: s.get(k) for k in ("name", "hr", "mr", "zenny", "research_points",
                                                            "playtime_seconds")},
        "guild_card": s.get("guild_card"),
        "progress": {
            **_achievements_progress(row["data"], s),
            "quest_counts": s.get("quest_counts"),
            "quests_cleared_count": (s.get("quests") or {}).get("cleared_count"),
        },
        "combat": {
            "large_monsters": {
                "species_hunted": sum(1 for m in large if m.get("hunted")),
                "hunted": sum(m.get("hunted", 0) for m in large),
                "slayed": sum(m.get("slayed", 0) for m in large),
                "captured": sum(m.get("captured", 0) for m in large),
                "research_maxed": sum(1 for m in large if m.get("research_level", 0) >= 9),
                "crowns": {k: sum(1 for m in large if (m.get("crown") or {}).get(k)) for k in ("mini", "silver", "gold")},
            },
            "monster_log": s.get("monster_log"),
            "weapon_usage": s.get("weapon_usage"),
        },
        "investigations": s.get("investigations"),
        "guiding_lands": s.get("guiding_lands"),
        "palico": s.get("palico"),
        "collection": {
            "decorations_distinct": len(s.get("decorations") or []),
            "decorations_total": sum(d.get("count", 0) for d in s.get("decorations") or []),
            "charms": len(((s.get("equipment") or {}).get("charms")) or []),
            "armor_pieces": len(((s.get("equipment") or {}).get("armor")) or []),
            "weapons": sum(w.get("count", 0) for w in ((s.get("equipment") or {}).get("weapons")) or []),
        },
        "loadouts_count": len(((s.get("gear") or {}).get("loadouts")) or []),
    }


# ---------------------------------------------------------------------------------------------
# Achievement progress (what the save can say about "how far am I / how much is left")
# ---------------------------------------------------------------------------------------------
# Targets taken from the achievement text. "Many" / "almost all" are NOT numeric in the game text:
# 28 comes from Gamer Guides (base game; Iceborne may differ) and is marked needs_review.
CROWN_MANY = 28
VARIANT_NAMES = {
    "Azure Rathalos", "Pink Rathian", "Black Diablos", "Viper Tobi-Kadachi", "Nightshade Paolumu",
    "Coral Pukei-Pukei", "Steel Uragaan", "Scarred Yian Garuga", "Gold Rathian", "Silver Rathalos",
    "Ebony Odogaron", "Blackveil Vaal Hazak", "Seething Bazelgeuse", "Brute Tigrex", "Fulgur Anjanath",
    "Stygian Zinogre", "Shrieking Legiana", "Savage Deviljho", "Raging Brachydios", "Furious Rajang",
    "Frostfang Barioth",
}


def _prog(cur, target, unit, note=None, review=False):
    pct = None if cur is None or not target else min(100, round(100 * cur / target))
    return {"current": cur, "target": target, "unit": unit, "pct": pct, "note": note, "needs_review": review}


@router.get("/achievement-progress")
def achievement_progress(slot: int | None = Query(None, ge=0, le=99)):
    """{sort_order: {current, target, unit, pct, note}} for achievements measurable from the save."""
    row, s = _latest_slot(slot)
    if not row or not s:
        return {"empty": True, "progress": {}}
    mons = [m for m in (s.get("monsters") or []) if m.get("name_en")]
    meta = {_norm(r["name_en"]): r for r in all_(
        "SELECT m.name_en, m.ecology_en, EXISTS(SELECT 1 FROM monster_rewards r WHERE r.monster_id=m.id "
        "AND r.rank IN ('LR','HR')) AS lrhr FROM monsters m WHERE m.size='large'")}
    big = [(m, meta[_norm(m["name_en"])]) for m in mons if _norm(m["name_en"]) in meta]
    elig = [m for m, r in big if r["lrhr"]]
    crown = lambda m, k: bool((m.get("crown") or {}).get(k))
    mini = sum(1 for m in elig if crown(m, "mini"))
    silver = sum(1 for m in elig if crown(m, "silver") or crown(m, "gold"))
    gold = sum(1 for m in elig if crown(m, "gold"))
    maxed = sum(1 for m in elig if (m.get("research_level") or 0) >= 9)
    hunted = sum(m.get("hunted", 0) for m, _ in big)
    captured = sum(m.get("captured", 0) for m, _ in big)
    elders = sum(m.get("slayed", 0) for m, r in big if r["ecology_en"] == "Elder Dragon")
    variants = sum((m.get("slayed", 0) + m.get("captured", 0)) for m, _ in big if m["name_en"] in VARIANT_NAMES)
    n = len(elig)
    almost = max(1, n - 2)  # "almost all": exact margin unknown
    hunter = s.get("hunter") or {}
    qc = s.get("quest_counts") or {}
    gl = [r.get("level", 0) for r in ((s.get("guiding_lands") or {}).get("regions") or [])]
    row_data = row["data"]
    unlocked = set(_achievements_progress(row_data, s).get("achievements_unlocked") or [])
    base_done = sum(1 for i in range(1, 50) if i in unlocked)
    ib_done = sum(1 for i in range(51, 100) if i in unlocked)
    inv = (s.get("investigations") or {}).get("count")
    P = {
        1: _prog(base_done, 49, "logros", "Logros del juego base desbloqueados"),
        51: _prog(ib_done, 49, "logros", "Logros de Iceborne desbloqueados"),
        12: _prog(inv, 50, "investigaciones"),
        14: _prog(qc.get("arena"), 50, "misiones de arena"),
        24: _prog(hunter.get("research_points"), 100000, "puntos de investigación"),
        25: _prog(hunter.get("zenny"), 1000000, "zenis"),
        31: _prog(maxed, CROWN_MANY, "monstruos con investigación al máximo",
                  f"El juego dice «muchos» sin cifra; la guía de PowerPyx da {CROWN_MANY} (juego base)", True),
        92: _prog(maxed, almost, "monstruos con investigación al máximo",
                  f"«Casi todos»: se calcula como {almost} de {n}", True),
        35: _prog(mini, 10, "coronas miniatura", "Solo monstruos de rango bajo o alto"),
        36: _prog(mini, CROWN_MANY, "coronas miniatura", f"El juego dice «muchos» sin cifra; la guía de PowerPyx da {CROWN_MANY} (juego base)", True),
        38: _prog(gold, 10, "coronas de oro", "Solo monstruos de rango bajo o alto"),
        39: _prog(gold, CROWN_MANY, "coronas de oro", f"El juego dice «muchos» sin cifra; la guía de PowerPyx da {CROWN_MANY} (juego base)", True),
        93: _prog(mini, almost, "coronas miniatura", f"«Casi todos»: se calcula como {almost} de {n}", True),
        94: _prog(gold, almost, "coronas de oro", f"«Casi todos»: se calcula como {almost} de {n}", True),
        37: _prog(silver, 1, "coronas de plata o más"),
        34: _prog(mini, 1, "coronas miniatura"),
        40: _prog(captured, 1, "capturas"),
        41: _prog(captured, 50, "capturas"),
        42: _prog(elders, 50, "dragones ancianos abatidos"),
        43: _prog(hunted, 100, "monstruos grandes cazados"),
        44: _prog(hunted, 500, "monstruos grandes cazados"),
        50: _prog(hunter.get("hr"), 100, "rango de cazador"),
        91: _prog(hunter.get("mr"), 200, "rango maestro"),
        59: _prog(max(gl) if gl else None, 7, "nivel de región"),
        100: _prog(variants, 30, "variantes cazadas", "Cuenta abatidas + capturadas; la lista de variantes es una estimación", True),
    }
    return {"empty": False, "snapshot": _snap_meta(row), "eligible_monsters": n, "progress": {str(k): v for k, v in P.items()}}
