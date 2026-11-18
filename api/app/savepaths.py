"""Native (Windows) detection of the MHW save and Steam stats files. STRICTLY READ-ONLY.

* Only os.stat / os.path.isfile / os.scandir and the registry opened with KEY_READ are used on game/Steam paths.
* Save CONTENT is never read here, and nothing here triggers a sync.
* The only thing written is USER_DATA_DIR/settings.json (key ``save_path``), via ensure_writable + tmp + os.replace.
"""
from __future__ import annotations

import json
import os
import stat
import sys
from datetime import datetime, timezone

from . import settings
from .safepath import ensure_writable

APP_ID = "582010"
SAVE_NAME = "SAVEDATA1000"
MIN_SAVE_BYTES = 1024
MAX_SAVE_BYTES = 32 * 1024 * 1024  # same absolute cap as profile.HARD_UPLOAD_LIMIT
MAX_PATH_LEN = 400
SETTINGS_KEY = "save_path"


class SavePathError(ValueError):
    """Validation failure; the message is Spanish and safe to show to the user."""


# ------------------------------------------------------------------ Steam root

def _read_registry_steam_path() -> str | None:
    """HKCU\\Software\\Valve\\Steam\\SteamPath, opened read-only. None when unavailable (non-Windows, no key)."""
    if sys.platform != "win32":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", 0, winreg.KEY_READ) as k:
            value, _ = winreg.QueryValueEx(k, "SteamPath")
        return value if isinstance(value, str) and value else None
    except OSError:
        return None


def steam_root() -> str | None:
    if sys.platform != "win32":
        return None
    cands = [_read_registry_steam_path()]
    pf = os.environ.get("ProgramFiles(x86)")
    if pf:
        cands.append(os.path.join(pf, "Steam"))
    for c in cands:
        if c:
            p = os.path.normpath(c)
            if os.path.isdir(p):
                return p
    return None


# ------------------------------------------------------------------ validation

def validate_save_file(path: str) -> os.stat_result:
    """Strict check of a candidate save path. Returns its stat result or raises SavePathError."""
    if not isinstance(path, str) or not path.strip():
        raise SavePathError("Indica la ruta del archivo SAVEDATA1000.")
    if len(path) > MAX_PATH_LEN or "\x00" in path:
        raise SavePathError("La ruta no es válida.")
    p = path.strip().strip('"')
    if not os.path.isabs(p):
        raise SavePathError("La ruta debe ser absoluta (por ejemplo C:\\...\\SAVEDATA1000).")
    # UNC / \\?\ / \\.\ (also mixed "\/" and "/\"): stat() would reach the network (SMB credential leak) or devices
    if p.replace("/", "\\")[:2] == "\\\\":
        raise SavePathError("Solo se admiten rutas de unidades locales (no rutas de red ni de dispositivo).")
    parts = p.replace("\\", "/").split("/")
    if ".." in parts:
        raise SavePathError("La ruta no puede contener «..».")
    if parts[-1] != SAVE_NAME:
        raise SavePathError(f"El archivo debe llamarse exactamente {SAVE_NAME}.")
    try:
        if os.path.islink(p):
            raise SavePathError("El archivo no puede ser un enlace simbólico.")
        st = os.stat(p)
    except OSError:
        raise SavePathError("No se encontró ese archivo.")
    if not stat.S_ISREG(st.st_mode):
        raise SavePathError("La ruta debe ser un archivo normal (no una carpeta ni un dispositivo).")
    real = os.path.realpath(p)
    if os.path.normcase(real) != os.path.normcase(os.path.abspath(p)):
        raise SavePathError("La ruta pasa por un enlace o acceso directo; indica la ruta real del archivo.")
    try:
        if not os.path.samefile(real, p):
            raise SavePathError("La ruta no apunta al mismo archivo.")
    except OSError:
        raise SavePathError("No se pudo comprobar el archivo.")
    if st.st_size > MAX_SAVE_BYTES:
        raise SavePathError("El archivo supera el límite de 32 MB.")
    if st.st_size < MIN_SAVE_BYTES:
        raise SavePathError("El archivo es demasiado pequeño para ser una partida.")
    return st


