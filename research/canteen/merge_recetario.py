"""Merge the user's canteen workbook (Docs/Recetario_Cantina_MHW_Iceborne.xlsx)
into research/canteen/canteen.json.

Run from the repo root:  python -I research/canteen/merge_recetario.py

Idempotent: running it twice produces byte-identical output.
Stdlib only (the workbook is read with zipfile + xml, openpyxl is not used).
"""

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
XLSX = REPO / "Docs" / "Recetario_Cantina_MHW_Iceborne.xlsx"
SEED = REPO / "research" / "canteen" / "canteen.json"

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# Workbook name_en -> seed name_en, for the known typos / naming differences.
INGREDIENT_ALIASES = {
    "apcerpast": "apceroast",
}
SKILL_ALIASES = {
    "felyne lucky cat": "lucky cat",
}

FOOD_SOURCES = [
    {"title": "TeamBRG - MHW Food Guide",
     "url": "https://teambrg.com/monster-hunter-world/mhw-food-guide-recipes-buffs-list/"},
    {"title": "Steam Community - Meowster's Hunting Book",
     "url": "https://steamcommunity.com/sharedfiles/filedetails/?id=1502948857"},
]

RECIPE_SOURCES = [
    {"title": "Fextralife - Food Skills",
     "url": "https://monsterhunterworld.wiki.fextralife.com/Food_Skills"},
    {"title": "Kiranico - Food Skills",
     "url": "https://mhworld.kiranico.com/en/catskills"},
    {"title": "Fandom - How the Monster Hunter World Canteen Works",
     "url": "https://www.fandom.com/articles/monster-hunter-world-food"},
]

FANDOM_URL = "https://www.fandom.com/articles/monster-hunter-world-food"
FEXTRA_CANTEEN_URL = "https://monsterhunterworld.wiki.fextralife.com/Canteen"
FEXTRA_ICE_URL = "https://fextralife.com/monster-hunter-world-iceborne-canteen-ingredients-guide/"

BRANCHES = [
    # id (= skill_type), name_es, name_en, color_name_es, color_hex, glyph, group
    ("Courage", "Coraje", "Courage", "Rojo", "#a7160e", "fist", "food"),
    ("Resilience", "Tesón", "Resilience", "Azul", "#2e68a5", "shield", "food"),
    ("Vigor", "Vigor", "Vigor", "Naranja", "#b04f07", "bolt", "food"),
    ("Acumen", "Ingenio", "Acumen", "Morado", "#653485", "flask", "food"),
    ("Artillery", "Artillería", "Artillery", "Amarillo", "#7f6b1c", "bomb", "food"),
    ("Perception", "Percepción", "Perception", "Verde", "#4f744c", "eye", "drink"),
    ("Fortune", "Fortuna", "Fortune", "Dorado", "#654700", "coin", "drink"),
    ("Preparation", "Preparación", "Preparation", "Hielo", "#247587", "boot", "drink"),
    ("Trailblazer", "Aventura", "Trailblazer", "Ámbar", "#7a4632", "compass", "drink"),
]
BRANCH_REVIEW = {
    "Courage": ["Rojo solo lo da la guía de Steam; TeamBRG omite la etiqueta."],
    "Preparation": ["Ninguna fuente publica el color de esta rama de Iceborne; el color es una elección de diseño de la guía."],
    "Trailblazer": ["Ninguna fuente publica el color de esta rama de Iceborne; el color es una elección de diseño de la guía."],
}

