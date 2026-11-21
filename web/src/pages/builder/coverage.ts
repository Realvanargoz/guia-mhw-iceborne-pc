/* Utilidades del paso «Probar»: comparación entre versiones (sobre resultados de /builds/evaluate),
   etiquetas de versión y exportar / importar el plan (validado como parseImport). */
import { EvalResult, LoadoutState, SLOTS, SLOT_ES, parseImport } from "../../build";
import { DraftPlan, MAX_TARGETS, Tier } from "./planState";

/* ---------------------------------------------------------------- etiquetas de versión */
export const LABEL_RE = /^v\d{1,3}\.\d{1,3}$/;

/** Etiqueta que propondrá el servidor (misma regla: +0.1 sobre la última, o +1.0 si es mayor). */
export function suggestLabel(labels: string[], major: boolean): string {
  const pairs = labels.filter((l) => LABEL_RE.test(l)).map((l) => l.slice(1).split(".").map(Number) as [number, number]);
  let [a, b] = [1, 0];
  if (pairs.length) {
    if (major) [a, b] = [Math.max(...pairs.map((p) => p[0])) + 1, 0];
    else {
      const last = pairs[pairs.length - 1];
      [a, b] = [last[0], last[1] + 1];
    }
  }
  while (labels.includes(`v${a}.${b}`)) b += 1;
  return `v${a}.${b}`;
}

/* ---------------------------------------------------------------- comparación entre versiones */
export type SkillDiff = { skill_id: number; name: string; from: number; to: number };
export type NumDiff = { label: string; from: number; to: number };
export type PieceDiff = { label: string; from: string; to: string };
export type JewelDiff = { name: string; delta: number };
export type VersionDiff = {
  skillsUp: SkillDiff[];
  skillsDown: SkillDiff[];
  defense: NumDiff[];
  resistances: NumDiff[];
  pieces: PieceDiff[];
  jewels: JewelDiff[];
  same: boolean;
};

const ELEMENT_ES: Record<string, string> = { fire: "Fuego", water: "Agua", thunder: "Rayo", ice: "Hielo", dragon: "Dragón" };
const NONE = "(vacío)";

/** Diferencias de la versión `b` (después) respecto a `a` (antes). */
export function diffEvals(a: EvalResult, b: EvalResult): VersionDiff {
  const lv = (e: EvalResult) => new Map(e.skills.map((s) => [s.skill_id, { level: s.level, name: s.name_es ?? s.name_en ?? `Habilidad #${s.skill_id}` }]));
  const A = lv(a);
  const B = lv(b);
  const skillsUp: SkillDiff[] = [];
  const skillsDown: SkillDiff[] = [];
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const from = A.get(id)?.level ?? 0;
    const to = B.get(id)?.level ?? 0;
    if (from === to) continue;
    const row = { skill_id: id, name: (B.get(id) ?? A.get(id))!.name, from, to };
    (to > from ? skillsUp : skillsDown).push(row);
  }
  const byName = (x: SkillDiff, y: SkillDiff) => x.name.localeCompare(y.name, "es");
  skillsUp.sort(byName);
  skillsDown.sort(byName);

  const defense: NumDiff[] = [];
  for (const [k, label] of [["base", "Defensa base"], ["max", "Defensa máxima"], ["augment_max", "Defensa con aumentos"]] as const) {
    const from = a.defense?.[k] ?? 0;
    const to = b.defense?.[k] ?? 0;
    if (from !== to) defense.push({ label, from, to });
  }
  const resistances: NumDiff[] = [];
  for (const el of Object.keys(ELEMENT_ES)) {
    const from = a.resistances?.[el] ?? 0;
    const to = b.resistances?.[el] ?? 0;
    if (from !== to) resistances.push({ label: `Resistencia a ${ELEMENT_ES[el]}`, from, to });
  }

  const pieces: PieceDiff[] = [];
  const nm = (p?: { name_es?: string | null; name_en?: string } | null) => (p ? p.name_es || p.name_en || "Pieza" : NONE);
  for (const s of SLOTS) {
    const pa = a.pieces?.[s];
    const pb = b.pieces?.[s];
    if ((pa?.id ?? null) !== (pb?.id ?? null)) pieces.push({ label: SLOT_ES[s] ?? s, from: nm(pa), to: nm(pb) });
  }
  if ((a.charm?.id ?? null) !== (b.charm?.id ?? null)) pieces.push({ label: "Amuleto", from: nm(a.charm), to: nm(b.charm) });

  const jw = (e: EvalResult) => {
    const m = new Map<number, { name: string; n: number }>();
    for (const d of e.decorations ?? []) {
      const id = (d.decoration_id ?? d.id) as number;
      const cur = m.get(id) ?? { name: d.name_es ?? `Joya #${id}`, n: 0 };
      cur.n += 1;
      m.set(id, cur);
    }
    return m;
  };
  const JA = jw(a);
  const JB = jw(b);
  const jewels: JewelDiff[] = [];
  for (const id of new Set([...JA.keys(), ...JB.keys()])) {
    const delta = (JB.get(id)?.n ?? 0) - (JA.get(id)?.n ?? 0);
    if (delta) jewels.push({ name: (JB.get(id) ?? JA.get(id))!.name, delta });
  }
  jewels.sort((x, y) => x.name.localeCompare(y.name, "es"));

  const same = !skillsUp.length && !skillsDown.length && !defense.length && !resistances.length && !pieces.length && !jewels.length;
  return { skillsUp, skillsDown, defense, resistances, pieces, jewels, same };
}

