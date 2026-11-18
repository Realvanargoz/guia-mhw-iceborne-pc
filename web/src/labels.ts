export const TYPE_LABEL: Record<string, string> = {
  item: "Objeto",
  monster: "Monstruo",
  armor: "Pieza de armadura",
  armor_set: "Set de armadura",
  weapon: "Arma",
  decoration: "Adorno",
  charm: "Amuleto",
  skill: "Habilidad",
  quest: "Misión",
  location: "Mapa",
  layered: "Superpuesta",
  achievement: "Logro",
  guide: "Guía",
};

export function entityPath(type: string, id: string | number): string {
  const p: Record<string, string> = {
    item: "/objetos",
    monster: "/monstruos",
    armor: "/armaduras/piezas",
    armor_set: "/armaduras",
    weapon: "/armas",
    decoration: "/adornos",
    charm: "/amuletos",
    skill: "/habilidades",
    quest: "/misiones",
    location: "/mapas",
    layered: "/superpuestas",
    achievement: "/logros",
    guide: "/guias",
  };
  return `${p[type] ?? "/buscar?q="}/${encodeURIComponent(String(id))}`;
}

export const RANK_LABEL: Record<string, string> = { LR: "Rango bajo", HR: "Rango alto", MR: "Rango maestro" };
export const RANK_SHORT: Record<string, string> = { LR: "RB", HR: "RA", MR: "RM" };

export const ARMOR_TYPE: Record<string, string> = {
  head: "Cabeza",
  chest: "Torso",
  arms: "Brazos",
  waist: "Cintura",
  legs: "Piernas",
  full: "Set completo",
  weapon: "Arma",
  other: "Otro",
};

export const WEAPON_TYPE: Record<string, string> = {
  "great-sword": "Gran espada",
  "long-sword": "Espada larga",
  "sword-and-shield": "Espada y escudo",
  "dual-blades": "Espadas dobles",
  hammer: "Martillo",
  "hunting-horn": "Cornamusa",
  lance: "Lanza",
  gunlance: "Lanza pistola",
  "switch-axe": "Hacha espada",
  "charge-blade": "Hacha cargada",
  "insect-glaive": "Glaive insecto",
  "light-bowgun": "Ballesta ligera",
  "heavy-bowgun": "Ballesta pesada",
  bow: "Arco",
};

export const ITEM_CATEGORY: Record<string, string> = {
  material: "Material",
  item: "Objeto",
  misc: "Varios",
  ammo: "Munición",
  account: "Cuenta",
  trade: "Comercio",
  supply: "Suministro",
  appraisal: "Tasación",
};

export const ELEMENTS: [string, string][] = [
  ["fire", "Fuego"],
  ["water", "Agua"],
  ["thunder", "Trueno"],
  ["ice", "Hielo"],
  ["dragon", "Dragón"],
];
export const STATUSES: [string, string][] = [
  ["poison", "Veneno"],
  ["sleep", "Sueño"],
  ["paralysis", "Parálisis"],
  ["blast", "Nitro"],
  ["stun", "Aturdir"],
];
export const ELEMENT_ES: Record<string, string> = Object.fromEntries([
  ...ELEMENTS,
  ...STATUSES,
  ["Fire", "Fuego"],
  ["Water", "Agua"],
  ["Thunder", "Trueno"],
  ["Ice", "Hielo"],
  ["Dragon", "Dragón"],
  ["Poison", "Veneno"],
  ["Sleep", "Sueño"],
  ["Paralysis", "Parálisis"],
  ["Blast", "Nitro"],
]);

export const LAYERED_CATEGORY: Record<string, string> = {
  monster_mr: "Monstruo (Rango maestro)",
  event: "Evento",
  festival: "Festival",
  collab: "Colaboración",
  guild_palace: "Palacio del Gremio",
  comic: "Cómica / mascota",
  other: "Otra",
};
export const OWNER_LABEL: Record<string, string> = { hunter: "Cazador", palico: "Felyne", handler: "Coordinadora" };

export const ACH_CATEGORY: Record<string, string> = {
  story: "Historia",
  hunting: "Caza",
  collection: "Colección",
  crafting: "Fabricación",
  social: "Social",
  misc: "Varios",
  iceborne: "Iceborne",
};

export const QUEST_CATEGORY: Record<string, string> = {
  assigned: "Asignada",
  optional: "Opcional",
  event: "Evento",
  challenge: "Desafío",
  special: "Especial",
  arena: "Arena",
};

export const GUIDE_KIND: Record<string, string> = {
  progression: "Progresión",
  unlock: "Desbloqueo",
  farming: "Farmeo",
  map: "Mapa",
  event: "Evento",
  hunt: "Caza",
  cooking: "Cocina",
  gathering: "Recolección",
  loot: "Botín",
};

export const LOCATION_KIND: Record<string, string> = {
  map: "Mapa de caza",
  arena: "Arena",
  special: "Zona especial",
  siege: "Asedio",
};

