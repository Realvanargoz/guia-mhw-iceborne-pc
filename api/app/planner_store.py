"""Persistence for the phased builder: plan schema, per-build versions (build_versions) and the working draft.

PlanIn and its helper models live in plan_models (leaf module), so builds.py and this module do not import each other
circularly at module level.
"""
from __future__ import annotations

import json
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi import Path as PathParam
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from .plan_models import Id, PlanIn  # noqa: F401  (PlanIn re-exported)
from .db import J, all_, execute, now, one, transaction
from .validation import Note, Slug, Title, no_control_chars

MAX_ROW_BYTES = 64 * 1024
MAX_VERSIONS = 50
MAX_TESTS = 10
DRAFT_KEY = "planner_draft"
LABEL_RE = re.compile(r"^v\d{1,3}\.\d{1,3}$")

# ------------------------------------------------------------------ tests (hunt log)
Check = Literal["comodidad", "ritmo", "habilidades", "supervivencia", "estados", "dano", "afilado", "movilidad"]
Gap = Literal["bien", "regular", "mal"]


class TestLogIn(BaseModel):
    __test__ = False  # not a pytest class
    model_config = ConfigDict(extra="forbid")
    monster_id: Id
    tier: Literal["normal", "templado", "arch_templado"]
    checklist: dict[Check, Gap] = Field(default_factory=dict)
    gaps: list[Check] = Field(default_factory=list, max_length=8)
    minutes: int = Field(ge=1, le=120)
    carts: int = Field(ge=0, le=3)
    notes: Note = ""
    verdict: Literal["lista", "ajustar", "descartar"]


from . import builds

router = APIRouter(prefix="/api/builds")



class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = Field(None, pattern=r"^v\d{1,3}\.\d{1,3}$")
    payload: builds.SavedPayload
    plan: PlanIn | None = None
    tests: list[TestLogIn] = Field(default_factory=list, max_length=MAX_TESTS)
    parent_id: Id | None = None
    major: bool = False


class VersionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = Field(None, pattern=r"^v\d{1,3}\.\d{1,3}$")
    tests: list[TestLogIn] | None = Field(None, max_length=MAX_TESTS)


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: PlanIn
    loadout: builds.SavedPayload | None = None
    step: Literal["objetivo", "habilidades", "bono", "prioridades", "armadura", "joyas", "probar"]
    saved_id: Id | None = None


