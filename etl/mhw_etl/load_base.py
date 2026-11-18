"""Load MHWorldData CSVs (+ mhw-db supplements) into the SQLite catalog."""
from collections import Counter

from . import config, translations as tr
from .util import Lookup, Misses, J, clean, key, read_csv, read_json, to_bool, to_int, to_num, utc_ts


# Tables with explicit, non-monotonic ids: their insertion order feeds search_index (see schema_sqlite.sql).
ORDERED_TABLES = {"items", "monsters", "armor", "weapons", "decorations", "charms", "quests", "locations"}


class Ctx:
    def __init__(self, cur):
        self.cur = cur
        self.misses = Misses()
        self.items = Lookup("item", self.misses)
        self.monsters = Lookup("monster", self.misses)
        self.locations = Lookup("location", self.misses)
        self.skills = Lookup("skill", self.misses)
        self.armor = Lookup("armor", self.misses)
        self.armor_sets = Lookup("armor_set", self.misses)
        self.bonuses = Lookup("set_bonus", self.misses)
        self.quests = Lookup("quest", self.misses)
        self.counts: Counter = Counter()
        self.order: list[tuple[str, int]] = []  # (table, id) in insertion order, for ORDERED_TABLES

    def insert(self, table: str, cols: list[str], rows: list[tuple]) -> None:
        if not rows:
            return
        col_sql = ", ".join(f'"{c}"' for c in cols)
        ph = ", ".join(["?"] * len(cols))
        self.cur.executemany(f"INSERT INTO {table} ({col_sql}) VALUES ({ph})", rows)
        self.counts[table] += len(rows)
        if table in ORDERED_TABLES:
            self.order.extend((table, r[0]) for r in rows)

    def insert_returning(self, table: str, cols: list[str], row: tuple) -> int:
        col_sql = ", ".join(f'"{c}"' for c in cols)
        ph = ", ".join(["?"] * len(cols))
        self.cur.execute(f"INSERT INTO {table} ({col_sql}) VALUES ({ph})", row)
        self.counts[table] += 1
        return self.cur.lastrowid


def _translations(rel: str, cols=("name_es",), key_col="name_en", key_fn=None) -> dict:
    out = {}
    for r in read_csv(rel):
        k = key_fn(r) if key_fn else key(r[key_col])
        out.setdefault(k, {c: clean(r.get(c)) for c in cols})
    return out


def _mhwdb(name: str):
    path = config.MHWDB_DIR / name
    return read_json(path) if path.exists() else []


# ------------------------------------------------------------------ sections

def load_locations(c: Ctx) -> None:
    zones = {key(l["name"]): l for l in _mhwdb("locations.json")}
    rows = []
    for r in read_csv("locations/location_base.csv"):
        name = r["name_en"]
        z = zones.get(key(name), {})
        rows.append((int(r["id"]), name, clean(r.get("name_es")), z.get("zoneCount"),
                     tr.LOCATION_KIND.get(name, "map"),
                     "iceborne" if name in tr.ICEBORNE_LOCATIONS else "base",
                     tr.external_map_url(name)))
        c.locations.add(name, int(r["id"]))
    c.insert("locations", ["id", "name_en", "name_es", "zone_count", "kind", "expansion", "external_map_url"], rows)

    camps, seen = [], set()
    for r in read_csv("locations/location_camps.csv"):
        lid = c.locations.get(r["base_name_en"], "camps")
        if lid:
            camps.append((lid, r["name_en"], to_int(r["area"]), "mhworlddata"))
            seen.add((lid, to_int(r["area"])))
    for l in zones.values():
        lid = c.locations.get(l["name"], "mhwdb camps")
        for cp in l.get("camps", []):
            if lid and (lid, cp["zone"]) not in seen:
                camps.append((lid, cp["name"], cp["zone"], "mhw-db"))
                seen.add((lid, cp["zone"]))
    c.insert("location_camps", ["location_id", "name_en", "area", "source"], camps)


