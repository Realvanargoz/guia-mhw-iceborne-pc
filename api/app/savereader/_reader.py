"""Port of tools/savereader (Program.cs, SlotReader.cs, SlotExtras.cs, MonsterTable.cs, EquipmentTable.cs and the
MHWSaveUtils readers it uses). Produces the same structure, key order and values as ``mhw-savereader <file> --json``.

Read-only: the file is opened with ``open(path, "rb")``, its size is checked before anything is read, exactly that
many bytes are read and the decryption happens in memory.
"""
from __future__ import annotations

import json
import os
import struct
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

FORMAT_VERSION = 1
MINIMUM_LENGTH = 0x714658 + 0x2098C0 + 0x200  # last byte touched by the Iceborne layer
MAXIMUM_LENGTH = 32 * 1024 * 1024  # the C# reader allows 64 MiB; the app never accepts uploads above 32 MiB

SECTION3_SIGNATURE = 0xAD35B985
SLOT_SIZE = 2_136_768
COMPLETED_QUESTS = 2_008_323
ACHIEVEMENTS_OBTAINED = 2_008_287
MAX_MONSTER_COUNT = 96

H_APPEARANCE = 168
P_APPEARANCE = 44
WEAPON_USAGE_SIZE = 14 * 2
GUILD_CARD_SIZE = (171 + H_APPEARANCE + 212 + 64 + 4 + 194 + WEAPON_USAGE_SIZE * 5 + 1 + 1 + 1 + 1 + 256 + 256 + 5454
                   + MAX_MONSTER_COUNT * 2 * 4 + MAX_MONSTER_COUNT)
U32_MAX = 0xFFFFFFFF

DATA = Path(__file__).resolve().parent / "data"


class SaveReadError(Exception):
    """Raised for every unreadable input. ``kind`` matches the C# reader's error JSON:
    not_found, truncated, bad_format, io_error or error."""

    def __init__(self, kind: str, message: str = ""):
        super().__init__(message or kind)
        self.kind = kind
        self.message = message or kind


# ---------------------------------------------------------------- tables (embedded resources / MonsterTable.cs)