# Recipes R01-R16 take name/plate/voucher/use from the workbook (sheet 4).
# Fixed composition, targets and variants are defined here, not derived from text.
# composition items: (count, category, branch)
RECIPE_SPEC = {
    "R01": dict(comp=[(4, "meat", "Artillery"), (2, "meat", "Courage")],
                targets=["fs_felyne_bombardier", "fs_felyne_polisher"],
                variants="o 2 carnes de Vigor en lugar de Coraje (Elevador Felyne +2)"),
    "R02": dict(comp=[(4, "meat", "Artillery"), (2, "meat", "Resilience")],
                targets=["fs_felyne_bombardier", "fs_felyne_acrobat"]),
    "R03": dict(comp=[(4, "veggie", "Artillery"), (2, "meat", "Resilience")],
                targets=["fs_felyne_bombardier", "fs_felyne_acrobat"]),
    "R04": dict(comp=[(6, "meat", "Resilience")], targets=["fs_felyne_moxie"]),
    "R05": dict(comp=[(6, "veggie", "Resilience")], targets=["fs_felyne_moxie"]),
    "R06": dict(comp=[(6, "drink", "Preparation")], targets=["fs_felyne_safeguard"]),
    "R07": dict(comp=[(6, "drink", "Preparation")], targets=["fs_felyne_safeguard"],
                needs_daily="fs_felyne_insurance"),
    "R08": dict(comp=[(4, "meat", "Vigor"), (2, "meat", "Artillery")],
                targets=["fs_felyne_black_belt", "fs_felyne_sharpshooter"]),
    "R09": dict(comp=[(4, "meat", "Vigor"), (2, "meat", "Courage")],
                targets=["fs_felyne_black_belt", "fs_felyne_polisher"]),
    "R10": dict(comp=[(6, "meat", "Courage")], targets=["fs_felyne_slugger"]),
    "R11": dict(comp=[(4, "meat", "Courage"), (2, "meat", "Vigor")],
                targets=["fs_felyne_rider", "fs_felyne_riser_hi"]),
    "R12": dict(comp=[(6, "meat", "Vigor")], targets=["fs_felyne_heroics"]),
    "R13": dict(comp=[(6, "meat", "Acumen")], targets=["fs_felyne_specialist"]),
    "R14": dict(comp=[(6, "drink", "Perception")], targets=["fs_felyne_carver_hi"]),
    "R15": dict(comp=[(4, "drink", "Perception"), (2, "drink", "Fortune")],
                targets=["fs_felyne_exchanger", "fs_felyne_harvester"],
                variants="o al revés: 4 Fortuna + 2 Percepción = Magnate Felyne + Cortador Felyne férreo"),
    "R16": dict(comp=[(6, "drink", "Trailblazer")], targets=["fs_felyne_zoomaster"]),
    "R17": dict(name_es="Puntos de investigación", plate_type_es="Bebidas",
                comp=[(4, "drink", "Perception"), (2, "meat", "Courage")],
                targets=["fs_felyne_exchanger", "fs_felyne_polisher"],
                variants="las 2 carnes pueden ser de cualquier rama de comida (o 2 verduras para Res. elemental P)",
                voucher="Opcional",
                use="Sube los puntos de investigación al terminar la misión y conserva una estadística pequeña."),
    "R18": dict(name_es="Farmeo de recompensas", plate_type_es="Bebidas",
                comp=[(6, "drink", "Fortune")], targets=["fs_lucky_cat"],
                variants="o 4 Fortuna + 2 carnes = Magnate Felyne + Ataque P",
                voucher="Muy recomendado",
                use="Más objetos al final de la misión en farmeo de materiales o joyas."),
    "R19": dict(name_es="Terreno difícil sin perder Ataque", plate_type_es="Híbrido",
                comp=[(4, "meat", "Vigor"), (2, "drink", "Preparation")],
                targets=["fs_felyne_black_belt", "fs_felyne_cleats"],
                variants="las 4 carnes pueden ser de la rama que quieras (habilidad x2 de esa rama)",
                voucher="Opcional",
                use="Velocidad normal en nieve profunda, barro o agua conservando Ataque M."),
}

NEW_RULES = [
    {
        "id": "rule_type_vs_branch",
        "topic": "combination",
        "title_es": "Dos ejes a la vez: tipo y rama",
        "text_es": "El tipo de ingrediente y su rama son independientes y cuentan a la vez. El tipo da la estadística: carne = Ataque, pescado = Defensa, verdura = Resistencia elemental, de nivel P/M/G (pequeño, mediano, grande) con 2/4/6 ingredientes de esa categoría; las bebidas no dan estadística. La rama da la habilidad felyne. Ejemplo: 4 carnes de Artillería + 2 carnes de Coraje = Ataque G + Bombardero Felyne + Pulidor Felyne.",
        "sources": [
            {"title": "Fextralife MHW Wiki - Canteen", "url": FEXTRA_CANTEEN_URL},
            {"title": "Fandom - How the Monster Hunter World Canteen Works", "url": FANDOM_URL},
        ],
        "needs_review": False,
        "review_notes": [],
    },
    {
        "id": "rule_drinks_slots",
        "topic": "combination",
        "title_es": "Las bebidas ocupan hueco",
        "text_es": "Las bebidas se eligen en los mismos huecos que la comida, así que cada par de bebidas baja un nivel la estadística: 4 carnes + 2 bebidas de Preparación = Ataque M + Tacos Felyne; 6 bebidas = sin estadística. Como las 4 ramas de bebida solo existen en bebidas, sus habilidades de nivel 3 (Cortador Felyne +2, Felyne afortunado, Salvaguardia Felyne, Zoología Felyne) obligan a renunciar a la estadística.",
        "sources": [
            {"title": "Fextralife MHW Wiki - Canteen", "url": FEXTRA_CANTEEN_URL},
            {"title": "Fextralife - MHW Iceborne Canteen Ingredients Guide", "url": FEXTRA_ICE_URL},
        ],
        "needs_review": False,
        "review_notes": [],
    },
]

