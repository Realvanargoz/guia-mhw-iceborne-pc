"""Read-only parser for Steam's local achievement cache of Monster Hunter: World.

Steam keeps two binary KeyValues ("binary VDF") files per game under
``Steam/appcache/stats``:

* ``UserGameStatsSchema_<appid>.bin`` -- the schema. Layout::

      "<appid>" { "stats" { "<statId>" {
          "type"  "ACHIEVEMENTS"          (or "INT", ...)
          "bits"  { "<bitIndex>" { "name" "Achievement15"
                                   "display" { "name" {"english" ...} ... } } }
      } } "version" .. "gamename" .. }

  For MH:World (582010) achievements live in stats 5460..5509 and 10645:
  stats 5460..5508 hold one bit each (Achievement0..48), stat 5509 holds
  32 bits (Achievement49..80) and stat 10645 holds 19 bits (Achievement81..99).
  Stats 1 and 5459 are ACHIEVEMENTS stats with no bits.

* ``UserGameStats_<accountId>_<appid>.bin`` -- the user's cached values::

      "cache" { "crc" .. "PendingChanges" ..
                "<statId>" { "data" <int32 bitfield>
                             "AchievementTimes" { "<bitIndex>" <unix time> } } }

  An achievement is unlocked when bit ``bitIndex`` of ``data`` is set; the
  unlock time (UTC seconds) is in ``AchievementTimes[bitIndex]``. Stats with
  ``data == 0`` may be omitted entirely.

This module only ever opens files with ``'rb'``; it never writes anything.
Stdlib only, Python 3.12+.
"""
from __future__ import annotations

import logging
import os
import struct
import sys
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# Binary KeyValues type bytes.
_T_SUB = 0x00
_T_STR = 0x01
_T_INT = 0x02
_T_FLOAT = 0x03
_T_PTR = 0x04
_T_WSTR = 0x05
_T_COLOR = 0x06
_T_UINT64 = 0x07
_T_END = 0x08
_T_INT64 = 0x0A
_T_END_ALT = 0x0B  # some writers use 0x0B as end marker

_MAX_FILE_SIZE = 64 * 1024 * 1024
_MAX_DEPTH = 64


def _cstr(data: bytes, pos: int) -> tuple[str, int]:
    end = data.find(b"\x00", pos)
    if end < 0:
        raise ValueError(f"unterminated string at offset {pos}")
    raw = data[pos:end]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        # Some localized schema strings are stored in a legacy 8-bit codepage.
        text = raw.decode("cp1252", errors="replace")
    return text, end + 1


def _need(data: bytes, pos: int, size: int) -> None:
    if pos + size > len(data):
        raise ValueError(f"truncated value at offset {pos}")


