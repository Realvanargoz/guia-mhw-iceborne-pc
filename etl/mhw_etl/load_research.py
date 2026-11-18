"""Load research seeds (research/<topic>/*.json) produced from Gemini Notebook research.

Each file: {"topic": str, "notebook": str?, "retrieved_at": str?, "entries": [...]}.
Files are validated against research/schemas/<topic>.schema.json before loading.
"""
import jsonschema

from . import config
from .load_base import Ctx
from .util import J, clean, key, norm_lower, read_json

TOPIC_TABLES = {"layered_armor", "achievements", "guides", "habitats", "gathering", "translations",
                "camps", "quest_availability", "festivals", "canteen", "loot", "gathering_rules", "videos"}
# Topics whose `entries` is an object of named lists (not a flat list).
DICT_TOPICS = {"canteen", "loot", "gathering_rules"}

TRANSLATABLE = {
    "item": ("items", "name_en"), "monster": ("monsters", "name_en"), "location": ("locations", "name_en"),
    "armor": ("armor", "name_en"), "armor_set": ("armor_sets", "name_en"), "weapon": ("weapons", "name_en"),
    "skill": ("skills", "name_en"), "decoration": ("decorations", "name_en"), "charm": ("charms", "name_en"),
    "quest": ("quests", "name_en"), "set_bonus": ("armor_set_bonuses", "name_en"),
}


def _files():
    root = config.RESEARCH_DIR
    if not root.exists():
        return []
    # `schemas` holds the JSON schemas; `builds` (solo-build rules read by the API) and `icons` (icon tables
    # written by mhw_etl.icons) are not seeds, so the loader must not try to validate them.
    skip = {"schemas", "builds", "icons", "save_format", "melder"}
    return sorted(p for p in root.glob("*/*.json") if p.parent.name not in skip)


def _schemas() -> dict:
    out = {}
    for p in (config.RESEARCH_DIR / "schemas").glob("*.schema.json"):
        out[p.name.removesuffix(".schema.json")] = read_json(p)
    return out


def _resolve(c: Ctx, ref_type: str, name: str | None, context: str):
    lk = {"item": c.items, "monster": c.monsters, "quest": c.quests, "armor": c.armor,
          "armor_set": c.armor_sets, "location": c.locations, "skill": c.skills}.get(ref_type)
    return lk.get(name, context) if lk and name else None


def _related(c: Ctx, related: list, context: str) -> list:
    out = []
    for r in related or []:
        out.append({**r, "id": _resolve(c, r.get("type"), r.get("name_en"), context)})
    return out