# ------------------------------------------------------------------ candidates / stats

def _account_of(path: str) -> str | None:
    parts = os.path.normpath(path).replace("\\", "/").split("/")
    if len(parts) >= 5 and parts[-1] == SAVE_NAME and parts[-2] == "remote" and parts[-3] == APP_ID \
            and parts[-5].lower() == "userdata" and parts[-4].isdigit():
        return parts[-4]
    return None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def find_saves() -> list[dict]:
    """userdata\\<id>\\582010\\remote\\SAVEDATA1000 under the Steam root, newest mtime first."""
    root = steam_root()
    if not root:
        return []
    userdata = os.path.join(root, "userdata")
    out: list[dict] = []
    try:
        with os.scandir(userdata) as it:
            accounts = [e.name for e in it if e.name.isdigit() and e.is_dir(follow_symlinks=False)]
    except OSError:
        return []
    for acct in accounts:
        p = os.path.join(userdata, acct, APP_ID, "remote", SAVE_NAME)
        try:
            st = validate_save_file(p)
        except SavePathError:
            continue
        out.append({"account_id": acct, "path": p, "size": st.st_size, "mtime": _iso(st.st_mtime),
                    "mtime_ts": st.st_mtime})
    out.sort(key=lambda c: (-c["mtime_ts"], c["account_id"]))
    return out


def find_stats(account_id: str | None = None) -> tuple[str | None, str | None]:
    """(UserGameStats_<acct>_582010.bin, UserGameStatsSchema_582010.bin) in Steam's appcache\\stats, if present."""
    root = steam_root()
    if not root:
        return None, None
    d = os.path.join(root, "appcache", "stats")
    schema = os.path.join(d, f"UserGameStatsSchema_{APP_ID}.bin")
    stats_file = None
    if account_id and str(account_id).isdigit():
        p = os.path.join(d, f"UserGameStats_{account_id}_{APP_ID}.bin")
        stats_file = p if os.path.isfile(p) else None
    elif not account_id:
        try:
            with os.scandir(d) as it:
                names = sorted(e.name for e in it if e.name.startswith("UserGameStats_")
                               and e.name.endswith(f"_{APP_ID}.bin"))
        except OSError:
            names = []
        stats_file = os.path.join(d, names[0]) if names else None
    return stats_file, (schema if os.path.isfile(schema) else None)


# ------------------------------------------------------------------ override (settings.json)

def _settings_file() -> str:
    return os.path.join(str(settings.USER_DATA_DIR), "settings.json")


def _load_settings() -> dict:
    try:
        with open(_settings_file(), "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def get_override() -> str | None:
    v = _load_settings().get(SETTINGS_KEY)
    return v if isinstance(v, str) and v else None


def set_override(path: str | None) -> str | None:
    """Validate and persist (or clear with None) the manual save path. Never touches the save itself."""
    value = None
    if path is not None and str(path).strip():
        value = str(path).strip().strip('"')
        validate_save_file(value)
    data = _load_settings()
    if value is None:
        data.pop(SETTINGS_KEY, None)
    else:
        data[SETTINGS_KEY] = value
    target = ensure_writable(_settings_file())
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = ensure_writable(target + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)
    return value


# ------------------------------------------------------------------ resolution

def resolve(mount_dir: str) -> dict:
    """Order: mount (Docker) -> settings.json override -> newest auto-detected candidate.

    Returns {path, source ('mount'|'override'|'auto'|None), account_id, candidates: [...]}.
    """
    cands = find_saves()
    mounted = os.path.join(mount_dir, SAVE_NAME)
    if os.path.isfile(mounted):
        return {"path": mounted, "source": "mount", "account_id": None, "candidates": cands}
    ov = get_override()
    if ov:
        try:
            validate_save_file(ov)
            return {"path": ov, "source": "override", "account_id": _account_of(ov), "candidates": cands}
        except SavePathError:
            pass  # stale override: fall through to auto-detection
    if cands:
        return {"path": cands[0]["path"], "source": "auto", "account_id": cands[0]["account_id"],
                "candidates": cands}
    return {"path": mounted, "source": None, "account_id": None, "candidates": cands}