def parse_kv(data: bytes) -> dict:
    """Parse a binary KeyValues blob into nested dicts.

    Subsections become dicts, strings become ``str``, int32/pointer/color
    become ``int`` (signed), float becomes ``float``, uint64/int64 become
    ``int``. Duplicate keys: the last one wins. Raises ``ValueError`` on
    unknown type bytes, truncation or malformed nesting.
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ValueError("parse_kv expects bytes")
    data = bytes(data)
    n = len(data)
    pos = 0
    root: dict = {}
    stack: list[dict] = [root]
    while True:
        if pos >= n:
            if len(stack) == 1:
                return root
            raise ValueError("unexpected end of data inside a subsection")
        t_off = pos
        t = data[pos]
        pos += 1
        if t in (_T_END, _T_END_ALT):
            if len(stack) == 1:
                # Top-level terminator; anything after it is ignored.
                return root
            stack.pop()
            continue
        key, pos = _cstr(data, pos)
        cur = stack[-1]
        if t == _T_SUB:
            if len(stack) >= _MAX_DEPTH:
                raise ValueError("KeyValues nesting too deep")
            child: dict = {}
            cur[key] = child
            stack.append(child)
        elif t == _T_STR:
            cur[key], pos = _cstr(data, pos)
        elif t in (_T_INT, _T_PTR, _T_COLOR):
            _need(data, pos, 4)
            cur[key] = struct.unpack_from("<i", data, pos)[0]
            pos += 4
        elif t == _T_FLOAT:
            _need(data, pos, 4)
            cur[key] = struct.unpack_from("<f", data, pos)[0]
            pos += 4
        elif t == _T_UINT64:
            _need(data, pos, 8)
            cur[key] = struct.unpack_from("<Q", data, pos)[0]
            pos += 8
        elif t == _T_INT64:
            _need(data, pos, 8)
            cur[key] = struct.unpack_from("<q", data, pos)[0]
            pos += 8
        elif t == _T_WSTR:
            # UTF-16LE, terminated by a 16-bit zero.
            end = pos
            while True:
                _need(data, end, 2)
                if data[end] == 0 and data[end + 1] == 0:
                    break
                end += 2
            cur[key] = data[pos:end].decode("utf-16-le", errors="replace")
            pos = end + 2
        else:
            raise ValueError(f"unknown KeyValues type 0x{t:02x} at offset {t_off}")


def _read_file(path) -> bytes:
    size = os.path.getsize(path)
    if size > _MAX_FILE_SIZE:
        raise ValueError(f"{path}: file too large ({size} bytes)")
    with open(path, "rb") as fh:  # read-only, never written
        return fh.read()


def _iso(ts) -> str | None:
    if not isinstance(ts, int) or ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def _english(display: dict, field: str) -> str | None:
    v = display.get(field) if isinstance(display, dict) else None
    if isinstance(v, dict):
        v = v.get("english") or next((x for x in v.values() if isinstance(x, str)), None)
    return v if isinstance(v, str) and v else None


def _achievement_bits(schema: dict) -> list[tuple[str, int, str, dict]]:
    """Return [(stat_id, bit_index, api_name, display)] from a parsed schema."""
    # Root has a single key: the appid.
    app = next((v for v in schema.values() if isinstance(v, dict) and "stats" in v), None)
    if app is None or not isinstance(app.get("stats"), dict):
        raise ValueError("schema has no stats section")
    out = []
    for stat_id, stat in app["stats"].items():
        if not isinstance(stat, dict):
            continue
        stype = stat.get("type")
        if not (stype == "ACHIEVEMENTS" or stype == 4 or stype == "4"):
            continue
        bits = stat.get("bits")
        if not isinstance(bits, dict):
            continue
        for bit_key, bit in bits.items():
            if not isinstance(bit, dict) or not isinstance(bit.get("name"), str):
                continue
            idx = bit.get("bit", bit_key)  # explicit "bit" if present, else the key
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            if not 0 <= idx < 32:
                continue
            out.append((str(stat_id), idx, bit["name"], bit.get("display") or {}))
    return out


def _sort_key(name: str):
    digits = name.removeprefix("Achievement")
    return (0, int(digits), name) if digits.isdigit() else (1, 0, name)


def read_achievements(stats_path, schema_path) -> dict | None:
    """Combine schema + user cache into an achievement summary.

    Returns ``None`` (and logs a warning) if either file is missing or
    cannot be understood; never raises to the caller.
    """
    try:
        if not (os.path.isfile(stats_path) and os.path.isfile(schema_path)):
            log.warning("steamstats: cache files not found (%s, %s)", stats_path, schema_path)
            return None
        schema = parse_kv(_read_file(schema_path))
        user = parse_kv(_read_file(stats_path))

        bits = _achievement_bits(schema)
        if not bits:
            log.warning("steamstats: no achievements found in schema %s", schema_path)
            return None
        cache = user.get("cache")
        if not isinstance(cache, dict):
            log.warning("steamstats: no 'cache' section in %s", stats_path)
            return None

        achievements: dict[str, dict] = {}
        for stat_id, idx, name, display in bits:
            entry = cache.get(stat_id)
            entry = entry if isinstance(entry, dict) else {}
            raw = entry.get("data", 0)
            value = (raw if isinstance(raw, int) else 0) & 0xFFFFFFFF
            unlocked = bool(value >> idx & 1)
            times = entry.get("AchievementTimes")
            ts = times.get(str(idx)) if isinstance(times, dict) else None
            achievements[name] = {
                "unlocked": unlocked,
                "unlocked_at": _iso(ts) if unlocked else None,
                "name": _english(display, "name"),
            }

        achievements = dict(sorted(achievements.items(), key=lambda kv: _sort_key(kv[0])))
        total = len(achievements)
        if total != 100:
            log.warning("steamstats: expected 100 achievements, schema has %d", total)
        return {
            "source": "steam-local-cache",
            "count_total": total,
            "count_unlocked": sum(1 for a in achievements.values() if a["unlocked"]),
            "achievements": achievements,
        }
    except Exception as exc:  # never propagate to callers
        log.warning("steamstats: could not read achievements: %s", exc)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    if len(sys.argv) != 3:
        print("usage: python steamstats.py <UserGameStats_..._582010.bin> <UserGameStatsSchema_582010.bin>")
        sys.exit(2)
    result = read_achievements(sys.argv[1], sys.argv[2])
    if result is None:
        print("could not read achievements")
        sys.exit(1)
    print(f"source: {result['source']}")
    print(f"unlocked: {result['count_unlocked']}/{result['count_total']}")
    locked = [k for k, v in result["achievements"].items() if not v["unlocked"]]
    print(f"locked ({len(locked)}):")
    for k in locked:
        print(f"  {k}: {result['achievements'][k]['name']}")
    for k in ("Achievement0", "Achievement15"):
        if k in result["achievements"]:
            print(f"{k}: {result['achievements'][k]}")