@lru_cache(maxsize=None)
def _load(name: str):
    with open(DATA / name, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


@lru_cache(maxsize=None)
def _jewels():
    """(item_id -> (name_en, name_es), equipment_id -> item_id)."""
    by_item: dict[int, tuple[str, str | None]] = {}
    by_equip: dict[int, int] = {}
    for e in _load("jewels.json"):
        by_equip[e["equipment_id"]] = e["item_id"]
        by_item[e["item_id"]] = (e["name_en"] or "", e.get("name_es"))
    return by_item, by_equip


ARMOR_TYPES = ("head", "chest", "arms", "waist", "legs")
WEAPON_TYPES = ("great_sword", "sword_and_shield", "dual_blades", "long_sword", "hammer", "hunting_horn", "lance",
                "gunlance", "switch_axe", "charge_blade", "insect_glaive", "bow", "heavy_bowgun", "light_bowgun")


def _entry(r):
    return (r[1], r[2] if r[2] is not None else "", r[3] if isinstance(r[3], str) else None)


@lru_cache(maxsize=None)
def _equipment():
    doc = _load("equipment.json")
    armor, weapons, charms = {}, {}, {}
    for table, key, types in ((armor, "armor", ARMOR_TYPES), (weapons, "weapons", WEAPON_TYPES)):
        for ti, t in enumerate(types):
            for r in doc[key][t]:
                table[(ti, r[0])] = _entry(r)
    for r in doc["charms"]:
        charms[(0, r[0])] = _entry(r)
    return doc["source"] or "", armor, weapons, charms


@lru_cache(maxsize=None)
def _monsters128() -> dict[int, str]:
    return {e[0]: e[1] or "" for e in _load("monsters128.json")["monsters"]}


@lru_cache(maxsize=None)
def _quest_order() -> tuple[int, ...]:
    return tuple(_load("quest_order.json")["ids"])


# name, mini, silver, gold
STANDARD = ("standard", 90, 115, 123)
ALTERNATE = ("alternate", 90, 110, 120)
SAVAGE = ("savage", 99, 114, 120)
RAJANG = ("rajang", 90, 111, 118)

MONSTERS: dict[int, tuple[str, float, tuple | None]] = {
    0: ("Great Jagras", 1109.66, STANDARD), 1: ("Kulu-Ya-Ku", 901.24, STANDARD),
    2: ("Pukei-Pukei", 1102.45, ALTERNATE), 3: ("Barroth", 1383.07, STANDARD),
    4: ("Jyuratodus", 1508.71, STANDARD), 5: ("Tobi-Kadachi", 1300.52, ALTERNATE),
    6: ("Anjanath", 1646.46, ALTERNATE), 7: ("Rathian", 1754.37, STANDARD),
    8: ("Tzitzi-Ya-Ku", 894.04, STANDARD), 9: ("Paolumu", 1143.36, STANDARD),
    10: ("Great Girros", 1053.15, STANDARD), 11: ("Radobaan", 1803.47, ALTERNATE),
    12: ("Legiana", 1699.75, STANDARD), 13: ("Odogaron", 1388.75, STANDARD),
    14: ("Rathalos", 1704.22, STANDARD), 15: ("Diablos", 2096.25, STANDARD),
    16: ("Kirin", 536.26, STANDARD), 17: ("Zorah Magdaros", 25764.59, None),
    18: ("Dodogama", 1111.11, STANDARD), 19: ("Pink Rathian", 1754.37, STANDARD),
    20: ("Bazelgeuse", 1928.38, STANDARD), 21: ("Lavasioth", 1797.24, STANDARD),
    22: ("Uragaan", 2058.63, ALTERNATE), 23: ("Azure Rathalos", 1704.22, STANDARD),
    24: ("Black Diablos", 2096.25, STANDARD), 25: ("Nergigante", 1848.12, STANDARD),
    26: ("Teostra", 1790.15, STANDARD), 27: ("Kushala Daora", 1913.13, STANDARD),
    28: ("Vaal Hazak", 2095.40, STANDARD), 29: ("Xeno'jiiva", 4509.10, None),
    30: ("Deviljho", 2063.82, ALTERNATE), 31: ("Kulve Taroth", 4573.25, None),
    32: ("Lunastra", 1828.69, STANDARD), 33: ("Behemoth", 3423.65, None),
    34: ("Leshen", 549.70, None), 35: ("Ancient Leshen", 633.81, None),
    36: ("Beotodus", 1661.99, STANDARD), 37: ("Banbaro", 2404.84, STANDARD),
    38: ("Viper Tobi-Kadachi", 1300.52, ALTERNATE), 39: ("Nightshade Paolumu", 1143.36, STANDARD),
    40: ("Coral Pukei-Pukei", 1102.45, ALTERNATE), 41: ("Barioth", 2098.30, STANDARD),
    42: ("Nargacuga", 1914.74, STANDARD), 43: ("Glavenus", 2461.50, ALTERNATE),
    44: ("Tigrex", 1943.20, STANDARD), 45: ("Brachydios", 1630.55, STANDARD),
    46: ("Acidic Glavenus", 2372.44, ALTERNATE), 47: ("Shrieking Legiana", 1831.69, STANDARD),
    48: ("Fulgur Anjanath", 1646.46, ALTERNATE), 49: ("Ebony Odogaron", 1388.75, STANDARD),
    50: ("Velkhana", 2596.05, STANDARD), 51: ("Seething Bazelgeuse", 1928.38, STANDARD),
    52: ("Blackveil Vaal Hazak", 2095.40, STANDARD), 53: ("Namielle", 2048.25, STANDARD),
    54: ("Savage Deviljho", 2063.82, SAVAGE), 55: ("Ruiner Nergigante", 1848.12, STANDARD),
    56: ("Shara Ishvalda", 2910.91, None), 57: ("Zinogre", 1743.49, STANDARD),
    58: ("Yian Garuga", 1389.01, STANDARD), 59: ("Scarred Yian Garuga", 1389.01, STANDARD),
    60: ("Brute Tigrex", 1943.20, STANDARD), 61: ("Gold Rathian", 1754.37, STANDARD),
    62: ("Silver Rathalos", 1704.22, STANDARD), 63: ("Rajang", 829.11, RAJANG),
    64: ("Stygian Zinogre", 1743.49, STANDARD), 65: ("Safi'jiiva", 4799.78, STANDARD),
    66: ("Furious Rajang", 829.11, RAJANG), 67: ("Raging Brachydios", 2282.77, None),
    68: ("Frostfang Barioth", 2098.30, None), 69: ("Alatreon", 2969.63, None),
    70: ("Fatalis", 4137.17, None),
}

WEAPON_USAGE_KEYS = ("great_sword", "long_sword", "sword_and_shield", "dual_blades", "hammer", "hunting_horn", "lance",
                     "gunlance", "switch_axe", "charge_blade", "insect_glaive", "light_bowgun", "heavy_bowgun", "bow")
GADGETS = ("vigorwasp_spray", "flashfly_cage", "shieldspire", "coral_orchestra", "plunderblade", "meowlotov_cocktail")
LOADOUT_SLOTS = ("weapon", "head", "chest", "arms", "waist", "legs", "charm")


# ---------------------------------------------------------------- helpers

def _num(x: float):
    """Utf8JsonWriter prints integral doubles without a decimal part, so json.loads of the C# output yields an int."""
    return int(x) if x.is_integer() else x


def _round2(x: float) -> float:
    """.NET Math.Round(double, 2): scale by 100, round half to even on the double, scale back."""
    return round(x * 100.0) / 100.0


def _utf8(b: bytes) -> str:
    return b.decode("utf-8", "replace")


class _Reader:
    """BinaryReader over a MemoryStream: seeking anywhere is allowed, reading past the end raises 'truncated'."""

    __slots__ = ("d", "n", "pos")

    def __init__(self, d: bytes):
        self.d = d
        self.n = len(d)
        self.pos = 0

    def seek(self, pos: int) -> None:
        if pos < 0 or pos > 0x7FFFFFFF:
            raise SaveReadError("error", "Stream position out of range")
        self.pos = pos

    def skip(self, n: int) -> None:
        if self.pos + n < 0:
            raise SaveReadError("io_error", "An attempt was made to move the position before the beginning of the stream")
        self.pos += n

    def _take(self, fmt: str, size: int):
        if self.pos + size > self.n:
            raise SaveReadError("truncated", "Unable to read beyond the end of the stream")
        v = struct.unpack_from(fmt, self.d, self.pos)
        self.pos += size
        return v

    def u16s(self, count: int) -> tuple[int, ...]:
        return self._take(f"<{count}H", 2 * count)

    def u32(self) -> int:
        return self._take("<I", 4)[0]

    def u32s(self, count: int) -> tuple[int, ...]:
        return self._take(f"<{count}I", 4 * count)

    def i64(self) -> int:
        return self._take("<q", 8)[0]

    def read_bytes(self, count: int) -> bytes:
        """BinaryReader.ReadBytes: returns fewer bytes at the end of the stream instead of failing."""
        if self.pos >= self.n:
            return b""
        b = self.d[self.pos:self.pos + count]
        self.pos += len(b)
        return b


def _inc(d: dict, k, n: int = 1) -> None:
    d[k] = (d.get(k, 0) + n) & U32_MAX


# ---------------------------------------------------------------- SlotReader.cs

def _read_slots(data: bytes) -> list[dict]:
    r = _Reader(data)
    length = r.n
    _, jewel_by_equip = _jewels()

    # SaveDataReaderBase.GotoSection3PastSignature
    r.seek(64 + 8 * 3)
    section3 = r.i64()
    if section3 < 0 or section3 >= length:
        raise SaveReadError("bad_format", f"Invalid section 3 offset ({section3})")
    r.seek(section3)
    sig = r.u32()
    if sig != SECTION3_SIGNATURE:
        raise SaveReadError("bad_format", f"Invalid section 3 signature, expected {SECTION3_SIGNATURE:08X} but read {sig:08X}")
    r.skip(4)
    section_size = r.i64()
    first = r.pos
    if section_size < 3 * SLOT_SIZE or section_size > length:
        raise SaveReadError("bad_format", f"Invalid section 3 size ({section_size})")
    if first + section_size > length:
        raise SaveReadError("truncated", f"Save is truncated: section 3 ends at {first + section_size} but the file has "
                                         f"{length} bytes")
    if first + 3 * SLOT_SIZE > length:
        raise SaveReadError("truncated", f"Save is too short for 3 slots (need {first + 3 * SLOT_SIZE} bytes, have {length})")

    slots = []
    for i in range(3):
        slot = _read_slot(r, i + 1, first + i * SLOT_SIZE, jewel_by_equip)
        if slot is not None:
            slots.append(slot)
    return slots


def _read_slot(r: _Reader, number: int, start: int, jewel_by_equip: dict[int, int]) -> dict | None:
    r.seek(start)
    r.skip(4)
    # ReadUntilPlaytimeIncluded
    name = _utf8(r.read_bytes(64)).rstrip("\0")
    hr, mr, zeni, rp = r.u32s(4)
    r.skip(8)
    playtime = r.u32()
    if playtime == 0:
        return None
    s = {"slot": number, "name": name, "hr": hr, "mr": mr, "zenny": zeni, "research_points": rp,
         "playtime_seconds": playtime, "start": start}

    guild_card = start + 96 + H_APPEARANCE + 382 + P_APPEARANCE
    weapon_usage = guild_card + 171 + H_APPEARANCE + 212 + 64 + 4 + 194

    r.seek(start + COMPLETED_QUESTS)
    c = r.u32s(10)
    s["quest_counts"] = [min(v, 0xFFFF) for v in (c[6], c[5], c[0], c[1], c[8], c[9])]

    r.seek(start + ACHIEVEMENTS_OBTAINED)
    s["achievements"] = r.read_bytes(16)

    r.seek(weapon_usage)
    s["low_rank"] = r.u16s(14)
    s["high_rank"] = r.u16s(14)
    s["investigations"] = r.u16s(14)
    s["master_rank"] = r.u16s(14)
    s["guiding_lands"] = r.u16s(14)

    r.seek(weapon_usage + WEAPON_USAGE_SIZE * 5 + 4 + 512 + 5454)
    s["captured"] = r.u16s(MAX_MONSTER_COUNT)
    s["slayed"] = r.u16s(MAX_MONSTER_COUNT)
    s["largest"] = r.u16s(MAX_MONSTER_COUNT)
    s["smallest"] = r.u16s(MAX_MONSTER_COUNT)
    s["research_level"] = r.read_bytes(MAX_MONSTER_COUNT)

    _read_decorations(r, s, start, jewel_by_equip)
    return s


def _read_decorations(r: _Reader, s: dict, start: int, jewel_by_equip: dict[int, int]) -> None:
    decorations: dict[int, int] = {}
    unknown: dict[int, int] = {}
    armor: dict[tuple[int, int], int] = {}
    weapons: dict[tuple[int, int], int] = {}
    charms: dict[tuple[int, int], int] = {}

    def add_slotted(eid: int) -> None:
        if eid == U32_MAX:
            return
        item = jewel_by_equip.get(eid)
        if item is not None:
            _inc(decorations, item)
        else:
            _inc(unknown, eid)

    pos = (start + 96 + H_APPEARANCE + 382 + P_APPEARANCE + GUILD_CARD_SIZE * 101 + 209_447 + 142_200
           + (24 * 8 + 16 * 8 + 256 + 7 * 8) + (200 * 8 + 200 * 8 + 1250 * 8))
    r.seek(pos)

    box = r.u32s(1000)  # decorations box: 500 x (item id, quantity)
    for i in range(0, 1000, 2):
        item, qty = box[i], box[i + 1]
        if item > 0 and qty > 0:
            _inc(decorations, item, qty)

    for _ in range(2500):  # equipment box, 126 bytes each
        r.skip(4)  # sort index
        etype, sub, cls, _lvl, _pts, d1, d2, d3 = r.u32s(8)
        if etype in (0, 1):  # armor / weapon
            add_slotted(d1)
            add_slotted(d2)
            add_slotted(d3)
            if etype == 0 and sub <= 4:
                _inc(armor, (sub, cls))
            elif etype == 1 and sub <= 13:
                _inc(weapons, (sub, cls))
        elif etype == 2:  # charm
            _inc(charms, (0, cls))
        r.skip(90)

    r.skip(0x4AD29)  # until specialized tools
    for _ in range(128):  # specialized tools, 126 bytes each
        r.skip(4)
        available = r.u32()
        if available == 0:
            r.skip(118)
            continue
        r.skip(4)
        d1, d2, d3 = r.u32s(3)
        add_slotted(d1)
        add_slotted(d2)
        add_slotted(d3)
        r.skip(102)
    r.skip(0x539EF)

    if r.pos != start + SLOT_SIZE:
        raise SaveReadError("bad_format", f"Slot layout mismatch: ended at {r.pos}, expected {start + SLOT_SIZE}")
    s.update(decorations=decorations, unknown_slotted=unknown, armor=armor, weapons=weapons, charms=charms)


# ---------------------------------------------------------------- Program.Write

def _usage(u) -> dict:
    return dict(zip(WEAPON_USAGE_KEYS, u))


def _size(pct: int, base: float):
    return None if pct == 0 else _num(_round2(base * pct / 100.0))


def _write_slot(s: dict, data: bytes) -> dict:
    jewels_by_item, jewel_by_equip = _jewels()
    o: dict = {"slot": s["slot"], "name": s["name"], "hr": s["hr"], "mr": s["mr"], "zenny": s["zenny"],
               "research_points": s["research_points"], "playtime_seconds": s["playtime_seconds"]}

    monsters = []
    cap, sla, lar, sma, res = s["captured"], s["slayed"], s["largest"], s["smallest"], s["research_level"]
    for i in range(MAX_MONSTER_COUNT):
        info = MONSTERS.get(i)
        rl = res[i]
        anyv = cap[i] != 0 or sla[i] != 0 or lar[i] != 0 or sma[i] != 0 or rl != 0
        if info is None and not anyv:
            continue
        m: dict = {"index": i, "name_en": info[0] if info else None, "hunted": sla[i] + cap[i], "slayed": sla[i],
                   "captured": cap[i], "largest_pct": lar[i] or None, "smallest_pct": sma[i] or None,
                   "research_level": rl}
        if info is not None:
            base = info[1]
            m["base_size"] = _num(base)
            m["largest_size"] = _size(lar[i], base)
            m["smallest_size"] = _size(sma[i], base)
        else:
            m["base_size"] = None
        crown = info[2] if info else None
        if crown is not None:
            name, mini, silver, gold_t = crown
            gold = lar[i] != 0 and lar[i] >= gold_t
            m["crown"] = {"preset": name, "mini": sma[i] != 0 and sma[i] <= mini,
                          "silver": gold or (lar[i] != 0 and lar[i] >= silver), "gold": gold}
        else:
            m["crown"] = None
        monsters.append(m)
    o["monsters"] = monsters

    parts = [s["low_rank"], s["high_rank"], s["master_rank"], s["investigations"], s["guiding_lands"]]
    total = tuple(sum(p[k] for p in parts) & 0xFFFF for k in range(14))  # WeaponUsage operator+ wraps to ushort
    o["weapon_usage"] = {"low_rank": _usage(parts[0]), "high_rank": _usage(parts[1]), "master_rank": _usage(parts[2]),
                         "investigations": _usage(parts[3]), "guiding_lands": _usage(parts[4]), "total": _usage(total)}

    decos = []
    for item in sorted(s["decorations"]):
        j = jewels_by_item.get(item)
        decos.append({"item_id": item, "name_en": j[0] if j else None, "name_es": j[1] if j else None,
                      "count": s["decorations"][item]})
    o["decorations"] = decos
    if s["unknown_slotted"]:
        o["unknown_slotted_jewels"] = {str(k): s["unknown_slotted"][k] for k in sorted(s["unknown_slotted"])}

    q = s["quest_counts"]
    o["quest_counts"] = {"low_rank": q[0], "high_rank": q[1], "investigations": q[2], "arena": q[3],
                         "master_rank": q[4], "guiding_lands": q[5]}
    ach = s["achievements"]
    o["achievements_unlocked"] = [b for b in range(len(ach) * 8) if ach[b // 8] >> (b % 8) & 1]

    source, t_armor, t_weapons, t_charms = _equipment()
    o["equipment"] = {
        "semantics": "pieces currently in the equipment box (sold or melted pieces are not listed)",
        "names_source": source,
        "armor": _equip_list(s["armor"], t_armor, ARMOR_TYPES),
        "weapons": _equip_list(s["weapons"], t_weapons, WEAPON_TYPES),
        "charms": _equip_list(s["charms"], t_charms, ("charm",)),
    }
    _write_extras(o, data, s["start"], jewel_by_equip)
    return o


def _equip_list(owned: dict, table: dict, types) -> list:
    out = []
    for key in sorted(owned):
        e = table.get(key)
        out.append({"type": types[key[0]], "id": key[1], "name_en": e[1] if e else None, "name_es": e[2] if e else None,
                    "rarity": (e[0] if e[0] > 0 else None) if e else None, "count": owned[key]})
    return out


# ---------------------------------------------------------------- SlotExtras.cs

HUNTER, GUILD_CARD = 4, 690
CURRENT_EQUIPMENT = 943637
MONSTERS_CAPTURED_128, MONSTERS_SLAIN_128 = 944149, 944661
EQUIPMENT_BOX = 1156656
PALICO_NAME, PALICO_XP, PALICO_GADGETS = 1757139, 1757203, 1757207
QUESTS_CLEARED = 1757671
INVESTIGATIONS = 1758687
EQUIPMENT_LOADOUTS = 1796437
GUIDING_LANDS = 2123887
EQUIPMENT_SIZE, LOADOUT_SIZE, INVESTIGATION_SIZE = 126, 676, 42


class _Bytes:
    """BitConverter-style random access; out-of-range reads raise like the C# (ArgumentOutOfRangeException)."""

    __slots__ = ("d", "n")

    def __init__(self, d: bytes):
        self.d = d
        self.n = len(d)

    def _chk(self, o: int, size: int) -> None:
        if o < 0 or o + size > self.n:
            raise SaveReadError("error", "Index was out of range")

    def u8(self, o: int) -> int:
        self._chk(o, 1)
        return self.d[o]

    def u32(self, o: int) -> int:
        self._chk(o, 4)
        return struct.unpack_from("<I", self.d, o)[0]

    def i32(self, o: int) -> int:
        self._chk(o, 4)
        return struct.unpack_from("<i", self.d, o)[0]

    def u64(self, o: int) -> int:
        self._chk(o, 8)
        return struct.unpack_from("<Q", self.d, o)[0]

    def str(self, o: int, length: int) -> str:
        self._chk(o, length)
        end = self.d.find(b"\0", o, o + length)
        return _utf8(self.d[o:o + length if end < 0 else end])


def _write_extras(o: dict, data: bytes, s: int, jewels: dict[int, int]) -> None:
    d = _Bytes(data)

    h = s + HUNTER
    o["hunter"] = {"name": d.str(h, 64), "hr": d.u32(h + 64), "mr": d.u32(h + 68), "zenny": d.u32(h + 72),
                   "research_points": d.u32(h + 76), "hr_xp": d.u32(h + 80), "mr_xp": d.u32(h + 84),
                   "playtime_seconds": d.u32(h + 88)}

    g = s + GUILD_CARD
    created = d.u64(g + 8)
    created_at = None
    if 0 < created < 4102444800:
        created_at = datetime.fromtimestamp(created, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    o["guild_card"] = {"created_at": created_at, "squad": d.str(g + 101, 54), "title": d.str(g + 1213, 256),
                       "greeting": d.str(g + 957, 256)}

    o["palico"] = {"name": d.str(s + PALICO_NAME, 64), "xp": d.u32(s + PALICO_XP),
                   "gadget_xp": {k: d.u32(s + PALICO_GADGETS + 4 * i) for i, k in enumerate(GADGETS)}}

    gl = s + GUIDING_LANDS
    regions, max_level = [], 0
    for i in range(6):
        level = d.u8(gl + 216 + i)
        max_level = max(max_level, level)
        regions.append({"index": i, "level": level, "points": d.u32(gl + 4 + 4 * i)})
    o["guiding_lands"] = {"note": "regions by in-save index; level = region_level_unlocked, points = region_levels",
                          "regions": regions, "max_level": max_level}

    names = _monsters128()
    by_monster: dict[int, int] = {}
    count = tempered = 0
    for i in range(400):
        io = s + INVESTIGATIONS + INVESTIGATION_SIZE * i
        if d.u32(io) != 30000 or d.i32(io + 15) < 0:
            continue
        count += 1
        any_t = False
        for m in range(3):
            mon = d.i32(io + 15 + 4 * m)
            if mon >= 0:
                by_monster[mon] = by_monster.get(mon, 0) + 1
            if d.u8(io + 27 + m) != 0:
                any_t = True
        if any_t:
            tempered += 1
    o["investigations"] = {
        "count": count, "with_tempered": tempered,
        "by_monster": [{"index": k, "name_en": names.get(k), "count": v}
                       for k, v in sorted(by_monster.items(), key=lambda kv: (-kv[1], kv[0]))],
    }

    log = []
    for k in sorted(names):
        cap, slain = d.u32(s + MONSTERS_CAPTURED_128 + 4 * k), d.u32(s + MONSTERS_SLAIN_128 + 4 * k)
        if cap == 0 and slain == 0:
            continue
        log.append({"index": k, "name_en": names[k], "captured": cap, "slain": slain})
    o["monster_log"] = log

    order = _quest_order()
    cleared = [order[i] for i in range(min(len(order), 512))
               if d.u8(s + QUESTS_CLEARED + i // 8) >> (i % 8) & 1]
    o["quests"] = {"semantics": "bit i of the slot's cleared-quest bitfield = i-th id of the game's questNoList (352 ids)",
                   "cleared": cleared, "cleared_count": len(cleared), "list_size": len(order)}

    source, t_armor, t_weapons, t_charms = _equipment()

    def box_ref(index: int):
        if index < 0 or index >= 2500:
            return None
        bo = s + EQUIPMENT_BOX + EQUIPMENT_SIZE * index
        cat, typ, eid = d.i32(bo + 4), d.u32(bo + 8), d.u32(bo + 12)
        if cat < 0:
            return None
        table = type_name = None
        if cat == 0:
            name = "armor"
            if typ < len(ARMOR_TYPES):
                table, type_name = t_armor, ARMOR_TYPES[typ]
        elif cat == 1:
            name = "weapon"
            if typ < len(WEAPON_TYPES):
                table, type_name = t_weapons, WEAPON_TYPES[typ]
        elif cat == 2:
            name, table, type_name, typ = "charm", t_charms, "charm", 0
        elif cat == 4:
            name = "kinsect"
        else:
            name = "other"
        e = table.get((typ, eid)) if table is not None else None
        return {"box_index": index, "category": name, "type": type_name, "id": eid,
                "name_en": e[1] if e else None, "name_es": e[2] if e else None}

    current = {k: box_ref(d.i32(s + CURRENT_EQUIPMENT + 4 * i)) for i, k in enumerate(LOADOUT_SLOTS)}
    loadouts = []
    for k in range(224):
        lo = s + EQUIPMENT_LOADOUTS + LOADOUT_SIZE * k
        name = d.str(lo + 4, 256)
        if not name:
            continue
        entry: dict = {"slot": d.u32(lo), "name": name}
        for i, slot_name in enumerate(LOADOUT_SLOTS):
            entry[slot_name] = box_ref(d.i32(lo + 260 + 4 * i))
        entry["tools"] = [v for v in (d.i32(lo + 288), d.i32(lo + 292)) if v >= 0]
        decos = []
        for p in range(9):
            for q in range(3):
                e = d.u32(lo + 296 + 12 * p + 4 * q)
                if e != U32_MAX and e in jewels:
                    decos.append(jewels[e])
        entry["decorations"] = decos
        loadouts.append(entry)
    o["gear"] = {"current": current, "loadouts": loadouts}


# ---------------------------------------------------------------- Program.LoadAndDecrypt / Main

def load_and_decrypt(path: str | os.PathLike) -> bytes:
    """Read the file (read-only, at most its own size, never above 32 MiB) and return the decrypted bytes.

    This is exactly what ``mhw-savereader <file> --dump <out>`` writes."""
    try:
        with open(path, "rb") as f:
            size = os.fstat(f.fileno()).st_size
            if size > MAXIMUM_LENGTH:
                raise SaveReadError("bad_format", f"File is too large to be a save ({size} bytes)")
            if size < MINIMUM_LENGTH:
                raise SaveReadError("truncated", f"File is truncated ({size} bytes, need at least {MINIMUM_LENGTH})")
            if size % 8 != 0:
                raise SaveReadError("truncated", f"File length {size} is not a multiple of 8 (incomplete copy?)")
            raw = f.read(size)
    except SaveReadError:
        raise
    except FileNotFoundError as e:
        raise SaveReadError("not_found", f"Could not find file: {e.strerror}") from None
    except (PermissionError, IsADirectoryError) as e:
        raise SaveReadError("io_error", f"Access denied: {e.strerror}") from None
    except OSError as e:
        raise SaveReadError("io_error", e.strerror or "I/O error") from None
    if len(raw) != size:  # file shrank while reading (ReadExactly -> EndOfStreamException)
        raise SaveReadError("truncated", "Unable to read beyond the end of the stream")

    from ._crypto import decrypt  # imported lazily so table loading does not require pycryptodome
    return decrypt(raw)


def read_save(path: str | os.PathLike) -> dict:
    """Parse a SAVEDATA1000 copy. Returns what ``mhw-savereader <path> --json`` prints, as json.loads would give it.

    Raises :class:`SaveReadError` (``kind`` in not_found / truncated / bad_format / io_error / error) for bad input."""
    data = load_and_decrypt(path)
    try:
        slots = [_write_slot(s, data) for s in _read_slots(data)]
    except SaveReadError:
        raise
    except (IndexError, ValueError, OverflowError, struct.error) as e:  # defensive: same "error" kind as the C# catch-all
        raise SaveReadError("error", type(e).__name__) from None
    return {
        "format": FORMAT_VERSION,
        "signature_ok": True,
        "hunted_semantics": "hunted = slayed + captured (in-game 'Hunted (Captured)'); slayed is reported separately",
        "slots": slots,
    }