def _bytes(obj) -> int:
    return len(json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def _dump(model) -> dict | None:
    return model.model_dump() if model is not None else None


_META = "id, build_id, seq, label, parent_id, created_at, updated_at, (tests IS NOT NULL) AS has_tests"
_FULL = "id, build_id, seq, label, payload, plan, tests, parent_id, created_at, updated_at"


def _next_label(c, build_id: int, major: bool) -> str:
    rows = c.all_("SELECT label FROM build_versions WHERE build_id = ? ORDER BY seq", (build_id,))
    used = {r["label"] for r in rows}
    pairs = [tuple(int(x) for x in r["label"][1:].split(".")) for r in rows if LABEL_RE.match(r["label"])]
    if not pairs:
        major_n, minor_n = 1, 0
    elif major:
        major_n, minor_n = max(p[0] for p in pairs) + 1, 0
    else:
        last = pairs[-1]
        major_n, minor_n = last[0], last[1] + 1
    while f"v{major_n}.{minor_n}" in used:
        minor_n += 1
    label = f"v{major_n}.{minor_n}"
    if not LABEL_RE.match(label):
        raise HTTPException(409, "No se puede generar la etiqueta de versión; indica una manualmente")
    return label


def _require_build(c, build_id: int) -> dict:
    row = c.one("SELECT id FROM saved_builds WHERE id = ?", (build_id,))
    if row is None:
        raise HTTPException(404, "No se encontró el equipo guardado")
    return row


def _get_version(c, build_id: int, vid: int) -> dict:
    row = c.one(f"SELECT {_FULL} FROM build_versions WHERE id = ? AND build_id = ?", (vid, build_id))
    if row is None:
        raise HTTPException(404, "No se encontró la versión")
    return row


def _insert_version(c, build_id: int, label: str | None, major: bool, payload: dict, plan: dict | None,
                    tests: list | None, parent_id: int | None) -> dict:
    _require_build(c, build_id)
    if c.one("SELECT count(*) n FROM build_versions WHERE build_id = ?", (build_id,))["n"] >= MAX_VERSIONS:
        raise HTTPException(409, f"Máximo {MAX_VERSIONS} versiones por equipo; borra alguna antes de crear otra")
    if parent_id is not None and c.one("SELECT 1 x FROM build_versions WHERE id = ? AND build_id = ?",
                                       (parent_id, build_id)) is None:
        raise HTTPException(422, "La versión padre no pertenece a este equipo")
    if label is not None:
        if c.one("SELECT 1 x FROM build_versions WHERE build_id = ? AND label = ?", (build_id, label)):
            raise HTTPException(409, "Ya existe una versión con esa etiqueta")
    else:
        label = _next_label(c, build_id, major)
    seq = (c.one("SELECT COALESCE(MAX(seq), 0) m FROM build_versions WHERE build_id = ?", (build_id,))["m"]) + 1
    t = now()
    row = c.one(
        f"INSERT INTO build_versions (build_id, seq, label, payload, plan, tests, parent_id, created_at, updated_at) "
        f"VALUES (?,?,?,?,?,?,?,?,?) RETURNING {_FULL}",
        (build_id, seq, label, J(payload), J(plan) if plan is not None else None,
         J(tests) if tests is not None else None, parent_id, t, t))
    c.execute("UPDATE saved_builds SET payload = ?, plan = ?, current_version_id = ?, updated_at = ? WHERE id = ?",
              (J(payload), J(plan) if plan is not None else None, row["id"], t, build_id))
    return row


def _check_row(*objs) -> None:
    if sum(_bytes(o) for o in objs if o is not None) > MAX_ROW_BYTES:
        raise HTTPException(413, "La versión es demasiado grande (máx. 64 KB)")


@router.get("/saved/{saved_id}/versions")
def versions_list(saved_id: int = PathParam(ge=0, le=2_000_000_000)):
    if one("SELECT id FROM saved_builds WHERE id = ?", (saved_id,)) is None:
        raise HTTPException(404, "No se encontró el equipo guardado")
    return all_(f"SELECT {_META} FROM build_versions WHERE build_id = ? ORDER BY seq", (saved_id,))


@router.get("/saved/{saved_id}/versions/{vid}")
def versions_get(saved_id: int = PathParam(ge=0, le=2_000_000_000), vid: int = PathParam(ge=0, le=2_000_000_000)):
    row = one(f"SELECT {_FULL} FROM build_versions WHERE id = ? AND build_id = ?", (vid, saved_id))
    if row is None:
        raise HTTPException(404, "No se encontró la versión")
    return row


@router.post("/saved/{saved_id}/versions", status_code=201)
def versions_create(body: VersionIn, saved_id: int = PathParam(ge=0, le=2_000_000_000)):
    payload = builds._check_payload(body.payload)
    plan, tests = _dump(body.plan), [t.model_dump() for t in body.tests]
    _check_row(payload, plan, tests)
    with transaction() as c:
        return _insert_version(c, saved_id, body.label, body.major, payload, plan, tests or None, body.parent_id)


@router.put("/saved/{saved_id}/versions/{vid}")
def versions_update(body: VersionPatch, saved_id: int = PathParam(ge=0, le=2_000_000_000), vid: int = PathParam(ge=0, le=2_000_000_000)):
    if body.label is None and body.tests is None:
        raise HTTPException(422, "Indica label y/o tests")
    with transaction() as c:
        row = _get_version(c, saved_id, vid)
        label = row["label"]
        if body.label is not None and body.label != label:
            if c.one("SELECT 1 x FROM build_versions WHERE build_id = ? AND label = ? AND id <> ?",
                     (saved_id, body.label, vid)):
                raise HTTPException(409, "Ya existe una versión con esa etiqueta")
            label = body.label
        tests = row["tests"] if body.tests is None else [t.model_dump() for t in body.tests]
        _check_row(row["payload"], row["plan"], tests)
        c.execute("UPDATE build_versions SET label = ?, tests = ?, updated_at = ? WHERE id = ?",
                  (label, J(tests) if tests else None, now(), vid))
        return _get_version(c, saved_id, vid)


@router.post("/saved/{saved_id}/versions/{vid}/restore", status_code=201)
def versions_restore(saved_id: int = PathParam(ge=0, le=2_000_000_000), vid: int = PathParam(ge=0, le=2_000_000_000)):
    with transaction() as c:
        old = _get_version(c, saved_id, vid)
        return _insert_version(c, saved_id, None, False, old["payload"], old["plan"], None, vid)


@router.delete("/saved/{saved_id}/versions/{vid}")
def versions_delete(saved_id: int = PathParam(ge=0, le=2_000_000_000), vid: int = PathParam(ge=0, le=2_000_000_000)):
    with transaction() as c:
        _get_version(c, saved_id, vid)
        c.execute("DELETE FROM build_versions WHERE id = ?", (vid,))
        c.execute("UPDATE saved_builds SET current_version_id = "
                  "(SELECT id FROM build_versions WHERE build_id = ? ORDER BY seq DESC LIMIT 1) "
                  "WHERE id = ? AND current_version_id = ?", (saved_id, saved_id, vid))
    return {"ok": True, "id": vid}


# ------------------------------------------------------------------ draft (single working draft in user_meta)
def _draft_out(raw: str | None) -> dict:
    if not raw:
        return {"draft": None, "updated_at": None}
    try:
        out = json.loads(raw)
        if isinstance(out, dict) and "draft" in out:
            return out
    except ValueError:
        pass
    return {"draft": None, "updated_at": None}   # corrupt row: behave as "no draft" instead of a 500


@router.get("/plan/draft")
def draft_get():
    row = one("SELECT value FROM user_meta WHERE key = ?", (DRAFT_KEY,))
    return _draft_out(row["value"] if row else None)


@router.put("/plan/draft")
def draft_put(body: DraftIn):
    stored = {"draft": body.model_dump(), "updated_at": now().strftime("%Y-%m-%dT%H:%M:%S.%fZ")}
    raw = json.dumps(stored, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_ROW_BYTES:
        raise HTTPException(413, "El borrador es demasiado grande (máx. 64 KB)")
    execute("INSERT INTO user_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            (DRAFT_KEY, raw))
    return stored


@router.delete("/plan/draft")
def draft_delete():
    execute("DELETE FROM user_meta WHERE key = ?", (DRAFT_KEY,))
    return {"ok": True}