def load_items(c: Ctx) -> None:
    t = _translations("items/item_base_translations.csv", ("name_es", "description_en", "description_es"))
    rows = []
    for r in read_csv("items/item_base.csv"):
        x = t.get(key(r["name_en"]), {})
        iid = int(r["id"])
        rows.append((iid, clean(r["name_en"]), x.get("name_es"), x.get("description_en"), x.get("description_es"),
                     r["category"] or None, r["subcategory"] or None, to_int(r["rarity"]), to_int(r["buy_price"]),
                     to_int(r["sell_price"]), to_int(r["carry_limit"]), to_int(r["points"]),
                     r["icon_name"] or None, r["icon_color"] or None))
        c.items.add(r["name_en"], iid)
    c.insert("items", ["id", "name_en", "name_es", "description_en", "description_es", "category", "subcategory",
                       "rarity", "buy_price", "sell_price", "carry_limit", "points", "icon_name", "icon_color"], rows)

    combos = []
    for r in read_csv("items/item_combination_list.csv"):
        res = c.items.get(r["result"], "combination result")
        if res:
            combos.append((int(r["id"]), res, c.items.get(r["first"], "combination"),
                           c.items.get(r["second"], "combination") if r["second"] else None, to_int(r["quantity"])))
    c.insert("item_combinations", ["id", "result_item_id", "first_item_id", "second_item_id", "quantity"], combos)

    gather = []
    for r in read_csv("locations/location_items.csv"):
        lid = c.locations.get(r["base_name_en"], "location_items")
        iid = c.items.get(r["item"], f"gathering {r['base_name_en']}")
        if lid and iid:
            gather.append((lid, to_int(r["area"]), r["rank"] or None, iid, to_int(r["stack"]),
                           to_num(r["percentage"]), to_int(r["nodes"])))
    c.insert("location_items", ["location_id", "area", "rank", "item_id", "stack", "percentage", "nodes"], gather)


