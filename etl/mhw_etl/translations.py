"""Spanish UI labels for data terms that MHWorldData only ships in English/Japanese.

These are descriptive labels, not official in-game strings. Official names
(items, monsters, armor...) always come from the data or from research seeds.
"""
import re

PARTS_ES = {
    "Head": "cabeza", "Horn": "cuerno", "Horns": "cuernos", "1 Horn": "un cuerno", "Beak": "pico",
    "Antennae": "antenas", "Neck Pouch": "saco del cuello", "Jaw": "mandíbula", "Body": "cuerpo",
    "Wings": "alas", "Left Wing": "ala izquierda", "Right Wing": "ala derecha", "Back": "lomo",
    "Fin": "aleta", "Claws": "garras", "Forearms": "antebrazos", "Forelegs": "patas delanteras",
    "Left Foreleg": "pata delantera izquierda", "Right Foreleg": "pata delantera derecha",
    "Belly": "vientre", "Chest": "pecho", "Chest Shell": "caparazón del pecho",
    "Hindlegs": "patas traseras", "Left Hindleg": "pata trasera izquierda",
    "Right Hindleg": "pata trasera derecha", "Legs": "patas", "Tail": "cola",
    "Left Wing Mantle": "manto del ala izquierda", "Right Wing Mantle": "manto del ala derecha",
    "Left Leg Mantle": "manto de la pata izquierda", "Right Leg Mantle": "manto de la pata derecha",
}

FIXED = {
    "Track": ("Rastros", "track"),
    "Body Carve": ("Tallar cuerpo", "carve"),
    "Carve / Capture": ("Tallar / captura", "carve"),
    "Shiny Drop": ("Objeto brillante caído", "drop"),
    "Tail Carve": ("Tallar cola cortada", "carve"),
    "Head Shell Carve": ("Tallar caparazón de la cabeza", "carve"),
    "Horn Carve": ("Tallar cuerno", "carve"),
    "Gold Plating Carved": ("Tallar chapado dorado", "carve"),
    "Red Crystal Mining / Shiny": ("Minar cristal rojo / brillante", "mining"),
    "Back Mining": ("Minar lomo", "mining"),
    "Siege Reward (Fury)": ("Recompensa de asedio (furia)", "siege"),
    "Siege Progress": ("Progreso del asedio", "siege"),
    "Palico Bonus": ("Bonificación del camarada felyne", "palico"),
    "Plunderblade": ("Plunderblade (herramienta felyne)", "palico"),
    "Bandit Mantle": ("Manto bandido", "palico"),
    "Hunt (Bronze)": ("Recompensa de misión (bronce)", "reward"),
    "Investigation (Silver)": ("Investigación (plata)", "reward"),
    "Investigation (Gold)": ("Investigación (oro)", "reward"),
    "Investigation (Purple)": ("Investigación (morada)", "reward"),
    "Guiding Lands (Low)": ("Tierras Guía (nivel bajo)", "gl"),
    "Guiding Lands (Mid)": ("Tierras Guía (nivel medio)", "gl"),
    "Guiding Lands (High)": ("Tierras Guía (nivel alto)", "gl"),
    "Guiding Lands (Tempered)": ("Tierras Guía (curtido)", "gl"),
    "Appraisal (Bronze)": ("Tasación (bronce)", "appraisal"),
    "Appraisal (Silver)": ("Tasación (plata)", "appraisal"),
    "Appraisal (Gold)": ("Tasación (oro)", "appraisal"),
    "Appraisal (Blue)": ("Tasación (azul)", "appraisal"),
}

_BREAK_RE = re.compile(r"^(?:Wound|Break)\s+(.+)$")


def reward_condition(name_en: str) -> tuple[str, str]:
    """Return (name_es, kind) for a reward condition."""
    if name_en in FIXED:
        return FIXED[name_en]
    m = _BREAK_RE.match(name_en)
    if m:
        part = m.group(1)
        return f"Romper {PARTS_ES.get(part, part)}", "break"
    return name_en, "other"


RANK_ES = {"LR": "Rango bajo", "HR": "Rango alto", "MR": "Rango maestro"}

# Locations: which ones are not regular hunting maps / came with Iceborne.
LOCATION_KIND = {
    "Arena": "arena", "Special Arena": "arena", "Great Ravine": "siege", "Confluence of Fates": "special",
    "Everstream": "special", "Caverns of El Dorado": "siege", "Origin Isle": "special",
    "Secluded Valley": "special", "Seliana Supply Cache": "siege", "Castle Schrade": "special",
}
ICEBORNE_LOCATIONS = {"Hoarfrost Reach", "Guiding Lands", "Origin Isle", "Secluded Valley",
                      "Seliana Supply Cache", "Castle Schrade"}


def external_map_url(name_en: str) -> str:
    # Fextralife pages include map images, area numbers and camps for every location.
    return "https://monsterhunterworld.wiki.fextralife.com/" + name_en.replace(" ", "+")
