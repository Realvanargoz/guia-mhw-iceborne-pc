"""Write guard: every write/replace/remove must land inside an allowed root (symlinks and .. resolved)."""
from __future__ import annotations

import os

from . import settings

_extra: list[str] = []


def register_root(path) -> None:
    _extra.append(os.path.realpath(str(path)))


def _roots() -> list[str]:
    return [os.path.realpath(str(r)) for r in (settings.USER_DATA_DIR, settings.SAVE_STORE)] + _extra


def ensure_writable(path) -> str:
    real = os.path.realpath(os.fspath(path))
    for root in _roots():
        try:
            if os.path.commonpath([real, root]) == root:
                return real
        except ValueError:  # different drives
            continue
    raise PermissionError("Escritura fuera de las carpetas permitidas")
