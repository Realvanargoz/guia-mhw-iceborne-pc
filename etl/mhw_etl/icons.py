"""Iconos del juego: TEX de MHW -> WebP.

CLI, desde la raiz del repo (-P: no anade el directorio actual a sys.path):
    PYTHONPATH=etl python -P -m mhw_etl.icons convert      # data/raw/game/ui/**/*.tex -> data/icons/ui/**.webp
    PYTHONPATH=etl python -P -m mhw_etl.icons monsters     # data/icons/monsters/{id}.webp + research/icons/monster_icons.json
    PYTHONPATH=etl python -P -m mhw_etl.icons items        # data/icons/items/{id}.webp + research/icons/item_icons.json
    PYTHONPATH=etl python -P -m mhw_etl.icons ui-named     # data/icons/ui-named/*.webp + research/icons/ui_icons.json
    PYTHONPATH=etl python -P -m mhw_etl.icons all

Formato TEX (MHW / MT Framework, version 0x10), little endian:
    0x00 'TEX\\0'   0x04 version (16)   0x08,0x0C 0
    0x10 tipo (2 = 2D)   0x14 num. de mips   0x18 ancho   0x1C alto
    0x20 profundidad/array (1)   0x24 formato (ver TEX_FORMATS)
    0x28..0xB7 flags, tabla de tiles y relleno (ignorados)
    0xB8 tabla de offsets absolutos de cada mip (uint64 x num. de mips)
    datos de los mips; el mip 0 va de offsets[0] a offsets[1] (o al final del archivo).
Para decodificar se antepone una cabecera DDS con extension DX10 y se abre con Pillow.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import re
import struct
import sys
from pathlib import Path

from PIL import Image

from . import config

UI_RAW = config.RAW_DIR / "game" / "ui"
ICONS_DIR = config.DATA_DIR / "icons"
RESEARCH_ICONS = config.RESEARCH_DIR / "icons"

# formato TEX -> (nombre, DXGI usado para decodificar). Los *_SRGB se decodifican
# como UNORM (mismos bytes; Pillow no implementa BC1_UNORM_SRGB).
TEX_FORMATS = {
    22: ("BC1_UNORM", 71),
    23: ("BC1_UNORM_SRGB", 71),
    24: ("BC4_UNORM", 80),
    26: ("BC5_UNORM", 83),
    28: ("BC6H_UF16", 95),
    30: ("BC7_UNORM", 98),
    31: ("BC7_UNORM_SRGB", 99),
}


class TexError(Exception):
    pass


def tex_info(data: bytes) -> dict:
    if data[:4] != b"TEX\0":
        raise TexError("no es TEX")
    mips = struct.unpack_from("<I", data, 0x14)[0]
    w, h = struct.unpack_from("<II", data, 0x18)
    fmt = struct.unpack_from("<I", data, 0x24)[0]
    offs = struct.unpack_from(f"<{mips}Q", data, 0xB8)
    return {"version": struct.unpack_from("<I", data, 4)[0], "mips": mips, "w": w, "h": h,
            "format": fmt, "offsets": offs}


def tex_to_image(data: bytes) -> Image.Image:
    info = tex_info(data)
    fmt = info["format"]
    if fmt not in TEX_FORMATS:
        raise TexError(f"formato TEX {fmt} no soportado")
    offs = info["offsets"]
    end = offs[1] if info["mips"] > 1 else len(data)
    pix = data[offs[0]:end]
    w, h = info["w"], info["h"]
    hdr = struct.pack("<4sIIIIIII44x", b"DDS ", 124, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000,
                      h, w, len(pix), 0, 1)
    hdr += struct.pack("<II4s20x", 32, 0x4, b"DX10")
    hdr += struct.pack("<IIII4x", 0x1000, 0, 0, 0)
    hdr += struct.pack("<IIIII", TEX_FORMATS[fmt][1], 3, 0, 1, 0)
    im = Image.open(io.BytesIO(hdr + pix))
    im.load()
    return im


def load_tex(path: Path) -> Image.Image:
    return tex_to_image(path.read_bytes())


def save_webp(im: Image.Image, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if im.mode not in ("RGB", "RGBA", "L"):
        im = im.convert("RGBA")
    if im.mode == "L":
        im = im.convert("RGB")
    im.save(out, "WEBP", lossless=True, quality=100, method=4, exact=False)


# ---------------------------------------------------------------- convert
def _convert_one(job: tuple[str, str, bool]) -> tuple[str, str, int, str]:
    """(origen, destino, force) -> (estado, formato, bytes, error)."""
    src, dst, force = Path(job[0]), Path(job[1]), job[2]
    try:
        data = src.read_bytes()
        info = tex_info(data)
        name = TEX_FORMATS.get(info["format"], (str(info["format"]),))[0]
        if dst.exists() and not force and dst.stat().st_mtime >= src.stat().st_mtime:
            return "skip", name, dst.stat().st_size, ""
        save_webp(tex_to_image(data), dst)
        return "ok", name, dst.stat().st_size, ""
    except Exception as e:  # noqa: BLE001 - se informa y se sigue
        return "fail", "?", 0, f"{src.relative_to(UI_RAW)}: {e}"


def cmd_convert(args) -> int:
    from concurrent.futures import ProcessPoolExecutor

    files = sorted(UI_RAW.rglob("*.tex"))
    if args.limit:
        files = files[: args.limit]
    out_root = ICONS_DIR / "ui"
    jobs = [(str(p), str(out_root / p.relative_to(UI_RAW).with_suffix(".webp")), args.force)
            for p in files]
    stats = {"ok": 0, "skip": 0, "fail": 0}
    formats: dict[str, int] = {}
    errors, total = [], 0
    with ProcessPoolExecutor(max_workers=args.workers or None) as ex:
        for i, (st, name, size, err) in enumerate(ex.map(_convert_one, jobs, chunksize=4), 1):
            stats[st] += 1
            formats[name] = formats.get(name, 0) + 1
            total += size
            if err:
                errors.append(err)
            if i % 250 == 0:
                print(f"[convert] {i}/{len(jobs)}", flush=True)
    print(f"[convert] tex={len(files)} convertidos={stats['ok']} ya_estaban={stats['skip']} "
          f"fallidos={stats['fail']} webp_total={total / 1e6:.1f} MB")
    print("[convert] formatos:", json.dumps(formats))
    for e in errors[:50]:
        print("  FALLO", e)
    return 1 if stats["fail"] else 0


# ---------------------------------------------------------------- fuentes
POEDB_DIR = config.RAW_DIR / "poedb"
POEDB_BASE = "https://mhw.poedb.tw/eng"
MHWD = config.MHWORLDDATA_DIR
DESIGN_OUT = config.DATA_DIR.parent / "design" / "out"

# Atlas de objetos common/tex/cmn_item00_ID.tex: 1024x1024, rejilla 16x16 de celdas de 64 px,
# icon_id = fila * 16 + columna (verificado contra las mascaras que publica poedb).
ITEM_ATLAS = "common/tex/cmn_item00_ID.tex"
ITEM_CELL, ITEM_COLS = 64, 16
# Atlas de monstruos common/tex/cmn_micon00_ID.tex: 512x1024, 8 columnas x 16 filas de 64 px.
MICON_ATLAS = "common/tex/cmn_micon00_ID.tex"
MICON_CELL, MICON_COLS = 64, 8

# Paleta de tintes del juego (color_id -> RGB): mediana de las muestras /images/color/{id}.png
# de mhw.poedb.tw (sacadas del juego). 27 = blanco de rareza 12.
PALETTE = {
    0: (251, 252, 252), 1: (251, 115, 135), 2: (101, 207, 144), 3: (121, 166, 255),
    4: (253, 222, 44), 5: (178, 167, 240), 6: (114, 230, 252), 7: (245, 187, 129),
    8: (244, 167, 181), 9: (249, 253, 18), 10: (200, 198, 198), 11: (219, 181, 108),
    12: (178, 230, 214), 13: (90, 154, 80), 14: (204, 51, 108), 15: (111, 107, 240),
    16: (124, 84, 188), 17: (173, 188, 210), 18: (237, 129, 184), 19: (140, 123, 225),
    20: (73, 123, 195), 21: (66, 170, 135), 22: (192, 127, 109), 23: (186, 220, 178),
    24: (242, 219, 168), 25: (250, 145, 96), 26: (177, 213, 86), 27: (255, 255, 255),
}

# Tipo de arma (slug de la BD -> slug de poedb). El icon_id se lee de las paginas cacheadas.
WEAPON_POEDB = {
    "great-sword": "l_sword", "long-sword": "tachi", "sword-and-shield": "sword",
    "dual-blades": "w_sword", "hammer": "hammer", "hunting-horn": "whistle", "lance": "lance",
    "gunlance": "g_lance", "switch-axe": "s_axe", "charge-blade": "c_axe",
    "insect-glaive": "rod", "light-bowgun": "lbg", "heavy-bowgun": "hbg", "bow": "bow",
}
# Piezas de armadura (poedb /eng/armorset/37: Leather Headgear=224 ... Leather Trousers=228),
# talisman = 229 (/eng/charms), conjunto = 230 (/eng/armors/N).
ARMOR_ICONS = {"head": 224, "chest": 225, "arms": 226, "waist": 227, "legs": 228,
               "charm": 229, "armorset": 230}

# color vacio = "background-color:white" (icono sin tenir)
_ITEM_RE = re.compile(r"(?:color/(\d+)\.png\);-webkit-mask-image|background-color:white;background-image)"
                      r":url\(/images/cmn_item00/(\d+)\.png\)'/>"
                      r"</span></td><td><a href='/eng/(?:item|decoration)/(\d+)/[^']*'>([^<]*)</a>")
_WEAPON_RE = re.compile(r"color/(\d+)\.png\);-webkit-mask-image:url\(/images/cmn_item00/(\d+)\.png\)'/>"
                        r"</span><a href='/eng/weapon/")


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(name)).strip().casefold()


def poedb_page(name: str, path: str, refresh: bool = False) -> str:
    """Pagina de poedb cacheada en data/raw/poedb/<name>.html (se descarga si falta)."""
    import time
    import urllib.request

    f = POEDB_DIR / f"{name}.html"
    if refresh or not f.exists() or f.stat().st_size == 0:
        POEDB_DIR.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(f"{POEDB_BASE}/{path}", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            f.write_bytes(r.read())
        time.sleep(0.4)
    return f.read_text(encoding="utf-8")


def read_csv_rows(path: Path) -> list[dict]:
    import csv

    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def atlas_cell(atlas: Image.Image, idx: int, cell: int, cols: int) -> Image.Image:
    x, y = (idx % cols) * cell, (idx // cols) * cell
    return atlas.crop((x, y, x + cell, y + cell))


def tint(cell: Image.Image, color_id: int | None) -> Image.Image:
    """Multiplica el icono (blanco/gris) por el color de la paleta, conservando el alfa."""
    cell = cell.convert("RGBA")
    if color_id is None:
        return cell
    ch = cell.split()
    out = [ch[i].point(lambda v, k=k: v * k // 255) for i, k in enumerate(PALETTE[color_id])]
    return Image.merge("RGBA", (*out, ch[3]))


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- monsters
def poedb_em_table(refresh=False) -> list[dict]:
    s = poedb_page("em", "em", refresh)
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", s, re.S)[1:]:
        c = [re.sub(r"<[^>]*>", "", x).strip() for x in re.findall(r"<td>(.*?)</td>", row, re.S)]
        if len(c) < 4:
            continue
        out.append({"em_code": c[0].replace(" ", "_"),          # "em002 00" -> "em002_00"
                    "name_en": html.unescape(c[1]),
                    "micon_ids": [int(x) for x in c[2].split()], "game_id": int(c[3])})
    return out


def cmd_monsters(args) -> int:
    by_name: dict[str, list[dict]] = {}
    for e in poedb_em_table(args.refresh):
        base = re.sub(r"\s*\((male|female)\)$", "", e["name_en"], flags=re.I)
        by_name.setdefault(_norm(base), []).append(e)
    monsters = read_csv_rows(MHWD / "monsters" / "monster_base.csv")
    micon_dir = UI_RAW / "note" / "tex" / "micon"
    atlas = load_tex(UI_RAW / MICON_ATLAS)
    table, missing = [], []
    for m in monsters:
        mid, name = int(m["id"]), m["name_en"]
        cands = sorted(by_name.get(_norm(name), []), key=lambda e: e["em_code"])
        row = {"monster_id": mid, "name_en": name, "size": m["size"], "em_code": None,
               "file": None, "source": None}
        im = None
        for e in cands:
            stem, var = e["em_code"].rsplit("_", 1)
            f = micon_dir / (f"{stem}_ID.tex" if var == "00" else f"{stem}_{var}_ID.tex")
            if f.exists():
                im = load_tex(f).convert("RGBA").resize((256, 256), Image.LANCZOS)
                row.update(em_code=e["em_code"], source=f.relative_to(UI_RAW).as_posix())
                break
        if im is None and cands:  # sin icono de bestiario: celda del atlas pequeno (64 px)
            e = cands[0]
            im = atlas_cell(atlas, e["micon_ids"][0], MICON_CELL, MICON_COLS).convert("RGBA")
            row.update(em_code=e["em_code"], source=f"{MICON_ATLAS}#{e['micon_ids'][0]}")
        if im is not None:
            row["file"] = f"monsters/{mid}.webp"
            save_webp(im, ICONS_DIR / row["file"])
        else:
            missing.append(row)
        table.append(row)
    write_json(RESEARCH_ICONS / "monster_icons.json", {
        "_source": {"em_map": f"{POEDB_BASE}/em (cache data/raw/poedb/em.html), emparejado por name_en",
                    "icons": "nativePC/ui/note/tex/micon/em*_ID.tex (512 px -> 256 px); si falta, "
                             "celda de common/tex/cmn_micon00_ID.tex (64 px)",
                    "monsters": "MHWorldData monsters/monster_base.csv (mismos id que mhw.monsters)"},
        "monsters": table})
    large = [r for r in table if r["size"] == "large"]
    print(f"[monsters] con icono {sum(1 for r in table if r['file'])}/{len(table)}; "
          f"grandes {sum(1 for r in large if r['file'])}/{len(large)}; desde atlas pequeno: "
          f"{sum(1 for r in table if (r['source'] or '').startswith('common'))}")
    for r in missing:
        print("  SIN ICONO", r["monster_id"], r["name_en"], r["size"])
    return 0


# ---------------------------------------------------------------- items / equipo
def poedb_items(refresh=False) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for cat in ("item", "material", "ammo", "misc"):
        for col, icon, gid, name in _ITEM_RE.findall(poedb_page(f"items_{cat}", f"items/{cat}", refresh)):
            out.setdefault(_norm(name), {"icon_id": int(icon), "color_id": int(col) if col else None,
                                         "game_id": int(gid), "poedb_list": cat})
    return out


def equipment_tables(refresh=False) -> tuple[dict[str, int], dict[int, int]]:
    """(weapon_type de la BD -> icon_id, rareza -> color_id) segun las paginas de armas de poedb."""
    from collections import Counter, defaultdict

    icons: dict[str, Counter] = defaultdict(Counter)
    rarity: dict[int, Counter] = defaultdict(Counter)
    for slug, poe in WEAPON_POEDB.items():
        for r in range(1, 13):
            for col, icon in _WEAPON_RE.findall(poedb_page(f"w_{poe}_{r}", f"weapons/{poe}/{r}", refresh)):
                icons[slug][int(icon)] += 1
                rarity[r][int(col)] += 1

    def unique(c, what):
        if len(c) != 1:
            raise RuntimeError(f"{what} ambiguo: {c}")
        return next(iter(c))

    return ({s: unique(c, f"icono de {s}") for s, c in icons.items()},
            {r: unique(c, f"color de rareza {r}") for r, c in sorted(rarity.items())})


def cmd_items(args) -> int:
    from collections import Counter, defaultdict

    atlas = load_tex(UI_RAW / ITEM_ATLAS)
    po = poedb_items(args.refresh)
    items = read_csv_rows(MHWD / "items" / "item_base.csv")
    # respaldo: icon_name/icon_color de MHWorldData -> ids del juego, por mayoria
    shape, color = defaultdict(Counter), defaultdict(Counter)
    for it in items:
        p = po.get(_norm(it["name_en"]))
        if p:
            shape[it["icon_name"]][p["icon_id"]] += 1
            color[it["icon_color"]][p["color_id"]] += 1
    def confident(counters):  # solo si >= 90 % de los emparejados coinciden (si no, ambiguo)
        out = {}
        for k, v in counters.items():
            (top, n), total = v.most_common(1)[0], sum(v.values())
            if n / total >= 0.9:
                out[k] = top
        return out

    shape_map, color_map = confident(shape), confident(color)
    rows, stats = [], Counter()
    for it in items:
        iid = int(it["id"])
        p = po.get(_norm(it["name_en"]))
        if p:
            icon, col, src = p["icon_id"], p["color_id"], "poedb"
        elif it["icon_name"] in shape_map and it["icon_color"] in color_map:
            icon, col, src = shape_map[it["icon_name"]], color_map[it["icon_color"]], "derived"
        else:
            stats["missing"] += 1
            rows.append({"item_id": iid, "name_en": it["name_en"], "file": None})
            continue
        stats[src] += 1
        save_webp(tint(atlas_cell(atlas, icon, ITEM_CELL, ITEM_COLS), col), ICONS_DIR / "items" / f"{iid}.webp")
        rows.append({"item_id": iid, "name_en": it["name_en"], "icon_id": icon, "color_id": col,
                     "icon_name": it["icon_name"], "icon_color": it["icon_color"],
                     "source": src, "file": f"items/{iid}.webp"})

    # decoraciones: mismo atlas, color por decoracion segun poedb
    deco_po: dict[str, tuple[int, int]] = {}
    for col, icon, gid, name in _ITEM_RE.findall(poedb_page("decorations", "decorations", args.refresh)):
        deco_po.setdefault(_norm(name), (int(icon), int(col) if col else None))
    decos, dstats = [], Counter()
    for d in read_csv_rows(MHWD / "decorations" / "decoration_base.csv"):
        p = deco_po.get(_norm(d["name_en"]))
        if not p:
            dstats["missing"] += 1
            decos.append({"decoration_id": int(d["id"]), "name_en": d["name_en"], "file": None})
            continue
        dstats["poedb"] += 1
        f = f"decorations/{d['id']}.webp"
        save_webp(tint(atlas_cell(atlas, p[0], ITEM_CELL, ITEM_COLS), p[1]), ICONS_DIR / f)
        decos.append({"decoration_id": int(d["id"]), "name_en": d["name_en"], "icon_id": p[0],
                      "color_id": p[1], "file": f})

    # equipo: un icono por tipo y rareza -> equip/{tipo}-{rareza}.webp
    weapon_icons, rarity_colors = equipment_tables(args.refresh)
    equip_icons = {**weapon_icons, **ARMOR_ICONS}
    for kind, icon in equip_icons.items():
        cell = atlas_cell(atlas, icon, ITEM_CELL, ITEM_COLS)
        for r, col in rarity_colors.items():
            save_webp(tint(cell, col), ICONS_DIR / "equip" / f"{kind}-{r}.webp")

    write_json(RESEARCH_ICONS / "item_icons.json", {
        "_source": {
            "atlas": f"nativePC/ui/{ITEM_ATLAS} (16x16 celdas de 64 px; icon_id = fila*16+col)",
            "icon_color_ids": f"{POEDB_BASE}/items/{{item,material,ammo,misc}} y /decorations "
                              "(cache data/raw/poedb), emparejado por name_en",
            "derived": "sin fila en poedb: icon_name/icon_color de MHWorldData -> id si >= 90 % de los emparejados coinciden",
            "palette": "mediana de las muestras de color de poedb; tinte = multiplicacion RGB",
        },
        "palette": {str(k): list(v) for k, v in PALETTE.items()},
        "shape_map": shape_map, "color_map": color_map,
        "items": rows, "decorations": decos})
    write_json(RESEARCH_ICONS / "equip_icons.json", {
        "_source": f"{POEDB_BASE}/weapons/<tipo>/<rareza>, /armorset/37, /charms (cache data/raw/poedb)",
        "file_pattern": "equip/{tipo}-{rareza}.webp (tipo = mhw.weapons.weapon_type, mhw.armor.type, "
                        "'charm' o 'armorset'; rareza 1-12)",
        "icon_ids": equip_icons, "rarity_color_ids": {str(k): v for k, v in rarity_colors.items()}})
    print(f"[items] objetos: {dict(stats)} de {len(items)}; decoraciones: {dict(dstats)}; "
          f"equipo: {len(equip_icons)} tipos x {len(rarity_colors)} rarezas")
    for r in rows:
        if r.get("source") != "poedb":
            print("  ", r["item_id"], r["name_en"], r.get("source"))
    for d in decos:
        if not d["file"]:
            print("   deco sin icono", d["decoration_id"], d["name_en"])
    return 0


# ---------------------------------------------------------------- ingredientes de la cantina
_FOOD_RE = re.compile(r"<tr><td>([^<]*)</td><td><span class='item_icon'><img class='item_icon' "
                      r"style='background-image:url\(/images/color/(\d+)\.png\);-webkit-mask-image:"
                      r"url\(/images/cmn_item00/(\d+)\.png\)'/></span>([^<]*)</td>")


def cmd_food(args) -> int:
    """Iconos de los ingredientes de la cantina (poedb /eng/food) -> data/icons/ingredients/{id}.webp."""
    atlas = load_tex(UI_RAW / ITEM_ATLAS)
    rows = {_norm(n): (int(i), int(c), t) for t, c, i, n in _FOOD_RE.findall(poedb_page("food", "food", args.refresh))}
    seed = json.loads((config.RESEARCH_DIR / "canteen" / "canteen.json").read_text(encoding="utf-8"))
    out_dir = ICONS_DIR / "ingredients"
    table, missing = [], []
    for ing in seed["entries"]["ingredients"]:
        hit = rows.get(_norm(ing["name_en"]))
        if not hit:
            missing.append(ing["name_en"])
            continue
        icon, col, typ = hit
        save_webp(tint(atlas_cell(atlas, icon, ITEM_CELL, ITEM_COLS), col), out_dir / f"{ing['id']}.webp")
        table.append({"ingredient_id": ing["id"], "name_en": ing["name_en"], "icon_id": icon, "color_id": col,
                      "poedb_type": typ, "file": f"ingredients/{ing['id']}.webp"})
    write_json(config.RESEARCH_DIR / "icons" / "ingredient_icons.json",
               {"source": f"{POEDB_BASE}/food", "entries": table})
    print(f"ingredientes: {len(table)} con icono, sin icono: {missing or 'ninguno'}")
    return 0


# ---------------------------------------------------------------- ui-named
# (atlas, celda, columnas, indice, nombre). Identificados a ojo en la hoja de contacto.
UI_NAMED = [
    ("common/tex/cmn_status00_ID.tex", 64, 8, 3, "element-fire"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 4, "element-water"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 5, "element-thunder"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 6, "element-ice"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 7, "element-dragon"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 8, "status-poison"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 10, "status-paralysis"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 11, "status-stun"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 12, "status-sleep"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 13, "status-blast"),
    ("common/tex/cmn_status00_ID.tex", 64, 8, 14, "status-bleed"),
    ("common/tex/cmn_other00_ID.tex", 64, 8, 36, "crown-gold"),
    ("common/tex/cmn_other00_ID.tex", 64, 8, 37, "crown-silver"),
    ("common/tex/cmn_other00_ID.tex", 64, 8, 38, "crown-mini"),
]


def contact_sheet(tiles: list[tuple[str, Image.Image]], out: Path, cols=6, tw=170, th=100) -> None:
    from PIL import ImageDraw

    sheet = Image.new("RGBA", (cols * tw, max(1, -(-len(tiles) // cols)) * th), (34, 30, 26, 255))
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(tiles):
        x, y = (i % cols) * tw, (i // cols) * th
        sheet.alpha_composite(im, (x + (tw - im.width) // 2, y + 6))
        d.text((x + 4, y + 76), label[:27], fill=(240, 230, 210, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)


def cmd_ui_named(args) -> int:
    entries = list(UI_NAMED)
    weapon_icons, _ = equipment_tables(args.refresh)
    entries += [(ITEM_ATLAS, ITEM_CELL, ITEM_COLS, i, f"weapon-{s}") for s, i in weapon_icons.items()]
    entries += [(ITEM_ATLAS, ITEM_CELL, ITEM_COLS, i, f"armor-{k}") for k, i in ARMOR_ICONS.items()]
    cache: dict[str, Image.Image] = {}
    listing, tiles = [], []
    for src, cell, cols, idx, name in entries:
        if src not in cache:
            cache[src] = load_tex(UI_RAW / src)
        im = atlas_cell(cache[src], idx, cell, cols).convert("RGBA")
        save_webp(im, ICONS_DIR / "ui-named" / f"{name}.webp")
        listing.append({"name": name, "file": f"ui-named/{name}.webp", "source": src,
                        "cell": cell, "index": idx})
        tiles.append((name, im))
    write_json(RESEARCH_ICONS / "ui_icons.json", {
        "_source": "celdas de atlas de nativePC/ui (index = fila*columnas+col)", "icons": listing})
    contact_sheet(tiles, DESIGN_OUT / "ui_icons_contact.png")
    print(f"[ui-named] {len(listing)} iconos; hoja: {DESIGN_OUT / 'ui_icons_contact.png'}")
    return 0


def cmd_sheets(args) -> int:
    """Hojas de contacto para revisar: rejilla numerada del atlas de objetos y una muestra de objetos."""
    atlas = load_tex(UI_RAW / ITEM_ATLAS).convert("RGBA")
    contact_sheet([(str(i), atlas_cell(atlas, i, ITEM_CELL, ITEM_COLS)) for i in range(256)],
                  DESIGN_OUT / "item_atlas_grid.png", cols=16, tw=76, th=92)
    data = json.loads((RESEARCH_ICONS / "item_icons.json").read_text(encoding="utf-8"))
    names = set(args.names.split(","))
    picks = [r for r in data["items"] if r["file"] and r["name_en"] in names]
    contact_sheet([(f"{r['item_id']} {r['name_en']}", Image.open(ICONS_DIR / r["file"]).convert("RGBA"))
                   for r in picks], DESIGN_OUT / "item_icons_sample.png")
    mons = json.loads((RESEARCH_ICONS / "monster_icons.json").read_text(encoding="utf-8"))["monsters"]
    contact_sheet([(f"{r['monster_id']} {r['name_en']}",
                    Image.open(ICONS_DIR / r["file"]).convert("RGBA").resize((64, 64), Image.LANCZOS))
                   for r in mons if r["file"]], DESIGN_OUT / "monster_icons_contact.png", cols=10)
    print("[sheets]", DESIGN_OUT)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="mhw_etl.icons")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("convert", help="todos los .tex de data/raw/game/ui -> data/icons/ui/**.webp")
    c.add_argument("--force", action="store_true")
    c.add_argument("--limit", type=int, default=0)
    c.add_argument("--workers", type=int, default=0)
    for name in ("monsters", "items", "food", "ui-named", "all"):
        p = sub.add_parser(name)
        p.add_argument("--refresh", action="store_true", help="vuelve a descargar las paginas de poedb")
    s = sub.add_parser("sheets", help="hojas de contacto en design/out/")
    s.add_argument("--names", default="Potion,Mega Potion,Herb,Honey,Iron Ore,Carbalite Ore,Dragonite Ore,"
                   "Rathalos Ruby,Rathalos Scale,Rathalos Tail,Rathalos Wing,Rathalos Carapace,"
                   "Great Jagras Hide,Anjanath Fang,Odogaron Claw,Nergigante Talon,Firecell Stone,"
                   "Monster Bone S,Paralysis Sac,Kulu-Ya-Ku Beak,Lightcrystal,Wyvern Gem,Large Wyvern Gem,"
                   "Flash Pod,Sleep Herb,Bug Net,Armor Sphere,Large Barrel Bomb,Watcher Lens,Nora Brave Trophy")
    args = ap.parse_args(argv)
    if args.cmd == "all":
        rc = cmd_convert(argparse.Namespace(force=False, limit=0, workers=0))
        for fn in (cmd_monsters, cmd_items, cmd_food, cmd_ui_named, cmd_sheets):
            rc |= fn(argparse.Namespace(refresh=args.refresh, names=s.get_default("names")))
        return rc
    return {"convert": cmd_convert, "monsters": cmd_monsters, "items": cmd_items, "food": cmd_food,
            "ui-named": cmd_ui_named, "sheets": cmd_sheets}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