def load_monsters(c: Ctx) -> None:
    t = _translations("monsters/monster_base_translations.csv", ("name_es", "description_en", "description_es"))
    rows = []
    for r in read_csv("monsters/monster_base.csv"):
        x = t.get(key(r["name_en"]), {})
        mid = int(r["id"])
        rows.append((mid, r["name_en"], x.get("name_es"), x.get("description_en"), x.get("description_es"),
                     r["ecology_en"] or None, r["size"], to_bool(r["pitfall_trap"]), to_bool(r["shock_trap"]),
                     to_bool(r["vine_trap"])))
        c.monsters.add(r["name_en"], mid)
    c.insert("monsters", ["id", "name_en", "name_es", "description_en", "description_es", "ecology_en", "size",
                          "pitfall_trap", "shock_trap", "vine_trap"], rows)

    elems = ["fire", "water", "thunder", "ice", "dragon", "poison", "sleep", "paralysis", "blast", "stun"]
    weak = []
    for r in read_csv("monsters/monster_weaknesses.csv"):
        mid = c.monsters.get(r["name_en"], "weaknesses")
        if mid:
            weak.append((mid, r["form"] or None, r["alt_description"] or None, *[to_int(r[e]) for e in elems]))
    c.insert("monster_weaknesses", ["monster_id", "form", "alt_description", *elems], weak)

    hz_cols = ["cut", "impact", "shot", "fire", "water", "thunder", "ice", "dragon", "ko"]
    hz = []
    for r in read_csv("monsters/monster_hitzones.csv"):
        mid = c.monsters.get(r["base_name_en"], "hitzones")
        if mid:
            hz.append((mid, r["hitzone_en"], *[to_int(r[k]) for k in hz_cols]))
    c.insert("monster_hitzones", ["monster_id", "hitzone_en", *hz_cols], hz)

    br = []
    for r in read_csv("monsters/monster_breaks.csv"):
        mid = c.monsters.get(r["base_name_en"], "breaks")
        if mid:
            br.append((mid, r["part_en"], to_int(r["flinch"]), to_int(r["wound"]), to_int(r["sever"]),
                       r["extract"] or None))
    c.insert("monster_breaks", ["monster_id", "part_en", "flinch", "wound", "sever", "extract"], br)

    ail = []
    for r in read_csv("monsters/monster_ailments.csv"):
        mid = c.monsters.get(r["base_name_en"], "ailments")
        data = {k: v for k, v in r.items() if k != "base_name_en" and v}
        if mid:
            ail.append((mid, J(data)))
    c.insert("monster_ailments", ["monster_id", "data"], ail)

    hab = []
    for r in read_csv("monsters/monster_habitats.csv"):
        mid = c.monsters.get(r["base_name_en"], "habitats")
        lid = c.locations.get(r["map_en"], "habitats")
        if mid and lid:
            hab.append((mid, lid, r["start_area"] or None, r["move_area"] or None, r["rest_area"] or None))
    c.insert("monster_habitats", ["monster_id", "location_id", "start_area", "move_area", "rest_area"], hab)

    cond_ids: dict[str, int] = {}
    names = [r["name_en"] for r in read_csv("monsters/reward_conditions_base.csv")]
    names += [r["condition_en"] for r in read_csv("monsters/monster_rewards.csv")]
    for n in dict.fromkeys(names):
        es, kind = tr.reward_condition(n)
        cond_ids[n] = c.insert_returning("reward_conditions", ["name_en", "name_es", "kind"], (n, es, kind))

    rw = []
    for r in read_csv("monsters/monster_rewards.csv"):
        mid = c.monsters.get(r["base_name_en"], "rewards")
        iid = c.items.get(r["item_en"], f"reward of {r['base_name_en']}")
        if mid and iid:
            rw.append((mid, r["rank"], cond_ids[r["condition_en"]], iid, to_int(r["stack"]), to_num(r["percentage"])))
    c.insert("monster_rewards", ["monster_id", "rank", "condition_id", "item_id", "stack", "percentage"], rw)


def load_skills(c: Ctx) -> None:
    t = _translations("skills/skill_base_translations.csv", ("name_es", "description_en", "description_es"))
    levels = read_csv("skills/skill_levels.csv")
    max_lv = Counter()
    for r in levels:
        max_lv[key(r["base_name_en"])] = max(max_lv[key(r["base_name_en"])], to_int(r["level"]) or 0)
    for r in read_csv("skills/skill_base.csv"):
        x = t.get(key(r["name_en"]), {})
        sid = c.insert_returning("skills", ["name_en", "name_es", "description_en", "description_es", "icon_color",
                                            "secret", "unlocks", "max_level"],
                                 (r["name_en"], x.get("name_es"), x.get("description_en"), x.get("description_es"),
                                  r["icon_color"] or None, to_int(r["secret"]), r["unlocks"] or None,
                                  max_lv.get(key(r["name_en"])) or None))
        c.skills.add(r["name_en"], sid)
    rows = []
    for r in levels:
        sid = c.skills.get(r["base_name_en"], "skill_levels")
        if sid:
            rows.append((sid, to_int(r["level"]), r["description_en"] or None, r["description_es"] or None))
    c.insert("skill_levels", ["skill_id", "level", "description_en", "description_es"], rows)


