"""Runtime settings, all env-driven. Defaults keep the Docker layout (/mhw/save, /mhw/stats, /data/saves, /research)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

is_frozen = bool(getattr(sys, "frozen", False))


def _env(name: str) -> str | None:
    v = os.environ.get(name)
    return v if v else None


def _flag(name: str, default: bool) -> bool:
    v = _env(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _repo_root() -> Path:
    p = Path(__file__).resolve().parents
    return p[2] if len(p) > 2 else p[-1]


RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", "")) if is_frozen else _repo_root()


def _research_dir() -> Path:
    if _env("MHW_RESEARCH_DIR"):
        return Path(os.environ["MHW_RESEARCH_DIR"])
    if Path("/research").is_dir():
        return Path("/research")
    return RESOURCE_DIR / "research"


def _user_data_dir() -> Path:
    if _env("MHW_USER_DATA_DIR"):
        return Path(os.environ["MHW_USER_DATA_DIR"])
    if is_frozen:
        exe_dir = Path(sys.executable).resolve().parent
        if (exe_dir / "portable.txt").is_file():
            return exe_dir / "data"
        return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "GuiaMHW"
    return _repo_root() / "data"


RESEARCH_DIR = _research_dir()
USER_DATA_DIR = _user_data_dir()
# SQLite: catalog.db (read-only, attached as `mhw`) and user.db (main read-write connection DB).
CATALOG_DB = Path(os.environ["MHW_CATALOG_DB"]) if _env("MHW_CATALOG_DB") else (
    RESOURCE_DIR / "catalog.db" if is_frozen else _repo_root() / "build" / "catalog.db")
USER_DB = USER_DATA_DIR / "user.db"
CATALOG_IMMUTABLE = _flag("MHW_CATALOG_IMMUTABLE", True)

# Save / Steam dirs are only ever read; SAVE_STORE holds the single stored copy of the save.
SAVE_MOUNT = os.environ.get("MHW_SAVE_MOUNT", "/mhw/save")
STATS_MOUNT = os.environ.get("MHW_STATS_MOUNT", "/mhw/stats")
# S2: on Windows / outside Docker the "/data/saves" default would resolve to <current drive>:\data\saves (outside
# USER_DATA_DIR); default to USER_DATA_DIR/saves there.
SAVE_STORE = _env("MHW_SAVE_STORE") or (
    "/data/saves" if (os.name != "nt" and Path("/data").is_dir()) else str(USER_DATA_DIR / "saves"))
BUILD_RULES_PATH = _env("BUILD_RULES_PATH")
DATABASE_URL = _env("DATABASE_URL")
SAVEREADER_BIN = os.environ.get("MHW_SAVEREADER_BIN", "mhw-savereader")

HOST = os.environ.get("MHW_HOST", "127.0.0.1")
PORT = int(os.environ.get("MHW_PORT", "8765"))
# En el paquete solo el bucle local (sin nombres de contenedor ni de pruebas: menos superficie para DNS rebinding).
ALLOWED_HOSTS = (["localhost", "127.0.0.1", "::1"] if is_frozen else ["localhost", "127.0.0.1", "::1", "testserver", "api", "web"]) + [
    h.strip() for h in os.environ.get("MHW_ALLOWED_HOSTS", "").split(",") if h.strip()]
DOCS_ENABLED = _flag("MHW_DOCS_ENABLED", not is_frozen)

WEB_DIST = Path(os.environ["MHW_WEB_DIST"]) if _env("MHW_WEB_DIST") else None
ICONS_DIR = Path(os.environ["MHW_ICONS_DIR"]) if _env("MHW_ICONS_DIR") else None

# F6: per-launch session token (set by the launcher before importing the app). None = dev/tests: nothing enforced.
SESSION_TOKEN = _env("MHW_SESSION_TOKEN")
