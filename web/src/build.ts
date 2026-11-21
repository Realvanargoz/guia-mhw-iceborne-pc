/* Constructor / equipo recomendado: tipos, llamadas a la API, catálogos con carga perezosa y persistencia local. */
import { getJson, sendJson } from "./api";
import type { CovRow } from "./pages/builder/planState";

export const SLOTS = ["head", "chest", "arms", "waist", "legs"] as const;
export type SlotId = (typeof SLOTS)[number];
export const SLOT_ES: Record<string, string> = {
  head: "Cabeza",
  chest: "Torso",
  arms: "Brazos",
  waist: "Cintura",
  legs: "Piernas",
  charm: "Amuleto",
  weapon: "Arma",
};
export const ELEMENTS = ["fire", "water", "thunder", "ice", "dragon"] as const;

export type PieceInfo = {
  id: number;
  type: string;
  name_es: string | null;
  name_en: string;
  set_id?: number | null;
  set_name_es?: string | null;
  set_name_en?: string | null;
  rarity: number;
  rank: string;
  slots: number[];
  defense_base?: number;
  defense_max?: number;
  resistances?: Record<string, number>;
  owned?: boolean;
};
export type CharmInfo = {
  id: number;
  name_es: string | null;
  name_en: string;
  rarity: number;
  generic_es?: string;
  skills?: { skill_id: number; name_es?: string | null; level: number }[];
  owned?: boolean;
};
export type DecoInfo = {
  decoration_id: number;
  piece?: string;
  slot_size?: number;
  name_es: string | null;
  name_en: string;
  size: number;
  rarity: number;
  difficulty?: string;
  skills: { skill_id: number; name_es?: string | null; level: number }[];
  owned?: boolean;
};
export type SkillRow = { skill_id: number; name_es: string | null; name_en?: string; level: number; max: number; points?: number; source?: unknown[] };
export type Defense = { base: number; max: number; augment_max: number; note_es?: string };
export type Build = {
  name_es: string;
  pieces: PieceInfo[];
  charm: CharmInfo | null;
  decorations: DecoInfo[];
  slots_free: { piece: string; size: number }[];
  skills: SkillRow[];
  set_bonuses: { bonus_id: number; name_es: string; skill_es: string; required: number; pieces: number; active: boolean }[];
  defense: Defense;
  resistances: Record<string, number>;
  defense_score?: number;
  offense_score?: number;
  score?: number;
  why_es: string[];
  gaps_es: string[];
  swap_hints: { tipo: string; text_es: string }[];
  warnings: string[];
};
export type MonsterBuilds = {
  monster: { id: number; name_es: string | null; name_en: string };
  rank: string;
  cap: string;
  available?: boolean;
  related?: { id: number; name_es: string | null; name_en: string }[];
  disclaimer_es: string;
  owned_mode?: boolean;
  owned_available: boolean | null;
  rules_version?: number;
  profile?: { ailments: string[]; elements: string[] };
  constraints?: Record<string, unknown>;
  builds: Build[];
  notes: string[];
  sources: { id: string; title: string; url: string }[];
  elapsed_ms?: number;
};
export type EvalResult = {
  pieces: Record<string, PieceInfo>;
  charm: CharmInfo | null;
  skills: SkillRow[];
  set_bonuses: Build["set_bonuses"];
  defense: Defense;
  resistances: Record<string, number>;
  decorations: { piece: string; slot_size: number; decoration_id?: number; id?: number; name_es: string | null; skills: unknown[] }[];
  slots_total: { piece: string; size: number }[];
  slots_used: number | { piece: string; size: number }[];
  slots_free: { piece: string; size: number }[];
  warnings: string[];
  disclaimer_es: string;
  /** solo si se envían `targets` a /builds/evaluate */
  coverage?: CovRow[];
};

export function monsterBuildsPath(id: number | string, rank: string, owned: boolean, cap: string, weapon?: number[]) {
  const q = new URLSearchParams({ rank });
  if (owned) q.set("owned", "1");
  if (cap !== "progress") q.set("cap", cap);
  if (weapon?.length) q.set("weapon_slots", weapon.join(","));
  return `/builds/monster/${id}?${q}`;
}

export function goalBuildsPath(goal: string, rank: string, owned: boolean, cap: string) {
  const q = new URLSearchParams({ rank, cap: cap === "full" ? "full" : "progress" });
  if (owned) q.set("owned", "1");
  return `/builds/goal/${goal}?${q}`;
}