def load_armor(c: Ctx) -> None:
    bt = _translations("armors/armorset_bonus_base_translations.csv")
    for r in read_csv("armors/armorset_bonus_base.csv"):
        bid = c.insert_returning("armor_set_bonuses", ["name_en", "name_es"],
                                 (r["name_en"], bt.get(key(r["name_en"]), {}).get("name_es")))
        c.bonuses.add(r["name_en"], bid)
        for i in (1, 2):
            if r.get(f"skill{i}_name"):
                sid = c.skills.get(r[f"skill{i}_name"], f"set bonus {r['name_en']}")
                if sid:
                    c.insert("armor_set_bonus_ranks", ["bonus_id", "skill_id", "required"],
                             [(bid, sid, to_int(r[f"skill{i}_required"]))])

    st = _translations("armors/armorset_base_translations.csv")
    piece_set: dict[str, tuple[int, str]] = {}
    for r in read_csv("armors/armorset_base.csv"):
        mid = c.monsters.get(r["monster"], f"armor set {r['name_en']}") if r["monster"] else None
        bid = c.bonuses.get(r["bonus"], f"armor set {r['name_en']}") if r["bonus"] else None
        set_id = c.insert_returning("armor_sets", ["name_en", "name_es", "rank", "monster_id", "bonus_id"],
                                    (clean(r["name_en"]), st.get(key(r["name_en"]), {}).get("name_es"),
                                     r["rank"] or None, mid, bid))
        c.armor_sets.add(r["name_en"], set_id)
        for slot in ("head", "chest", "arms", "waist", "legs"):
            if r[slot]:
                piece_set.setdefault(key(r[slot]), (set_id, r["rank"]))

    images = {key(a["name"]): a.get("assets") or {} for a in _mhwdb("armor.json")}
    at = _translations("armors/armor_base_translations.csv")
    rows = []
    for r in read_csv("armors/armor_base.csv"):
        aid = int(r["id"])
        set_id, rank = piece_set.get(key(r["name_en"]), (None, None))
        img = images.get(key(r["name_en"]), {})
        rows.append((aid, clean(r["name_en"]), at.get(key(r["name_en"]), {}).get("name_es"), to_int(r["rarity"]),
                     r["type"], r["gender"], rank, set_id, to_int(r["slot_1"]), to_int(r["slot_2"]),
                     to_int(r["slot_3"]), to_int(r["defense_base"]), to_int(r["defense_max"]),
                     to_int(r["defense_augment_max"]), to_int(r["defense_fire"]), to_int(r["defense_water"]),
                     to_int(r["defense_thunder"]), to_int(r["defense_ice"]), to_int(r["defense_dragon"]),
                     img.get("imageMale"), img.get("imageFemale")))
        c.armor.add(r["name_en"], aid)
    c.insert("armor", ["id", "name_en", "name_es", "rarity", "type", "gender", "rank", "armor_set_id", "slot_1",
                       "slot_2", "slot_3", "defense_base", "defense_max", "defense_augment_max", "res_fire",
                       "res_water", "res_thunder", "res_ice", "res_dragon", "image_male", "image_female"], rows)

    skills = []
    for r in read_csv("armors/armor_skills_ext.csv"):
        aid = c.armor.get(r["base_name_en"], "armor_skills")
        for i in (1, 2):
            if aid and r.get(f"skill{i}_name"):
                sid = c.skills.get(r[f"skill{i}_name"], f"armor {r['base_name_en']}")
                if sid:
                    skills.append((aid, sid, to_int(r[f"skill{i}_level"])))
    c.insert("armor_skills", ["armor_id", "skill_id", "level"], skills)

    recipes = []
    for r in read_csv("armors/armor_craft_ext.csv"):
        aid = c.armor.get(r["base_name_en"], "armor_craft")
        for i in (1, 2, 3, 4):
            if aid and r.get(f"item{i}_name"):
                iid = c.items.get(r[f"item{i}_name"], f"armor {r['base_name_en']}")
                if iid:
                    recipes.append((aid, iid, to_int(r[f"item{i}_qty"])))
    c.insert("armor_recipes", ["armor_id", "item_id", "quantity"], recipes)


