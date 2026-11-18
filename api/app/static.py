"""Optional static serving of the built web app (local app mode). Mounted last so /api routes win."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

from . import settings

_NOT_FOUND = {"detail": "No encontrado"}
# No framing by other sites (clickjacking of sync / delete buttons) and no MIME sniffing.
_SEC_HEADERS = {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                "Content-Security-Policy": "frame-ancestors 'none'"}


def _file(p: Path) -> FileResponse:
    return FileResponse(p, headers=_SEC_HEADERS)


def safe_join(root: Path | str, rel: str) -> Path | None:
    """Resolve rel under root; None if it escapes root, has backslashes/NULs or (double-)encoded traversal."""
    rel = rel.lstrip("/")
    for _ in range(4):
        if "\\" in rel or "\x00" in rel:
            return None
        dec = unquote(rel)
        if dec == rel:
            break
        rel = dec
    else:
        return None
    if any(part == ".." for part in rel.split("/")):
        return None
    base = os.path.realpath(str(root))
    full = os.path.realpath(os.path.join(base, rel))
    try:
        if os.path.commonpath([full, base]) != base:
            return None
    except ValueError:
        return None
    return Path(full)


def serve_file(root: Path | str | None, rel: str) -> Response:
    p = safe_join(root, rel) if root is not None else None
    if p is None or not p.is_file():
        return JSONResponse(_NOT_FOUND, status_code=404)
    return _file(p)


def mount_web(app: FastAPI) -> None:
    dist = settings.WEB_DIST
    if not dist:
        return
    dist_s = str(dist)
    icons = settings.ICONS_DIR

    @app.get("/assets/{rel:path}", include_in_schema=False)
    def _assets(rel: str):
        return serve_file(os.path.join(dist_s, "assets"), rel)

    @app.get("/ui/{rel:path}", include_in_schema=False)
    def _ui(rel: str):
        return serve_file(os.path.join(dist_s, "ui"), rel)

    @app.get("/icons/{rel:path}", include_in_schema=False)
    def _icons(rel: str):
        return serve_file(icons, rel)

    @app.get("/{rel:path}", include_in_schema=False)
    def _spa(rel: str):
        if rel == "api" or rel.startswith("api/"):
            return JSONResponse(_NOT_FOUND, status_code=404)
        if rel:
            p = safe_join(dist_s, rel)
            if p is not None and p.is_file():
                return _file(p)
        index = Path(dist_s) / "index.html"
        if not index.is_file():
            return JSONResponse(_NOT_FOUND, status_code=404)
        return _file(index)