SKILL_BY_CATEGORY = {
    "id": "rule_skill_by_category",
    "topic": "combination",
    "title_es": "Qué determina la habilidad: la rama (color)",
    "text_es": "Cada ingrediente pertenece a una rama de habilidad (color): Coraje, Tesón, Vigor, Ingenio y Artillería existen en carne, pescado y verdura; Percepción, Fortuna, Preparación y Aventura solo en bebidas. Se cuentan los ingredientes de la misma rama sumando todas las categorías: 2 dan la habilidad de nivel 1, 4 la de nivel 2 y 6 la de nivel 3. Cada rama da SOLO su nivel más alto: con 6 de Artillería sale Piro Felyne, pero no Bombardero ni Puntería.",
    "sources": [
        {"title": "Fandom - How the Monster Hunter World Canteen Works", "url": FANDOM_URL},
        {"title": "Fextralife MHW Wiki - Food Skills", "url": "https://monsterhunterworld.wiki.fextralife.com/Food_Skills"},
        {"title": "Fextralife MHW Wiki - Canteen", "url": FEXTRA_CANTEEN_URL},
    ],
    "needs_review": True,
    "review_notes": ["La exclusividad del nivel solo la afirma Fandom (y el recetario del usuario que la cita); confirmar en el juego."],
}


class Fail(Exception):
    pass