export type EvalTarget = { skill_id: number; level: number; tier: 1 | 2 | 3 };
export function evaluate(
  state: LoadoutState,
  signal?: AbortSignal,
  targets?: EvalTarget[],
): Promise<EvalResult> {
  const decorations: { id: number; piece: string }[] = [];
  for (const p of [...SLOTS, "weapon"] as string[]) {
    const ids = (state.decos[p] ?? []).filter((x): x is number => x != null);
    for (const id of ids) decorations.push({ id, piece: p });
  }
  const body = {
    pieces: { head: state.pieces.head?.id ?? null, chest: state.pieces.chest?.id ?? null, arms: state.pieces.arms?.id ?? null, waist: state.pieces.waist?.id ?? null, legs: state.pieces.legs?.id ?? null, charm: state.charm?.id ?? null },
    decorations,
    weapon_slots: state.weapon,
    ...(targets?.length ? { targets: targets.slice(0, 20) } : {}),
  };
  return postJson<EvalResult>("/builds/evaluate", body, signal);
}

const postJson = <T,>(path: string, body: unknown, signal?: AbortSignal) => sendJson<T>("POST", path, body, signal);

/* ---------------------------------------------------------------- loadout state */
export type LoadoutState = {
  pieces: Partial<Record<SlotId, PieceInfo | null>>;
  charm: CharmInfo | null;
  /** por pieza (head..legs, weapon): decoración elegida por cada ranura (mismo orden que slots) */
  decos: Record<string, (number | null)[]>;
  /** tamaños de ranura del arma (1-4) */
  weapon: number[];
};
export const emptyLoadout = (): LoadoutState => ({ pieces: {}, charm: null, decos: {}, weapon: [] });

/** Coloca las joyas de una recomendación en las ranuras de cada pieza (mayores primero). */
export function loadoutFromBuild(b: Build, weapon: number[] = []): LoadoutState {
  const st: LoadoutState = { pieces: {}, charm: b.charm, decos: {}, weapon };
  for (const p of b.pieces) st.pieces[p.type as SlotId] = p;
  for (const p of SLOTS) {
    const piece = st.pieces[p];
    if (!piece) continue;
    const ds = b.decorations.filter((d) => d.piece === p).sort((a, c) => (c.size ?? 0) - (a.size ?? 0));
    const arr: (number | null)[] = piece.slots.map(() => null);
    const order = piece.slots.map((s, i) => [s, i] as const).sort((a, c) => c[0] - a[0]);
    for (const d of ds) {
      const hit = order.find(([s, i]) => arr[i] == null && s >= d.size);
      if (hit) arr[hit[1]] = d.decoration_id;
    }
    st.decos[p] = arr;
  }
  return st;
}

/** Ajusta el arreglo de joyas de una pieza al número de ranuras (recorta o rellena). */
export function fitDecos(arr: (number | null)[] | undefined, n: number): (number | null)[] {
  return Array.from({ length: n }, (_, i) => arr?.[i] ?? null);
}

/* ---------------------------------------------------------------- catálogos (un endpoint de lista por catálogo) */
export type DecoCat = { id: number; name_es: string | null; name_en: string; slot: number; rarity: number; skills: { skill_id: number; name_es: string | null; level: number }[] };
export type CharmCat = { id: number; name_es: string | null; name_en: string; rarity: number; skills: { skill_id: number; name_es: string | null; level: number }[] };

const memo = new Map<string, Promise<unknown>>();
export function once<T>(key: string, f: () => Promise<T>): Promise<T> {
  if (!memo.has(key)) {
    const p = f().catch((e) => {
      memo.delete(key);
      throw e;
    });
    memo.set(key, p);
  }
  return memo.get(key) as Promise<T>;
}

type SkillRef = { skill_id: number; name_es: string | null; level: number };
const skillRefs = (a: SkillRef[] | undefined): SkillRef[] => (a ?? []).map((s) => ({ skill_id: s.skill_id, name_es: s.name_es, level: s.level }));

export const loadDecorations = () =>
  once("decos", async () => {
    const rows = await getJson<(DecoCat & Record<string, unknown>)[]>("/decorations");
    const out = rows.map<DecoCat>((d) => ({ id: d.id, name_es: d.name_es, name_en: d.name_en, slot: d.slot, rarity: d.rarity, skills: skillRefs(d.skills) }));
    return out.sort((a, b) => a.slot - b.slot || a.id - b.id);
  });

export const loadCharms = () =>
  once("charms", async () => {
    const rows = await getJson<(CharmCat & Record<string, unknown>)[]>("/charms");
    const out = rows.map<CharmCat>((c) => ({ id: c.id, name_es: c.name_es, name_en: c.name_en, rarity: c.rarity, skills: skillRefs(c.skills) }));
    return out.sort((a, b) => b.rarity - a.rarity || (a.name_es ?? "").localeCompare(b.name_es ?? "", "es"));
  });