def load_weapons(c: Ctx) -> None:
    t = _translations("weapons/weapon_base_translations.csv",
                      key_fn=lambda r: (key(r["name_en"]), r["weapon_type"]))
    base = read_csv("weapons/weapon_base.csv")
    ids = {(key(r["name_en"]), r["weapon_type"]): int(r["id"]) for r in base}
    rows = []
    for r in base:
        k = (key(r["name_en"]), r["weapon_type"])
        prev = ids.get((key(r["previous_en"]), r["weapon_type"])) if r["previous_en"] else None
        if r["previous_en"] and prev is None:
            c.misses.add("weapon", r["previous_en"], f"previous of {r['name_en']}")
        rows.append((ids[k], clean(r["name_en"]), t.get(k, {}).get("name_es"), r["weapon_type"], prev,
                     r["category"] or None, to_int(r["rarity"]), to_int(r["attack"]), to_int(r["affinity"]),
                     to_int(r["defense"]), to_bool(r["element_hidden"]), r["element1"] or None,
                     to_int(r["element1_attack"]), r["element2"] or None, to_int(r["element2_attack"]),
                     r["elderseal"] or None, to_int(r["slot_1"]), to_int(r["slot_2"]), to_int(r["slot_3"]),
                     r["notes"] or None))
    c.insert("weapons", ["id", "name_en", "name_es", "weapon_type", "previous_id", "category", "rarity", "attack",
                         "affinity", "defense", "element_hidden", "element1", "element1_attack", "element2",
                         "element2_attack", "elderseal", "slot_1", "slot_2", "slot_3", "notes"], rows)

    recipes = []
    for r in read_csv("weapons/weapon_craft.csv"):
        wid = ids.get((key(r["base_name_en"]), r["weapon_type"]))
        if wid is None:
            c.misses.add("weapon", r["base_name_en"], "weapon_craft")
            continue
        for i in (1, 2, 3, 4):
            if r.get(f"item{i}_name"):
                iid = c.items.get(r[f"item{i}_name"], f"weapon {r['base_name_en']}")
                if iid:
                    recipes.append((wid, r["type"], iid, to_int(r[f"item{i}_qty"])))
    c.insert("weapon_recipes", ["weapon_id", "type", "item_id", "quantity"], recipes)


def load_decorations_charms(c: Ctx) -> None:
    t = _translations("decorations/decoration_base_translations.csv")
    rows, skills = [], []
    for r in read_csv("decorations/decoration_base.csv"):
        did = int(r["id"])
        rows.append((did, r["name_en"], t.get(key(r["name_en"]), {}).get("name_es"), to_int(r["slot"]),
                     to_int(r["rarity"]), r["icon_color"] or None))
        for i in (1, 2):
            if r.get(f"skill{i}_name"):
                sid = c.skills.get(r[f"skill{i}_name"], f"decoration {r['name_en']}")
                if sid:
                    skills.append((did, sid, to_int(r[f"skill{i}_level"])))
    c.insert("decorations", ["id", "name_en", "name_es", "slot", "rarity", "icon_color"], rows)
    c.insert("decoration_skills", ["decoration_id", "skill_id", "level"], skills)

    drops = []
    with open(config.MHWORLDDATA_DIR / "decorations/decoration_droprates.csv", encoding="utf-8") as f:
        header = f.readline().strip().split(",")
        for line in f:
            vals = line.strip().split(",")
            for rarity, v in zip(header[1:], vals[1:]):
                if v:
                    drops.append((vals[0], int(rarity), float(v)))
    c.insert("decoration_droprates", ["feystone", "rarity", "percentage"], drops)

    t = _translations("charms/charm_base_translations.csv")
    base = read_csv("charms/charm_base.csv")
    ids = {key(r["name_en"]): int(r["id"]) for r in base}
    rows, skills = [], []
    for r in base:
        cid = int(r["id"])
        rows.append((cid, r["name_en"], t.get(key(r["name_en"]), {}).get("name_es"),
                     ids.get(key(r["previous_en"])) if r["previous_en"] else None, to_int(r["rarity"])))
        for i in (1, 2):
            if r.get(f"skill{i}_name"):
                sid = c.skills.get(r[f"skill{i}_name"], f"charm {r['name_en']}")
                if sid:
                    skills.append((cid, sid, to_int(r[f"skill{i}_level"])))
    c.insert("charms", ["id", "name_en", "name_es", "previous_id", "rarity"], rows)
    c.insert("charm_skills", ["charm_id", "skill_id", "level"], skills)
    recipes = []
    for r in read_csv("charms/charm_craft.csv"):
        cid = ids.get(key(r["base_name_en"]))
        if cid is None:
            c.misses.add("charm", r["base_name_en"], "charm_craft")
            continue
        for i in (1, 2, 3, 4):
            if r.get(f"item{i}_name"):
                iid = c.items.get(r[f"item{i}_name"], f"charm {r['base_name_en']}")
                if iid:
                    recipes.append((cid, r["type"], iid, to_int(r[f"item{i}_qty"])))
    c.insert("charm_recipes", ["charm_id", "type", "item_id", "quantity"], recipes)