def read_xlsx(path):
    """Return {sheet_name: {row_number: {column_letter: text}}}."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("{%s}si" % NS_MAIN):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS_MAIN)))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.get("Id"): r.get("Target") for r in rels}
    sheets = {}
    for sh in wb.find("{%s}sheets" % NS_MAIN):
        target = rel_map[sh.get("{%s}id" % NS_REL)].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        root = ET.fromstring(z.read(target))
        rows = {}
        for c in root.iter("{%s}c" % NS_MAIN):
            m = re.match(r"([A-Z]+)(\d+)$", c.get("r"))
            col, row = m.group(1), int(m.group(2))
            kind = c.get("t")
            val = None
            if kind == "s":
                v = c.find("{%s}v" % NS_MAIN)
                val = shared[int(v.text)] if v is not None else None
            elif kind == "inlineStr":
                val = "".join(t.text or "" for t in c.iter("{%s}t" % NS_MAIN))
            else:
                v = c.find("{%s}v" % NS_MAIN)
                val = v.text if v is not None else None
            if val is not None:
                rows.setdefault(row, {})[col] = val
        sheets[sh.get("name")] = rows
    return sheets


def norm(text):
    return re.sub(r"\s+", " ", text or "").strip().lower()


def clean_footnote(text):
    """Strip a footnote digit glued to the end of a word (e.g. 'inicial3')."""
    return re.sub(r"(?<=[a-záéíóúñ])\d{1,2}$", "", text.strip())


def match_ingredients(sheet, seed):
    by_name = {}
    for ing in seed["entries"]["ingredients"]:
        by_name.setdefault(norm(ing["name_en"]), []).append(ing)
    matched = {}
    problems = []
    for row in sorted(sheet):
        if row < 5:
            continue
        doc_id = (sheet[row].get("A") or "").strip()
        if not re.fullmatch(r"[CPVB]\d\d", doc_id):
            continue
        name_en = norm(sheet[row].get("E"))
        key = INGREDIENT_ALIASES.get(name_en, name_en)
        hits = by_name.get(key, [])
        if len(hits) != 1:
            problems.append("ingrediente sin cruce unico: %s (%s)" % (doc_id, sheet[row].get("E")))
            continue
        unlock = clean_footnote(sheet[row].get("J") or "") or None
        matched[hits[0]["id"]] = {"doc_id": doc_id, "unlock_es": unlock, "alias": key != name_en}
    return matched, problems


def match_skills(sheet, seed):
    by_name = {}
    for sk in seed["entries"]["skills"]:
        by_name.setdefault(norm(sk["name_en"]), []).append(sk)
    matched = {}
    problems = []
    for row in sorted(sheet):
        if row < 5:
            continue
        code = (sheet[row].get("A") or "").strip()
        if not re.fullmatch(r"[HD]\d\d", code):
            continue
        name_en = norm(sheet[row].get("G"))
        key = SKILL_ALIASES.get(name_en, name_en)
        hits = by_name.get(key, [])
        if len(hits) != 1:
            problems.append("habilidad sin cruce unico: %s (%s)" % (code, sheet[row].get("G")))
            continue
        matched[hits[0]["id"]] = (sheet[row].get("I") or "").strip() or None
    return matched, problems


def validate_recipe(rid, spec, seed_by_id, branch_skills):
    """Fail loudly if a fixed recipe contradicts the seed or the tier rule."""
    total = sum(c for c, _, _ in spec["comp"])
    if total != 6:
        raise Fail("%s: la composicion suma %d, deben ser 6" % (rid, total))
    ing_count = {}
    for ing in seed_by_id["ingredients"].values():
        key = (ing["category"], ing["skill_type"])
        ing_count[key] = ing_count.get(key, 0) + 1
    branch_total = {}
    for count, cat, branch in spec["comp"]:
        if ing_count.get((cat, branch), 0) < count:
            raise Fail("%s: no hay %d ingredientes de %s/%s en el seed" % (rid, count, cat, branch))
        branch_total[branch] = branch_total.get(branch, 0) + count
    for branch, count in branch_total.items():
        if count < 2:
            continue
        expected_tier = min(count, 6) // 2
        wanted = [t for t in spec["targets"] if seed_by_id["skills"][t]["skill_type"] == branch]
        if len(wanted) != 1 or seed_by_id["skills"][wanted[0]]["tier"] != expected_tier:
            raise Fail("%s: rama %s con %d ingredientes debe dar tier %d" % (rid, branch, count, expected_tier))
    for t in spec["targets"]:
        sk = seed_by_id["skills"][t]
        if branch_total.get(sk["skill_type"], 0) < 2:
            raise Fail("%s: objetivo %s no tiene 2 o mas ingredientes de su rama" % (rid, t))
    # every branch with >= 2 ingredients must have its skill in the targets (checked above in reverse)
    for branch, count in branch_total.items():
        if count >= 2 and not any(seed_by_id["skills"][t]["skill_type"] == branch for t in spec["targets"]):
            raise Fail("%s: la rama %s llega a %d pero no tiene habilidad objetivo" % (rid, branch, count))


def build_recipes(xlsx_sheet4, seed_by_id):
    recipes = []
    for row in sorted(xlsx_sheet4):
        rid = (xlsx_sheet4[row].get("A") or "").strip()
        if not re.fullmatch(r"R\d\d", rid):
            continue
        recipes.append((rid, row))
    if [r for r, _ in recipes] != ["R%02d" % i for i in range(1, 17)]:
        raise Fail("la hoja 4 no tiene exactamente R01..R16 (R17-R19 van fijos en el script)")
    out = []
    for order, (rid, row) in enumerate(recipes, start=1):
        sheet_row = xlsx_sheet4[row]
        spec = RECIPE_SPEC[rid]
        out.append(build_recipe(rid, order, spec, sheet_row, seed_by_id))
    # R17-R19 are not in the workbook; they are appended in fixed order
    for rid in sorted(RECIPE_SPEC):
        if rid in {r for r, _ in recipes}:
            continue
        out.append(build_recipe(rid, len(out) + 1, RECIPE_SPEC[rid], None, seed_by_id))
    return out


def build_recipe(rid, order, spec, sheet_row, seed_by_id):
    validate_recipe(rid, spec, seed_by_id, None)
    if sheet_row is not None:
        name_es = sheet_row["B"].strip()
        plate = sheet_row["C"].strip()
        voucher = sheet_row.get("G", "").strip() or None
        use = sheet_row.get("H", "").strip() or None
    else:
        name_es = spec["name_es"]
        plate = spec["plate_type_es"]
        voucher = spec.get("voucher")
        use = spec.get("use")
    return {
        "id": rid,
        "name_es": name_es,
        "plate_type_es": plate,
        "composition": [{"count": c, "category": cat, "branch": br} for c, cat, br in spec["comp"]],
        "variants_es": spec.get("variants"),
        "target_skill_ids": list(spec["targets"]),
        "needs_daily": spec.get("needs_daily"),
        "voucher_es": voucher,
        "use_es": use,
        "sort_order": order,
        "sources": RECIPE_SOURCES,
        "needs_review": False,
        "review_notes": [],
    }


def build_branches(seed_by_id):
    skills = seed_by_id["skills"].values()
    out = []
    for order, (bid, name_es, name_en, color_es, color_hex, glyph, group) in enumerate(BRANCHES, start=1):
        tier_ids = []
        for tier in (1, 2, 3):
            hits = [s["id"] for s in skills
                    if s["kind"] == "ingredient" and s["skill_type"] == bid and s["tier"] == tier]
            if len(hits) != 1:
                raise Fail("rama %s tier %d: %d habilidades en el seed" % (bid, tier, len(hits)))
            tier_ids.append(hits[0])
        review = BRANCH_REVIEW.get(bid, [])
        out.append({
            "id": bid,
            "name_es": name_es,
            "name_en": name_en,
            "color_name_es": color_es,
            "color_hex": color_hex,
            "glyph": glyph,
            "group": group,
            "categories": ["drink"] if group == "drink" else ["meat", "fish", "veggie"],
            "skill_ids": tier_ids,
            "sort_order": order,
            "sources": FOOD_SOURCES,
            "needs_review": bool(review),
            "review_notes": review,
        })
    return out


def main():
    if not XLSX.exists():
        raise Fail("no existe %s" % XLSX)
    raw = SEED.read_bytes().decode("utf-8")
    seed = json.loads(raw)
    sheets = read_xlsx(XLSX)
    s1 = sheets["1_Catalogo_Ingredientes"]
    s2 = sheets["2_Habilidades_Felinas"]
    s4 = sheets["4_Recetario_Optimo"]

    ing_match, ing_problems = match_ingredients(s1, seed)
    if ing_problems:
        for p in ing_problems:
            print("ERROR:", p)
        raise Fail("%d ingredientes sin cruce" % len(ing_problems))
    if len(ing_match) != 114 or len(seed["entries"]["ingredients"]) != 114:
        raise Fail("se esperaban 114 cruces, hay %d" % len(ing_match))

    skill_match, skill_problems = match_skills(s2, seed)
    if skill_problems:
        for p in skill_problems:
            print("ERROR:", p)
        raise Fail("%d habilidades sin cruce" % len(skill_problems))
    if len(skill_match) != 31:
        raise Fail("se esperaban 31 habilidades con sinergia, hay %d" % len(skill_match))

    # Apply to the seed entries (new keys are appended; existing keys keep their order).
    for ing in seed["entries"]["ingredients"]:
        m = ing_match.get(ing["id"])
        ing["doc_id"] = m["doc_id"] if m else None
        ing["unlock_es"] = m["unlock_es"] if m else None
    for sk in seed["entries"]["skills"]:
        sk["synergy_es"] = skill_match.get(sk["id"])

    seed_by_id = {
        "skills": {s["id"]: s for s in seed["entries"]["skills"]},
        "ingredients": {i["id"]: i for i in seed["entries"]["ingredients"]},
    }
    seed["entries"]["branches"] = build_branches(seed_by_id)
    seed["entries"]["recipes"] = build_recipes(s4, seed_by_id)

    # Rules: replace rule_skill_by_category in place, then (re)insert the two new rules right after it.
    new_ids = {r["id"] for r in NEW_RULES}
    rules = [r for r in seed["entries"]["rules"] if r["id"] not in new_ids]
    rebuilt = []
    found = False
    for r in rules:
        if r["id"] == "rule_skill_by_category":
            rebuilt.append(SKILL_BY_CATEGORY)
            rebuilt.extend(NEW_RULES)
            found = True
        else:
            rebuilt.append(r)
    if not found:
        raise Fail("no existe rule_skill_by_category en el seed")
    seed["entries"]["rules"] = rebuilt

    text = json.dumps(seed, ensure_ascii=False, indent=1).replace("\n", "\r\n")
    if text != raw:
        SEED.write_bytes(text.encode("utf-8"))
        print("canteen.json actualizado")
    else:
        print("canteen.json sin cambios")
    print("ingredientes cruzados: %d, habilidades con sinergia: %d" % (len(ing_match), len(skill_match)))
    print("ramas: %d, recetas: %d, reglas: %d" % (
        len(seed["entries"]["branches"]), len(seed["entries"]["recipes"]), len(seed["entries"]["rules"])))


if __name__ == "__main__":
    try:
        main()
    except Fail as exc:
        print("ERROR:", exc)
        sys.exit(1)