def load_research(c: Ctx) -> dict:
    schemas = _schemas()
    loaded: dict[str, int] = {}
    errors: list[str] = []
    entries_by_topic: dict = {}
    videos_retrieved = None

    for path in _files():
        doc = read_json(path)
        topic = doc.get("topic")
        if topic not in TOPIC_TABLES:
            errors.append(f"{path.name}: unknown topic {topic!r}")
            continue
        schema = schemas.get(topic)
        if schema is None:
            errors.append(f"{path.name}: no schema for topic {topic}")
            continue
        try:
            jsonschema.validate(doc, schema)
        except jsonschema.ValidationError as e:
            errors.append(f"{path.relative_to(config.RESEARCH_DIR)}: {e.message} at {list(e.absolute_path)}")
            continue
        if topic in DICT_TOPICS:
            merged = entries_by_topic.setdefault(topic, {})
            for sec, rows in doc["entries"].items():
                merged.setdefault(sec, []).extend(rows)
        else:
            entries_by_topic.setdefault(topic, []).extend(doc["entries"])
        if topic == "videos":
            videos_retrieved = doc.get("retrieved_at")

    if errors:
        raise SystemExit("Research seed validation failed:\n  " + "\n  ".join(errors))

    cur = c.cur
    # Translations first, so later topics and the search index see Spanish names.
    for e in entries_by_topic.get("translations", []):
        table, col = TRANSLATABLE[e["type"]]
        cur.execute(f"UPDATE {table} SET name_es = ? WHERE norm_lower({col}) = ? AND (name_es IS NULL OR ?)",
                    (e["name_es"], norm_lower(clean(e["name_en"])), bool(e.get("override"))))
        if cur.rowcount == 0:
            c.misses.add(e["type"], e["name_en"], "translation seed (no row or already translated)")
    loaded["translations"] = len(entries_by_topic.get("translations", []))

    for e in entries_by_topic.get("layered_armor", []):
        mats = [{**m, "item_id": _resolve(c, "item", m.get("item_en"), f"layered {e['slug']}")}
                for m in e.get("materials", [])]
        quests = [{**q, "quest_id": c.quests.map.get(key(q.get("name_en")))} for q in e.get("quests", [])]
        c.insert("layered_armor",
                 ["slug", "name_en", "name_es", "category", "owner", "pieces", "unlock_es", "unlock_en", "steps_es",
                  "materials", "quests", "pc_available", "pc_notes_es", "sources", "needs_review"],
                 [(e["slug"], e["name_en"], e.get("name_es"), e["category"], e.get("owner", "hunter"),
                   J(e.get("pieces", [])), e.get("unlock_es"), e.get("unlock_en"), J(e.get("steps_es", [])),
                   J(mats), J(quests), e.get("pc_available"), e.get("pc_notes_es"), J(e["sources"]),
                   bool(e.get("needs_review")))])
    loaded["layered_armor"] = len(entries_by_topic.get("layered_armor", []))

    for i, e in enumerate(entries_by_topic.get("achievements", [])):
        c.insert("achievements",
                 ["slug", "name_en", "name_es", "description_en", "description_es", "category", "hidden", "guide_es",
                  "steps_es", "related", "sort_order", "sources", "needs_review"],
                 [(e["slug"], e["name_en"], e.get("name_es"), e.get("description_en"), e.get("description_es"),
                   e.get("category"), bool(e.get("hidden")), e.get("guide_es"), J(e.get("steps_es", [])),
                   J(_related(c, e.get("related"), f"achievement {e['slug']}")), e.get("sort_order", i + 1),
                   J(e["sources"]), bool(e.get("needs_review")))])
    loaded["achievements"] = len(entries_by_topic.get("achievements", []))

    for e in entries_by_topic.get("festivals", []):
        tickets = [{**t, "item_id": _resolve(c, "item", t["item_en"], f"festival {e['slug']}")}
                   for t in e.get("tickets", [])]
        c.insert("festivals",
                 ["slug", "season", "name_es", "astera_en", "seliana_en", "theme", "sort_order", "summary_es",
                  "tickets", "layered", "known_periods", "sources", "needs_review"],
                 [(e["slug"], e["season"], e["name_es"], e["astera_en"], e["seliana_en"], e["theme"],
                   e.get("sort_order", 0), e.get("summary_es"), J(tickets), J(e.get("layered", [])),
                   J(e.get("known_periods", [])), J(e["sources"]), bool(e.get("needs_review")))])
    loaded["festivals"] = len(entries_by_topic.get("festivals", []))

    # Videos are a topic of their own but belong to guides: group by guide_slug, best-rated first.
    vids: dict[str, list] = {}
    for v in entries_by_topic.get("videos", []):
        vids.setdefault(v["guide_slug"], []).append(
            {**{k: v.get(k) for k in ("youtube_id", "title", "channel", "lang", "views", "likes", "published",
                                      "duration_s", "url")},
             "low_confidence": bool(v.get("low_confidence")), "retrieved_at": videos_retrieved})
    for lst in vids.values():
        lst.sort(key=lambda x: (x["low_confidence"], -(x["views"] or 0)))
    guide_slugs = {e["slug"] for e in entries_by_topic.get("guides", [])}
    orphan_videos = sum(len(v) for k, v in vids.items() if k not in guide_slugs)

    for e in entries_by_topic.get("guides", []):
        seen = set()
        videos = []
        for v in list(e.get("videos", [])) + vids.get(e["slug"], []):
            if v["youtube_id"] not in seen:
                seen.add(v["youtube_id"])
                videos.append(v)
        c.insert("guides",
                 ["slug", "kind", "title_es", "title_en", "summary_es", "body_md_es", "steps_es", "related", "videos",
                  "sources", "needs_review"],
                 [(e["slug"], e["kind"], e["title_es"], e.get("title_en"), e.get("summary_es"), e.get("body_md_es"),
                   J(e.get("steps_es", [])), J(_related(c, e.get("related"), f"guide {e['slug']}")),
                   J(videos), J(e["sources"]), bool(e.get("needs_review")))])
    loaded["guides"] = len(entries_by_topic.get("guides", []))
    loaded["videos"] = len(entries_by_topic.get("videos", [])) - orphan_videos
    if orphan_videos:
        loaded["videos_without_guide"] = orphan_videos

    # Canteen: ingredients cross-referenced with items by name_en when they exist (silently NULL otherwise).
    can = entries_by_topic.get("canteen", {})
    rows = []
    for i, e in enumerate(can.get("ingredients", [])):
        u = e.get("unlock") or {}
        rows.append((e["id"], e["name_en"], e.get("name_es"), e["category"], e.get("category_es"), e["skill_type"],
                     e.get("skill_type_es"), e.get("description_en"), e.get("description_es"), u.get("type"), J(u),
                     e.get("can_be_fresh"), J(e.get("aliases", [])), c.items.map.get(key(e["name_en"])), i + 1,
                     J(e["sources"]), bool(e.get("needs_review")), J(e.get("review_notes", []))))
    c.insert("canteen_ingredients",
             ["id", "name_en", "name_es", "category", "category_es", "skill_type", "skill_type_es", "description_en",
              "description_es", "unlock_type", "unlock", "can_be_fresh", "aliases", "item_id", "sort_order", "sources",
              "needs_review", "review_notes"], rows)
    rows = []
    for i, e in enumerate(can.get("skills", [])):
        nd = e.get("numeric_details")
        rows.append((e["id"], e["name_en"], e.get("name_es"), e.get("effect_en"), e.get("effect_es"), e["kind"],
                     e.get("skill_type"), e.get("skill_type_es"), e.get("tier"), e.get("ingredients_required"),
                     e.get("hunter_effect"), e.get("palico_effect"), e.get("duration"), e.get("pool_note"),
                     e.get("note_es"), J(nd) if nd is not None else None, i + 1, J(e["sources"]),
                     bool(e.get("needs_review")), J(e.get("review_notes", []))))
    c.insert("canteen_skills",
             ["id", "name_en", "name_es", "effect_en", "effect_es", "kind", "skill_type", "skill_type_es", "tier",
              "ingredients_required", "hunter_effect", "palico_effect", "duration", "pool_note", "note_es",
              "numeric_details", "sort_order", "sources", "needs_review", "review_notes"], rows)
    rows = [(e["id"], e["topic"], e["title_es"], e["text_es"], i + 1, J(e["sources"]),
             bool(e.get("needs_review")), J(e.get("review_notes", [])))
            for i, e in enumerate(can.get("rules", []))]
    c.insert("canteen_rules", ["id", "topic", "title_es", "text_es", "sort_order", "sources", "needs_review",
                               "review_notes"], rows)
    loaded["canteen"] = {k: len(v) for k, v in can.items()}

    for topic, table in (("loot", "loot_rules"), ("gathering_rules", "gathering_rules")):
        rows = []
        for sec, lst in entries_by_topic.get(topic, {}).items():
            for i, e in enumerate(lst):
                rid = e.get("id") or f"{sec}_{i + 1}"
                rows.append((rid, sec, e.get("name_en"), e.get("name_es"), i + 1, J(e),
                             J(e.get("sources", [])), bool(e.get("needs_review"))))
        c.insert(table, ["id", "section", "name_en", "name_es", "sort_order", "data", "sources", "needs_review"], rows)
        loaded[topic] = len(rows)

    rows = []
    for e in entries_by_topic.get("habitats", []):
        mid = c.monsters.get(e["monster_en"], "habitat seed")
        lid = c.locations.get(e["location_en"], "habitat seed")
        if mid and lid:
            rows.append((mid, lid, e.get("start_area"), e.get("move_area"), e.get("rest_area"), e.get("rank"),
                         e.get("notes_es"), _src(e)))
    c.insert("monster_habitats", ["monster_id", "location_id", "start_area", "move_area", "rest_area", "rank",
                                  "notes_es", "source"], rows)
    loaded["habitats"] = len(rows)

    rows = []
    for e in entries_by_topic.get("gathering", []):
        lid = c.locations.get(e["location_en"], "gathering seed")
        iid = c.items.get(e["item_en"], f"gathering seed {e['location_en']}")
        if lid and iid:
            rows.append((lid, e.get("area"), e.get("rank"), iid, e.get("stack"), e.get("percentage"), e.get("nodes"),
                         e.get("notes_es"), _src(e)))
    c.insert("location_items", ["location_id", "area", "rank", "item_id", "stack", "percentage", "nodes", "notes_es",
                                "source"], rows)
    loaded["gathering"] = len(rows)

    rows = []
    for e in entries_by_topic.get("camps", []):
        lid = c.locations.get(e["location_en"], "camp seed")
        if lid:
            cur.execute("DELETE FROM location_camps WHERE location_id = ? AND area IS ?",
                        (lid, e.get("area")))
            rows.append((lid, e["name_en"], e.get("name_es"), e.get("area"), e.get("unlock_es"), _src(e)))
    c.insert("location_camps", ["location_id", "name_en", "name_es", "area", "unlock_es", "source"], rows)
    loaded["camps"] = len(rows)

    n = 0
    for e in entries_by_topic.get("quest_availability", []):
        cur.execute("UPDATE quests SET pc_available = ?, pc_notes_es = ? WHERE norm_lower(name_en) = ?",
                    (e["pc_available"], e.get("pc_notes_es"), norm_lower(clean(e["quest_en"]))))
        if cur.rowcount == 0:
            c.misses.add("quest", e["quest_en"], "quest_availability seed")
        n += cur.rowcount
    loaded["quest_availability"] = n
    return loaded


def _src(e: dict) -> str:
    urls = [s.get("url") for s in e.get("sources", []) if s.get("url")]
    return "research: " + (", ".join(urls[:3]) if urls else "gemini-notebook")