export type ArmorCat = PieceInfo & { skills: { skill_id: number; name_es: string | null; level: number }[]; set_rarity?: number };
/* eslint-disable @typescript-eslint/no-explicit-any */
export const loadArmor = (rank: string, _onProgress?: (n: number, total: number) => void) =>
  once(`armor:${rank}`, async () => {
    const rows = await getJson<Record<string, any>[]>(`/armor-pieces?rank=${encodeURIComponent(rank.toLowerCase())}`);
    return rows.map<ArmorCat>((p) => ({
      id: p.id,
      type: p.type,
      name_es: p.name_es,
      name_en: p.name_en,
      set_id: p.armor_set_id ?? null,
      set_name_es: p.set?.name_es ?? null,
      set_name_en: p.set?.name_en ?? null,
      rarity: p.rarity,
      rank: p.rank,
      slots: [p.slot_1, p.slot_2, p.slot_3].filter((s) => s) as number[],
      defense_base: p.defense_base,
      defense_max: p.defense_max,
      resistances: { fire: p.res_fire, water: p.res_water, thunder: p.res_thunder, ice: p.res_ice, dragon: p.res_dragon },
      skills: skillRefs(p.skills),
    }));
  });
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------------------------------------------------------------- equipo en propiedad */
export type OwnedGear = { available: boolean; armor: Map<number, number>; decorations: Map<number, number>; charms: Map<number, number> };
export const loadOwned = () =>
  once<OwnedGear>("owned", async () => {
    try {
      const r = await getJson<{ available?: boolean; empty?: boolean; armor?: { id: number; count: number }[]; decorations?: { id: number; count: number }[]; charms?: { id: number; count: number }[] }>("/profile/equipment");
      const m = (a?: { id: number; count: number }[]) => new Map((a ?? []).map((x) => [x.id, x.count ?? 1]));
      const ok = r.available !== false && !r.empty && (r.armor?.length ?? 0) > 0;
      return { available: ok, armor: m(r.armor), decorations: m(r.decorations), charms: m(r.charms) };
    } catch {
      return { available: false, armor: new Map(), decorations: new Map(), charms: new Map() };
    }
  });

/* ---------------------------------------------------------------- composiciones guardadas (API /builds/saved) */
export type SavedBuild = { id: string; name: string; updated: number; state: LoadoutState };
export type SavedRow = { id: number; name: string; payload: Record<string, unknown>; created_at?: string | null; updated_at?: string | null };
export const SAVED_PATH = "/builds/saved";
export const MAX_SAVED = 200;
const OLD_KEY = "mhw.builder.builds.v1";
const MIGRATED_KEY = "mhw.builder.migrated.v1";

const ts = (v?: string | null) => {
  const n = v ? Date.parse(v.includes("T") || v.endsWith("Z") ? v : `${v.replace(" ", "T")}Z`) : NaN;
  return Number.isFinite(n) ? n : Date.now();
};

/** LoadoutState -> payload de la API (head..legs, charm, decos, weapon). */
export function toPayload(st: LoadoutState): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const k of SLOTS) p[k] = st.pieces[k] ?? null;
  p.charm = st.charm ?? null;
  p.decos = st.decos ?? {};
  p.weapon = st.weapon ?? [];
  return p;
}

/** Fila de la API -> SavedBuild (id numérico convertido a texto). */
export function fromRow(r: SavedRow): SavedBuild {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const obj = (x: unknown) => (x && typeof x === "object" ? x : null);
  const pieces: Record<string, unknown> = {};
  for (const k of SLOTS) {
    const o = obj(p[k]);
    if (o) pieces[k] = o;
  }
  return {
    id: String(r.id),
    name: r.name,
    updated: ts(r.updated_at ?? r.created_at),
    state: {
      pieces: pieces as LoadoutState["pieces"],
      charm: obj(p.charm) as LoadoutState["charm"],
      decos: (obj(p.decos) as LoadoutState["decos"]) ?? {},
      weapon: Array.isArray(p.weapon) ? (p.weapon as number[]) : [],
    },
  };
}

