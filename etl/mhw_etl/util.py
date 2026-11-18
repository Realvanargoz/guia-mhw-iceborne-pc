import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from . import config


def key(name: str | None) -> str:
    """Lookup key: case-insensitive, whitespace-collapsed."""
    return " ".join((name or "").split()).lower()


def J(value) -> str:
    """JSON text for a JSON column (UTF-8 kept readable)."""
    return json.dumps(value, ensure_ascii=False)


def norm_lower(s: str | None) -> str | None:
    """Unicode-aware lowercase (SQLite lower() is ASCII-only). Registered in SQLite as norm_lower()."""
    return s.lower() if isinstance(s, str) else s


def utc_ts(v) -> str | None:
    """Normalise a timestamp to fixed-width UTC text 'YYYY-MM-DDTHH:MM:SS.ffffffZ' (naive input = UTC)."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        d = datetime.fromtimestamp(v, timezone.utc)
    else:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        d = d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def clean(name: str | None) -> str | None:
    if name is None:
        return None
    s = " ".join(name.split())
    return s or None


def read_csv(rel: str) -> list[dict]:
    path = config.MHWORLDDATA_DIR / rel
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return [{(k or "").strip(): (v.strip() if isinstance(v, str) else v) for k, v in r.items()} for r in rows]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def to_int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def to_num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_bool(v) -> bool | None:
    if v is None or v == "":
        return None
    return str(v).strip().lower() in ("true", "1", "yes", "y")


class Lookup:
    """name_en -> id map that records misses for the unresolved report."""

    def __init__(self, kind: str, misses: "Misses"):
        self.kind = kind
        self.map: dict[str, int] = {}
        self.misses = misses

    def add(self, name: str, id_: int) -> None:
        self.map.setdefault(key(name), id_)

    def get(self, name: str | None, context: str) -> int | None:
        if not name:
            return None
        found = self.map.get(key(name))
        if found is None:
            self.misses.add(self.kind, name, context)
        return found

    def __contains__(self, name: str) -> bool:
        return key(name) in self.map


class Misses:
    def __init__(self):
        self.by_kind: dict[str, Counter] = defaultdict(Counter)

    def add(self, kind: str, name: str, context: str) -> None:
        self.by_kind[kind][f"{name}  <- {context}"] += 1

    def total(self) -> int:
        return sum(sum(c.values()) for c in self.by_kind.values())

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        out = {k: dict(v.most_common()) for k, v in self.by_kind.items()}
        with open(path, "w", encoding="utf-8", newline="\n") as f:  # LF on every OS
            f.write(json.dumps(out, ensure_ascii=False, indent=2))
