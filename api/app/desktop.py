"""Desktop-mode endpoints: app info and the window heartbeat. Harmless in dev: nothing watches the heartbeat there."""
from __future__ import annotations

import time

from fastapi import APIRouter

from . import settings
from .version import VERSION

router = APIRouter(prefix="/api/app")

_last_beat: float | None = None  # time.monotonic() of the last heartbeat; None = none received yet


_last_activity: float | None = None  # monotonic time of the last heartbeat or /api request


def last_heartbeat() -> float | None:
    return _last_beat


def touch() -> None:
    global _last_activity
    _last_activity = time.monotonic()


def last_activity() -> float | None:
    """Most recent of heartbeat and API activity (None = nothing yet)."""
    vals = [v for v in (_last_beat, _last_activity) if v is not None]
    return max(vals) if vals else None


class ActivityMiddleware:
    """Pure ASGI middleware: records only a timestamp for /api requests (no headers, bodies or secrets)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and str(scope.get("path", "")).startswith("/api"):
            touch()
        await self.app(scope, receive, send)


def _beat() -> None:
    global _last_beat
    _last_beat = time.monotonic()
    touch()


@router.get("/info")
def info():
    return {"name": "Guía MHW", "version": VERSION, "frozen": settings.is_frozen}


@router.post("/heartbeat")
def heartbeat():
    _beat()
    return {"ok": True}