/* ------------------------------------------------------------------ Bestiario */
export const ECOLOGY_ES: Record<string, string> = {
  "Bird Wyvern": "Wyvern pájaro",
  "Fanged Wyvern": "Wyvern colmilludo",
  "Brute Wyvern": "Wyvern bruto",
  "Flying Wyvern": "Wyvern volador",
  "Piscine Wyvern": "Wyvern piscino",
  Leviathan: "Leviatán",
  "Elder Dragon": "Dragón anciano",
  "Fanged Beast": "Bestia colmilluda",
  Relict: "Reliquia",
  Temnoceran: "Temnocerano",
  Neopteron: "Neóptero",
  Herbivore: "Herbívoro",
  Amphibian: "Anfibio",
  Carapaceon: "Carapaceon",
  Lynian: "Lynian",
};
export const ecologyEs = (en?: string | null) => (en ? ECOLOGY_ES[en] ?? en : "Monstruo");

export const DAMAGE_ES: Record<string, string> = { cut: "Corte", impact: "Impacto", shot: "Disparo" };

export const BOOK_ELEMENT_ES: Record<string, string> = {
  fire: "Fuego",
  water: "Agua",
  thunder: "Rayo",
  ice: "Hielo",
  dragon: "Draco",
};
export const BOOK_STATUS_ES: Record<string, string> = {
  poison: "Veneno",
  sleep: "Sueño",
  paralysis: "Parálisis",
  blast: "Nitro",
  stun: "Aturdimiento",
};

const PART_BASE_ES: Record<string, string> = {
  Head: "Cabeza",
  Neck: "Cuello",
  Body: "Cuerpo",
  Back: "Lomo",
  "Back Bone": "Espina dorsal",
  Tail: "Cola",
  "Tail tip": "Punta de la cola",
  Forelegs: "Patas delanteras",
  Hindlegs: "Patas traseras",
  Wings: "Alas",
  Belly: "Vientre",
  Stomach: "Abdomen",
  Chest: "Pecho",
  Antennae: "Antenas",
  Arms: "Brazos",
  Forearms: "Antebrazos",
  Ears: "Orejas",
  Legs: "Patas",
  Nose: "Hocico",
  Throat: "Garganta",
  Horns: "Cuernos",
  Horn: "Cuerno",
  Beak: "Pico",
  Claws: "Garras",
  Fin: "Aleta",
  Jaw: "Mandíbula",
  "Chest Shell": "Caparazón del pecho",
  "Weak Shell": "Caparazón débil",
  "Neck Pouch": "Bolsa del cuello",
  "Head Bone": "Hueso de la cabeza",
  "Exhaust Organ (Crater)": "Órgano de escape (cráter)",
  "Exhaust Organ (Large)": "Órgano de escape (grande)",
  "Exhaust Organ (Small)": "Órgano de escape (pequeño)",
  "Left Hindleg Bone": "Hueso de pata trasera izq.",
  "Right Hindleg Bone": "Hueso de pata trasera der.",
  "Left Foreleg": "Pata delantera izq.",
  "Right Foreleg": "Pata delantera der.",
  "Left Hindleg": "Pata trasera izq.",
  "Right Hindleg": "Pata trasera der.",
  "Left Leg": "Pata izq.",
  "Right Leg": "Pata der.",
  "Left Foot": "Pie izq.",
  "Right Foot": "Pie der.",
  "Left Wing": "Ala izq.",
  "Right Wing": "Ala der.",
};
const PART_QUAL_ES: Record<string, string> = {
  Fire: "fuego",
  Mud: "barro",
  Inflated: "inflado",
  Broken: "roto",
  "Critical State": "estado crítico",
  SCritical: "crítico grave",
  Enraged: "enfurecido",
  "Broken+SCritical": "roto y crítico grave",
  Charged: "cargado",
  Dehydrated: "deshidratado",
  Exposed: "expuesto",
  Molten: "fundido",
  Rampage: "frenesí",
  Red: "rojo",
  White: "blanco",
  Released: "liberado",
  "Rock 2": "roca 2",
  Wounded: "herido",
  Sharpened: "afilada",
  "Red Slime": "limo rojo",
};
/** "Head (Broken)" -> "Cabeza (roto)". Unknown words fall back to the English text. */
export function partEs(en?: string | null): string {
  if (!en) return "—";
  const full = PART_BASE_ES[en];
  if (full) return full;
  const m = en.match(/^(.*?)\s*\((.+)\)$/);
  if (!m) return en;
  const base = PART_BASE_ES[m[1]] ?? m[1];
  return `${base} (${PART_QUAL_ES[m[2]] ?? m[2]})`;
}

/** Game-like group names for reward conditions (fallback when condition_es is missing). */
export const REWARD_SECTION_ES: Record<string, string> = {
  carved: "Cortados",
  rewards: "Recompensas",
  dropped: "Material caído",
  broken: "Partes rotas",
  other: "Otras fuentes",
};
export const CONDITION_ES: Record<string, string> = {
  "Body Carve": "Cortados",
  "Carve / Capture": "Cortados",
  "Head Shell Carve": "Cortados",
  "Gold Plating Carved": "Cortados",
  "Tail Carve": "Cola: cortable",
  "Hunt (Bronze)": "Recompensas",
  "Shiny Drop": "Material caído",
  Track: "Rastros",
};