def load_quests(c: Ctx) -> None:
    t = {r["id"]: r for r in read_csv("quests/quest_base_translations.csv")}
    rows = []
    for r in read_csv("quests/quest_base.csv"):
        x = t.get(r["id"], {})
        qid = int(r["id"])
        rows.append((qid, r["name_en"], clean(x.get("name_es")), x.get("objective_en") or None,
                     x.get("objective_es") or None, x.get("description_en") or None, x.get("description_es") or None,
                     r["category"], r["rank"], to_int(r["stars"]), r["quest_type"],
                     c.locations.get(r["location_en"], f"quest {r['name_en']}"), to_int(r["zenny"])))
        c.quests.add(r["name_en"], qid)
    c.insert("quests", ["id", "name_en", "name_es", "objective_en", "objective_es", "description_en",
                        "description_es", "category", "rank", "stars", "quest_type", "location_id", "zenny"], rows)

    qm = []
    for r in read_csv("quests/quest_monsters.csv"):
        mid = c.monsters.get(r["monster_en"], f"quest {r['base_id']}")
        if mid:
            qm.append((int(r["base_id"]), mid, to_int(r["quantity"]), to_bool(r["is_objective"])))
    c.insert("quest_monsters", ["quest_id", "monster_id", "quantity", "is_objective"], qm)

    qr = []
    for r in read_csv("quests/quest_rewards.csv"):
        iid = c.items.get(r["item_en"], f"quest reward {r['base_id']}")
        if iid:
            qr.append((int(r["base_id"]), r["group"] or None, iid, to_int(r["stack"]), to_num(r["percentage"])))
    c.insert("quest_rewards", ["quest_id", "group", "item_id", "stack", "percentage"], qr)


def load_events(c: Ctx) -> None:
    rows = []
    for e in _mhwdb("events.json"):
        loc = (e.get("location") or {}).get("name")
        rows.append((e.get("id"), e["platform"], e.get("type"), e["name"], e.get("expansion"), e.get("questRank"),
                     e.get("masterRank"), e.get("requirements"), e.get("successConditions"), e.get("description"),
                     c.locations.get(loc, "events") if loc else None,
                     c.quests.map.get(key(e["name"])), utc_ts(e.get("startTimestamp")), utc_ts(e.get("endTimestamp"))))
    c.insert("events", ["external_id", "platform", "type", "name_en", "expansion", "quest_rank", "master_rank",
                        "requirements", "success_conditions", "description_en", "location_id", "quest_id",
                        "start_at", "end_at"], rows)


def load_base(cur) -> Ctx:
    c = Ctx(cur)
    load_locations(c)
    load_items(c)
    load_monsters(c)
    load_skills(c)
    load_armor(c)
    load_weapons(c)
    load_decorations_charms(c)
    load_quests(c)
    load_events(c)
    return c