/* ---------------------------------------------------------------- exportar / importar el plan */
export const PLAN_FILE_KIND = "mhw-plan";

export function exportPlan(plan: unknown, st: LoadoutState | null, name: string): string {
  return JSON.stringify({ kind: PLAN_FILE_KIND, v: 1, name: name.trim() || "Mi plan", plan, ...(st ? { build: { name: name.trim() || "Mi equipo", state: JSON.parse(JSON.stringify(st)) } } : {}) }, null, 1);
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const idOf = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000 ? x : null);
const idOrNull = (x: unknown, what: string) => {
  if (x == null) return null;
  const n = idOf(x);
  if (n === null) throw new Error(`Plan no válido: ${what} no es un identificador.`);
  return n;
};
const WEAPONS = ["great-sword", "long-sword", "sword-and-shield", "dual-blades", "hammer", "hunting-horn", "lance", "gunlance", "switch-axe", "charge-blade", "insect-glaive", "light-bowgun", "heavy-bowgun", "bow"];
const STYLES = ["bloqueo", "esquiva", "aprendiendo", "multijugador"];
const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").slice(0, max) : null);

/** Valida un plan (objeto ya parseado) y devuelve solo campos conocidos; lanza Error con mensaje en español. */
export function parsePlan(raw: unknown): DraftPlan {
  if (!isObj(raw)) throw new Error("Plan no válido: falta el objeto «plan».");
  const o = isObj(raw.objective) ? raw.objective : {};
  const rank = o.rank === "LR" || o.rank === "HR" || o.rank === "MR" ? o.rank : "HR";
  const wt = typeof o.weapon_type === "string" && WEAPONS.includes(o.weapon_type) ? o.weapon_type : null;
  const slots = Array.isArray(o.weapon_slots) ? o.weapon_slots.slice(0, 3).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4) : [];
  const styles = Array.isArray(o.styles) ? o.styles.filter((s): s is string => typeof s === "string" && STYLES.includes(s)).slice(0, 6) : [];
  const goal = o.goal === "recoleccion" || o.goal === "botin" ? o.goal : null;
  const arch = typeof o.archetype === "string" && o.archetype.length <= 40 && /^[a-z_]*$/.test(o.archetype) ? o.archetype : null;

  if (raw.targets != null && !Array.isArray(raw.targets)) throw new Error("Plan no válido: «targets» debe ser una lista.");
  const tg = (raw.targets as unknown[] | undefined) ?? [];
  if (tg.length > MAX_TARGETS) throw new Error(`Plan no válido: máximo ${MAX_TARGETS} habilidades.`);
  const seen = new Set<number>();
  const targets = tg.map((t) => {
    if (!isObj(t)) throw new Error("Plan no válido: una habilidad no tiene formato de objeto.");
    const sid = idOf(t.skill_id);
    const level = Number(t.level);
    const tier = Number(t.tier);
    if (sid === null || !Number.isInteger(level) || level < 1 || level > 7 || ![1, 2, 3].includes(tier)) throw new Error("Plan no válido: habilidad, nivel (1-7) o prioridad (1-3) fuera de rango.");
    if (seen.has(sid)) throw new Error("Plan no válido: habilidad repetida.");
    seen.add(sid);
    return { skill_id: sid, level, tier: tier as Tier };
  });

  let set_bonus: DraftPlan["set_bonus"] = null;
  if (raw.set_bonus != null) {
    if (!isObj(raw.set_bonus)) throw new Error("Plan no válido: «set_bonus» no es un objeto.");
    const b = idOf(raw.set_bonus.bonus_id);
    const r = Number(raw.set_bonus.required);
    if (b === null || !Number.isInteger(r) || r < 1 || r > 5) throw new Error("Plan no válido: bono de set fuera de rango.");
    set_bonus = { bonus_id: b, required: r };
  }

  const lk = isObj(raw.locks) ? raw.locks : {};
  const decorations = (Array.isArray(lk.decorations) ? lk.decorations : []).slice(0, 24).map((d) => {
    const dd = isObj(d) ? d : {};
    const id = idOf(dd.id);
    if (id === null || typeof dd.piece !== "string" || ![...SLOTS, "weapon"].includes(dd.piece as never)) throw new Error("Plan no válido: joya fijada no válida.");
    return { id, piece: dd.piece };
  });
  const locks = {
    head: idOrNull(lk.head, "pieza fijada"),
    chest: idOrNull(lk.chest, "pieza fijada"),
    arms: idOrNull(lk.arms, "pieza fijada"),
    waist: idOrNull(lk.waist, "pieza fijada"),
    legs: idOrNull(lk.legs, "pieza fijada"),
    charm: idOrNull(lk.charm, "amuleto fijado"),
    decorations,
  };
  const ex = isObj(raw.exclude) ? raw.exclude : {};
  const ids = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).map((x) => idOf(x)).filter((x): x is number => x !== null) : []);
  return {
    objective: {
      weapon_type: wt,
      weapon_slots: slots,
      archetype: arch,
      styles,
      rank,
      cap: o.cap === "full" ? "full" : "progress",
      monster_id: idOf(o.monster_id),
      goal,
      notes: text(o.notes, 500),
    },
    targets,
    set_bonus,
    locks,
    exclude: { armor: ids(ex.armor, 100), charms: ids(ex.charms, 50), decorations: ids(ex.decorations, 50) },
    mode: raw.mode === "owned" ? "owned" : "ideal",
  };
}

/** Texto JSON exportado -> plan validado y, si lo trae, el equipo (validado con parseImport). */
export function parsePlanImport(textJson: string): { plan: DraftPlan; state: LoadoutState | null; name: string } {
  let v: unknown;
  try {
    v = JSON.parse(textJson);
  } catch {
    throw new Error("El texto no es un JSON válido.");
  }
  if (!isObj(v) || v.kind !== PLAN_FILE_KIND || !isObj(v.plan)) throw new Error("No parece un plan exportado de esta guía (falta «kind» o «plan»).");
  const plan = parsePlan(v.plan);
  let state: LoadoutState | null = null;
  if (v.build != null) state = parseImport(JSON.stringify(v.build), 1)[0]?.state ?? null;
  return { plan, state, name: text(v.name, 60) || "Plan importado" };
}
