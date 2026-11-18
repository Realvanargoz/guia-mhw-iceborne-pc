"""Build research/melder/melder_data.json from the Kiranico Maxifusionador page (en + es), parsed in data/raw/melder/kmel_final.json.

kmel_final.json comes from data/raw/melder/kmel_{en,es}.html (https://mhworld.kiranico.com/{en,es}/melder):
 - table 1: craftable items with Research Points (RP) and Melding Points (MP) needed
 - table 2: each ingredient with its MP value and the (lower-tier) items it can be used for.
Kiranico lists NO ingredient->item mapping for the 82 Guiding Lands materials; the API says so (needs_review).
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
d = json.loads((root / "data/raw/melder/kmel_final.json").read_text(encoding="utf-8"))
SRC = [{"title": "Kiranico MH:World - Maxifusionador (es)", "url": "https://mhworld.kiranico.com/es/melder"},
       {"title": "Kiranico MH:World - Elder Melder (en)", "url": "https://mhworld.kiranico.com/en/melder"}]

items = []
for en, es in zip(d["items_en"], d["items_es"]):
    assert en[2].split("/")[-2] == es[2].split("/")[-2], (en, es)  # same Kiranico id
    items.append({"name_en": en[0], "name_es": es[0], "rp": en[1][0], "mp": en[1][1], "url": en[2]})
ings = []
for en, es in zip(d["ing_en"], d["ing_es"]):
    assert en["mp"] == es["mp"] and len(en["targets"]) == len(es["targets"])
    ings.append({"name_en": en["name"], "name_es": es["name"], "mp": en["mp"], "targets_en": en["targets"]})
out = {"topic": "melder_data", "retrieved_at": "2026-11-16", "sources": SRC, "items": items, "ingredients": ings}
(root / "research/melder/melder_data.json").write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
print(len(items), len(ings))