/** Mensaje legible en español para un error de la API de composiciones. */
export function savedErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/413/.test(m) || /demasiado grande/i.test(m)) return "El equipo guardado es demasiado grande (máx. 64 KB).";
  if (/409/.test(m) || /M[aá]ximo/i.test(m)) return `Has llegado al máximo de ${MAX_SAVED} equipos guardados; borra alguno antes de guardar otro.`;
  if (/422/.test(m)) return "Los datos del equipo no son válidos (nombre o contenido).";
  if (/404/.test(m) || /No se encontr/i.test(m)) return "Ese equipo ya no existe en el servidor.";
  return m || "No se pudo completar la operación.";
}

export const createSaved = async (name: string, state: LoadoutState, plan?: unknown) =>
  fromRow(await sendJson<SavedRow>("POST", SAVED_PATH, { name, payload: toPayload(state), ...(plan ? { plan } : {}) }));
export const updateSaved = async (id: string, patch: { name?: string; state?: LoadoutState; plan?: unknown }) =>
  fromRow(
    await sendJson<SavedRow>("PUT", `${SAVED_PATH}/${encodeURIComponent(id)}`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.state ? { payload: toPayload(patch.state) } : {}),
      ...(patch.plan ? { plan: patch.plan } : {}),
    }),
  );
export const deleteSaved = (id: string) => sendJson("DELETE", `${SAVED_PATH}/${encodeURIComponent(id)}`);

/**
 * Migración única desde localStorage (se deja el original intacto como copia de seguridad).
 * Devuelve las composiciones creadas en la API.
 */
export async function migrateLocalSaved(existing: SavedBuild[]): Promise<SavedBuild[]> {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return [];
  } catch {
    return [];
  }
  let local: SavedBuild[] = [];
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) local = parseImport(JSON.stringify(arr.filter((b) => b && typeof b === "object" && b.state && typeof b.state === "object")), MAX_SAVED);
    }
  } catch {
    local = [];
  }
  const keyOf = (b: SavedBuild) => `${b.name}\u0000${JSON.stringify(toPayload(b.state))}`;
  const seen = new Set(existing.map(keyOf));
  const created: SavedBuild[] = [];
  let room = MAX_SAVED - existing.length;
  try {
    // las más recientes estaban primero: se envían de más antigua a más nueva para conservar el orden
    for (const b of [...local].reverse()) {
      if (room <= 0) break;
      if (seen.has(keyOf(b))) continue;
      created.unshift(await createSaved(b.name, b.state));
      room--;
    }
  } catch (e) {
    // error de red/validación: no se marca como migrado, se reintenta en la próxima apertura (salvo límite alcanzado)
    if (!/409|M[aá]ximo/i.test(e instanceof Error ? e.message : "")) throw Object.assign(new Error(savedErrorMessage(e)), { created });
  }
  try {
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    /* sin almacenamiento */
  }
  return created;
}

/** Valida el JSON importado: devuelve las composiciones o lanza un Error con motivo legible. */
export function parseImport(text: string, max = 50): SavedBuild[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("El texto no es un JSON válido.");
  }
  const arr = (Array.isArray(v) ? v : [v]).slice(0, max);
  const id = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000 ? x : null);
  const out: SavedBuild[] = [];
  for (const raw of arr) {
    const b = raw as Partial<SavedBuild> | null;
    if (!b || typeof b !== "object" || !b.state || typeof b.state !== "object") throw new Error("Formato no reconocido: falta «state».");
    const s = b.state as Partial<LoadoutState>;
    const pieces: Record<string, any> = {};
    if (s.pieces && typeof s.pieces === "object") {
      for (const k of SLOTS) {
        const p = (s.pieces as any)[k];
        if (p && typeof p === "object" && id(p.id) !== null) pieces[k] = p;
      }
    }
    const decos: Record<string, (number | null)[]> = {};
    if (s.decos && typeof s.decos === "object") {
      for (const k of ["head", "chest", "arms", "waist", "legs", "weapon"]) {
        const d = (s.decos as any)[k];
        if (Array.isArray(d)) decos[k] = d.slice(0, 4).map(id);
      }
    }
    const charm = s.charm && typeof s.charm === "object" && id((s.charm as any).id) !== null ? s.charm : null;
    out.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: typeof b.name === "string" && b.name.trim() ? b.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || "Importado" : "Importado",
      updated: Date.now(),
      state: {
        pieces: pieces as LoadoutState["pieces"],
        charm: charm as LoadoutState["charm"],
        decos,
        weapon: Array.isArray(s.weapon) ? s.weapon.slice(0, 4).map(Number).filter((n) => n >= 1 && n <= 4) : [],
      },
    });
  }
  return out;
}

export const difficultyTone = (d?: string) => {
  const t = (d ?? "").toLowerCase();
  return t.startsWith("rar") ? "rare" : t.startsWith("dif") ? "hard" : "normal";
};
