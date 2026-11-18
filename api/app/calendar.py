"""Event calendar: seasonal fests (catalog from research), periods entered by the user, and a projected
siege rotation.

Capcom publishes no fixed dates for the PC fest rotation (fests come back in two-week blocks; the active
one shows on the in-game Notice Board), so festival periods are entered by the user. Sieges alternate every
two weeks (Safi'jiiva / Kulve Taroth + The Eternal Gold Rush): given one date the user confirmed in game,
the rotation is projected and flagged as an estimate.
"""
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from .validation import ID_PATTERN, Note, Title

from .db import J, all_, execute, now as db_now, one

router = APIRouter(prefix="/api")


SIEGES = {
    "safi": {"title_es": "Asedio de Safi'jiiva", "title_en": "Safi'jiiva Siege", "theme": "safi"},
    "kulve": {"title_es": "Asedio de Kulve Taroth y «The Eternal Gold Rush»",
              "title_en": "Kulve Taroth Siege / The Eternal Gold Rush", "theme": "kulve"},
}
KINDS = ("festival", "siege", "event", "custom")
MAX_RANGE_DAYS = 400
_MIN_DT = datetime(2000, 1, 1, tzinfo=timezone.utc)
_MAX_DT = datetime(2100, 1, 1, tzinfo=timezone.utc)


def ensure_tables() -> None:
    """No-op: userdb.migrate() creates calendar_periods and calendar_settings."""


def _festivals() -> dict:
    return {f["slug"]: f for f in all_(
        "SELECT slug, season, name_es, astera_en, seliana_en, theme, sort_order, summary_es, tickets, layered "
        "FROM festivals ORDER BY sort_order")}


def _siege_setting() -> dict | None:
    row = one("SELECT value FROM calendar_settings WHERE key = 'siege_rotation'")
    return row["value"] if row else None


def _siege_blocks(start: datetime, end: datetime) -> list[dict]:
    s = _siege_setting()
    if not s:
        return []
    anchor = datetime.fromisoformat(s["anchor_at"])
    days = int(s.get("period_days", 14))
    first = s["anchor_siege"]
    other = "kulve" if first == "safi" else "safi"
    step = timedelta(days=days)
    k = (start - anchor) // step
    out = []
    while True:
        b_start = anchor + k * step
        if b_start >= end:
            break
        which = first if k % 2 == 0 else other
        out.append({"id": f"siege-{k}", "kind": "siege", "siege": which, **SIEGES[which],
                    "start_at": b_start.isoformat(), "end_at": (b_start + step).isoformat(),
                    "estimated": k != 0, "source": "proyección a partir de la fecha que confirmaste en el juego"})
        k += 1
    return out


def _periods(start: datetime, end: datetime) -> list[dict]:
    fest = _festivals()
    rows = all_("SELECT * FROM calendar_periods WHERE start_at < ? AND end_at > ? ORDER BY start_at",
                (end, start))
    out = []
    for r in rows:
        f = fest.get(r["festival_slug"]) if r["festival_slug"] else None
        title = r["title"] or (f["name_es"] if f else r["kind"])
        out.append({"id": r["id"], "kind": r["kind"], "festival_slug": r["festival_slug"], "title_es": title,
                    "festival": f, "theme": f["theme"] if f else None, "notes": r["notes"],
                    "start_at": r["start_at"].isoformat(), "end_at": r["end_at"].isoformat(), "estimated": False})
    return out


def _range(start: date | None, end: date | None) -> tuple[datetime, datetime]:
    today = db_now().date()
    s = start or today.replace(day=1)
    e = end or (s + timedelta(days=42))
    if e <= s or (e - s).days > MAX_RANGE_DAYS:
        raise HTTPException(400, f"Rango no válido (máximo {MAX_RANGE_DAYS} días)")
    return (datetime.combine(s, time(), timezone.utc), datetime.combine(e, time(), timezone.utc))


@router.get("/festivals")
def festivals():
    return list(_festivals().values())


@router.get("/calendar")
def calendar(start: date | None = Query(None), end: date | None = Query(None)):
    s, e = _range(start, end)
    return {"start": s.isoformat(), "end": e.isoformat(),
            "entries": sorted(_periods(s, e) + _siege_blocks(s, e), key=lambda x: x["start_at"]),
            "siege_rotation": _siege_setting(), "festivals": list(_festivals().values())}


