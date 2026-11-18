"""Generate tests/parity/endpoints.txt from the live API (GET only). Run once; output is committed."""
import json, sys, urllib.request as u
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
def g(p): return json.load(u.urlopen(BASE + p, timeout=30))
def pick(lst, key="id"):
    ids = [x[key] for x in lst]
    return [ids[0], ids[len(ids) // 2], ids[-1]]
out = []
def add(*ps): out.extend(ps)
add("/api/health", "/api/stats", "/api/progress/summary", "/api/progress", "/api/progress?entity_type=monster_hunted",
    "/api/progress?entity_type=achievement")
items = g("/api/items?limit=2000")
add("/api/items", "/api/items?limit=2000", "/api/items?limit=5&category=item", "/api/items?rarity=3&limit=50",
    "/api/items?q=poci&limit=30", "/api/items?q=%25&limit=20", "/api/items?category=nonexistent",
    "/api/items?limit=0", "/api/items?rarity=100")
for c in sorted({x["category"] for x in items}):
    add(f"/api/items?category={c}&limit=40")
null_r = [x["id"] for x in items if x["rarity"] is None]
for i in pick(items) + null_r[:2] + [x["id"] for x in items if x["subcategory"]][:1]:
    add(f"/api/items/{i}")
add("/api/items/99999999", "/api/items/0")
mons = g("/api/monsters")
add("/api/monsters", "/api/monsters?size=large", "/api/monsters?size=small")
for i in pick(mons) + [m["id"] for m in mons if m["size"] == "small"][:1]:
    add(f"/api/monsters/{i}")
add("/api/monsters/99999")
sets = g("/api/armor-sets")
add("/api/armor-sets", "/api/armor-sets?rank=LR", "/api/armor-sets?rank=HR", "/api/armor-sets?rank=MR")
for i in pick(sets):
    add(f"/api/armor-sets/{i}")
add("/api/armor-sets/99999", "/api/armor/1", "/api/armor/800", "/api/armor/1595", "/api/armor/99999")
ws = g("/api/weapons?limit=2000")
add("/api/weapons", "/api/weapons?limit=2000", "/api/weapons?limit=10&q=rath")
for t in sorted({x["weapon_type"] for x in ws}):
    add(f"/api/weapons?weapon_type={t}&limit=25")
for i in pick(ws) + [x["id"] for x in ws if x["category"]][:1]:
    add(f"/api/weapons/{i}")
add("/api/weapons/99999999")
add("/api/skills/1", "/api/skills/90", "/api/skills/178", "/api/skills/99999",
    "/api/decorations/1", "/api/decorations/200", "/api/decorations/406", "/api/decorations/99999",
    "/api/charms/1", "/api/charms/150", "/api/charms/317", "/api/charms/99999")
qs = g("/api/quests")
add("/api/quests")
for c in sorted({x["category"] for x in qs})[:6]:
    add(f"/api/quests?category={c}")
for r in sorted({x["rank"] for x in qs if x["rank"]}):
    add(f"/api/quests?rank={r}")
add("/api/quests?category=assigned&rank=MR")
for i in pick(qs):
    add(f"/api/quests/{i}")
add("/api/quests/99999", "/api/events", "/api/events?platform=pc", "/api/events?platform=ps4", "/api/locations")
locs = g("/api/locations")
for i in pick(locs):
    add(f"/api/locations/{i}")
add("/api/locations/99999")
lay = g("/api/layered")
add("/api/layered")
for c in sorted({x["category"] for x in lay}):
    add(f"/api/layered?category={c}")
add("/api/layered?owner=hunter", "/api/layered?owner=palico")
for s in pick(lay, "slug"):
    add(f"/api/layered/{s}")
add("/api/layered/does-not-exist")
ach = g("/api/achievements")
add("/api/achievements")
for s in pick(ach, "slug"):
    add(f"/api/achievements/{s}")
add("/api/achievements/nope")
gd = g("/api/guides")
add("/api/guides")
for k in sorted({x["kind"] for x in gd}):
    add(f"/api/guides?kind={k}")
for s in [x["slug"] for x in gd]:
    add(f"/api/guides/{s}")
add("/api/guides/nope")
best = g("/api/bestiary")
add("/api/bestiary")
for i in pick(best):
    add(f"/api/bestiary/{i}")
add("/api/bestiary/99999")
add("/api/festivals", "/api/calendar", "/api/calendar?start=2025-01-01&end=2025-12-31", "/api/calendar?start=2026-01-01&end=2026-03-01",
    "/api/calendar?start=2030-06-01&end=2030-06-30", "/api/calendar/now",
    "/api/canteen", "/api/loot-rules", "/api/gathering-rules", "/api/melder")
bm = [m["id"] for m in best]
for i in pick(best):
    add(f"/api/builds/monster/{i}", f"/api/builds/monster/{i}?rank=MR&cap=full")
add(f"/api/builds/monster/{bm[0]}?rank=LR", f"/api/builds/monster/{bm[1]}?rank=HR&weapon_slots=2,1",
    f"/api/builds/monster/{bm[1]}?owned=1", "/api/builds/monster/99999",
    "/api/builds/rules", "/api/builds/goal/recoleccion", "/api/builds/goal/botin?rank=HR&cap=progress",
    "/api/builds/goal/botin?owned=1", "/api/builds/goal/foo")
add("/api/profile/status", "/api/profile", "/api/profile?slot=0", "/api/profile/history", f"/api/profile/monster/{bm[0]}",
    f"/api/profile/monster/{bm[-1]}", "/api/profile/armor", "/api/profile/quests", "/api/profile/equipment",
    "/api/profile/stats", "/api/profile/achievement-progress", "/api/profile/stats?slot=99")
# dedupe, keep order
seen, res = set(), []
for p in out:
    if p not in seen:
        seen.add(p); res.append(p)
open("tests/parity/endpoints.txt", "w", encoding="utf-8", newline="\n").write(
    "# GET endpoints for parity capture. One path per line. 'POST <path> <json>' lines are read-only POSTs.\n"
    + "\n".join(res) + "\n"
    + 'POST /api/builds/evaluate {"pieces": [], "decorations": []}\n')
print(len(res), "GET endpoints")