@router.get("/calendar/now")
def calendar_now():
    now = db_now()
    soon = now + timedelta(days=45)
    entries = sorted(_periods(now, soon) + _siege_blocks(now, soon), key=lambda x: x["start_at"])
    active = [x for x in entries if x["start_at"] <= now.isoformat() < x["end_at"]]
    upcoming = [x for x in entries if x["start_at"] > now.isoformat()][:5]
    fest = next((x for x in active if x["kind"] == "festival"), None)
    return {"now": now.isoformat(), "active": active, "upcoming": upcoming, "festival": fest,
            "theme": fest["theme"] if fest else None, "siege_rotation": _siege_setting()}


class PeriodIn(BaseModel):
    kind: Literal["festival", "siege", "event", "custom"] = "festival"
    festival_slug: str | None = Field(None, pattern=ID_PATTERN)
    title: Title | None = None
    start_at: datetime
    end_at: datetime
    notes: Note | None = None

    @model_validator(mode="after")
    def check(self):
        for f in ("start_at", "end_at"):
            v = getattr(self, f)
            if v.tzinfo is None:
                setattr(self, f, v.replace(tzinfo=timezone.utc))
        for f in ("start_at", "end_at"):
            if not _MIN_DT <= getattr(self, f) <= _MAX_DT:
                raise ValueError("Fecha fuera de rango (2000-2100)")
        if self.end_at <= self.start_at:
            raise ValueError("La fecha de fin debe ser posterior a la de inicio")
        if self.kind == "festival" and not self.festival_slug:
            raise ValueError("Elige qué festival es")
        if self.kind != "festival" and not (self.title or "").strip():
            raise ValueError("Ponle un título al periodo")
        return self


def _check_festival(slug: str | None) -> None:
    if slug and not one("SELECT 1 AS ok FROM festivals WHERE slug = ?", (slug,)):
        raise HTTPException(400, "Festival desconocido")


@router.post("/calendar/periods", status_code=201)
def add_period(body: PeriodIn):
    _check_festival(body.festival_slug)
    row = one("""INSERT INTO calendar_periods (kind, festival_slug, title, start_at, end_at, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id""",
              (body.kind, body.festival_slug if body.kind == "festival" else None, (body.title or "").strip() or None,
               body.start_at, body.end_at, body.notes, db_now()))
    return {"id": row["id"]}


@router.put("/calendar/periods/{period_id}")
def update_period(period_id: int, body: PeriodIn):
    _check_festival(body.festival_slug)
    row = one("""UPDATE calendar_periods SET kind = ?, festival_slug = ?, title = ?, start_at = ?,
                 end_at = ?, notes = ? WHERE id = ? RETURNING id""",
              (body.kind, body.festival_slug if body.kind == "festival" else None, (body.title or "").strip() or None,
               body.start_at, body.end_at, body.notes, period_id))
    if not row:
        raise HTTPException(404, "No se encontró el periodo")
    return {"id": period_id}


@router.delete("/calendar/periods/{period_id}")
def delete_period(period_id: int):
    row = one("DELETE FROM calendar_periods WHERE id = ? RETURNING id", (period_id,))
    if not row:
        raise HTTPException(404, "No se encontró el periodo")
    return {"deleted": period_id}


class SiegeIn(BaseModel):
    anchor_at: datetime
    anchor_siege: Literal["safi", "kulve"]
    period_days: int = Field(14, ge=7, le=28)

    @model_validator(mode="after")
    def check(self):
        at = self.anchor_at if self.anchor_at.tzinfo else self.anchor_at.replace(tzinfo=timezone.utc)
        if not _MIN_DT <= at <= _MAX_DT:
            raise ValueError("Fecha fuera de rango (2000-2100)")
        return self


@router.put("/calendar/siege-rotation")
def set_siege(body: SiegeIn):
    if not 7 <= body.period_days <= 28:
        raise HTTPException(400, "El periodo debe estar entre 7 y 28 días")
    at = body.anchor_at if body.anchor_at.tzinfo else body.anchor_at.replace(tzinfo=timezone.utc)
    value = {"anchor_at": at.isoformat(), "anchor_siege": body.anchor_siege, "period_days": body.period_days}
    execute("""INSERT INTO calendar_settings (key, value, updated_at) VALUES ('siege_rotation', ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (J(value), db_now()))
    return value


@router.delete("/calendar/siege-rotation")
def clear_siege():
    execute("DELETE FROM calendar_settings WHERE key = 'siege_rotation'")
    return {"cleared": True}
