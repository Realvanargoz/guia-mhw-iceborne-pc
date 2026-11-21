/* Estado del asistente del constructor (método de Dem): objetivo, habilidades con prioridad, bono de set y modo. */
import { Build, CharmInfo, DecoInfo, Defense, LoadoutState, PieceInfo, SLOTS, SlotId, loadoutFromBuild } from "../../build";

export type Rank = "LR" | "HR" | "MR";
export type Tier = 1 | 2 | 3;
export type StepId = "objetivo" | "habilidades" | "bono" | "prioridades" | "armadura" | "joyas" | "probar";
export type Mode = "owned" | "ideal";

export const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: "objetivo", label: "Objetivo", short: "Objetivo" },
  { id: "habilidades", label: "Habilidades", short: "Habilidades" },
  { id: "bono", label: "Bono de set", short: "Bono" },
  { id: "prioridades", label: "Prioridades", short: "Prioridades" },
  { id: "armadura", label: "Armadura", short: "Armadura" },
  { id: "joyas", label: "Joyas y amuleto", short: "Joyas" },
  { id: "probar", label: "Probar", short: "Probar" },
];
export const STEP_IDS = STEPS.map((s) => s.id) as StepId[];
export const isStep = (v: string | null | undefined): v is StepId => !!v && (STEP_IDS as string[]).includes(v);

export const TIER_NAME: Record<Tier, string> = { 1: "Primaria", 2: "Secundaria", 3: "Terciaria" };
export const MAX_TARGETS = 20;

export type Target = { skill_id: number; level: number; tier: Tier; origin?: string; why_es?: string };
export type Objective = {
  weapon_type: string | null;
  weapon_slots: number[];
  archetype: string | null;
  styles: string[];
  rank: Rank;
  cap: "progress" | "full";
  monster_id: number | null;
  goal: "recoleccion" | "botin" | null;
  notes: string | null;
};
export type SetBonusSel = { bonus_id: number; required: number };
export type Locks = {
  head: number | null;
  chest: number | null;
  arms: number | null;
  waist: number | null;
  legs: number | null;
  charm: number | null;
  decorations: { id: number; piece: string }[];
};
export type Exclude = { armor: number[]; charms: number[]; decorations: number[] };

/** Respuesta de /api/builds/plan/template. */
export type Template = {
  objective: { type: string; rank?: string; name_es?: string };
  targets: { skill_id: number; name_es: string; level: number; tier: Tier; why_es: string; origin: string }[];
  set_bonus_suggestion: { bonus_ids: number[]; names_es: string[]; reason_es: string } | null;
  discard_hints: { skill_id: number; name_es: string; why_es: string }[];
  notes_es: string[];
};
/** Ayudas de la última plantilla aplicada (no se guardan en el borrador). */
export type Hints = {
  discard: Template["discard_hints"];
  notes: string[];
  bonus: Template["set_bonus_suggestion"];
  title: string | null;
};


/* ---------------------------------------------------------------- resultados del buscador (POST /builds/plan/solve) */
export type Loadout = { pieces: Record<string, number>; charm: number | null; decorations: { id: number; piece: string }[]; weapon_slots: number[] };
export type CovStatus = "ok" | "parcial" | "falta";
export type CovRow = {
  skill_id: number;
  name_es: string;
  tier: Tier;
  target: number;
  achieved: number;
  cap: number;
  cap_unlocked_by: string | null;
  from: { armadura: number; amuleto: number; joya: number };
  bonus: boolean;
  status: CovStatus;
  reason: "cap_locked" | "no_jewel" | "jewel_not_owned" | "no_slot" | null;
  text_es: string;
};
export type ResultPiece = (PieceInfo & { locked: boolean; aporta_es?: string; empty?: false }) | { type: string; empty: true; locked: false };
export type ResultCharm = CharmInfo & { generic_es?: string; locked: boolean; owned?: boolean };
export type ResultDeco = DecoInfo & { decoration_id: number; locked: boolean };
export type MissingJewel = { decoration_id: number; name_es: string; count: number; covers_es: string; difficulty: string; text_es: string };
export type SolveResult = {
  name_es: string;
  scenario_es?: string | null;
  loadout: Loadout;
  pieces: ResultPiece[];
  charm: ResultCharm | null;
  decorations: ResultDeco[];
  deficit: { t1: number; t2: number; t3: number };
  set_bonuses: Build["set_bonuses"];
  defense: Defense;
  resistances: Record<string, number>;
  slots_free: { piece: string; size: number }[];
  warnings: string[];
  coverage: CovRow[];
  tradeoffs_es: string[];
  missing: { jewels: MissingJewel[]; pieces: number[]; charm_owned: boolean | null };
};
export type SolveResponse = {
  mode: Mode;
  owned_available: boolean;
  scenario_notes_es: string[];
  notes: string[];
  results: SolveResult[];
  truncated: boolean;
  elapsed_ms: number;
  cached?: boolean;
};
export type SolveMeta = { scenario_notes: string[]; notes: string[]; truncated: boolean; elapsed_ms: number; mode: Mode; owned_available: boolean; sig: string };

/** Pasa el resultado del buscador al formato del editor (piezas, amuleto, joyas por ranura y ranuras del arma). */
export function loadoutFromResult(r: SolveResult): LoadoutState {
  const weapon = r.loadout.weapon_slots ?? [];
  const b = {
    pieces: r.pieces.filter((p) => !p.empty),
    charm: r.charm,
    decorations: r.decorations,
  } as unknown as Build;
  const st = loadoutFromBuild(b, weapon);
  const ds = r.decorations.filter((d) => d.piece === "weapon").sort((a, c) => c.size - a.size);
  const arr: (number | null)[] = weapon.map(() => null);
  const order = weapon.map((s, i) => [s, i] as const).sort((a, c) => c[0] - a[0]);
  for (const d of ds) {
    const hit = order.find(([s, i]) => arr[i] == null && s >= d.size);
    if (hit) arr[hit[1]] = d.decoration_id;
  }
  if (weapon.length) st.decos.weapon = arr;
  return st;
}

/** Fija todas las piezas y el amuleto del resultado (conserva las joyas ya fijadas de esas piezas). */
export function lockBase(locks: Locks, r: SolveResult): Locks {
  const next: Locks = { ...locks, decorations: [...locks.decorations] };
  for (const s of SLOTS) next[s] = r.loadout.pieces[s] ?? null;
  next.charm = r.loadout.charm;
  next.decorations = next.decorations.filter((d) => d.piece === "weapon" || next[d.piece as SlotId] != null);
  return next;
}

export type PlanState = {
  objective: Objective;
  targets: Target[];
  set_bonus: SetBonusSel | null;
  mode: Mode;
  locks: Locks;
  exclude: Exclude;
  step: StepId;
  dirty: boolean;
  hints: Hints | null;
  /** resultados del buscador (no se guardan en el borrador) */
  results: SolveResult[];
  selected: number;
  solved: SolveMeta | null;
  /** base elegida y editable (copia del loadout del resultado seleccionado) */
  loadout: Loadout | null;
};

export const emptyObjective = (): Objective => ({
  weapon_type: null,
  weapon_slots: [],
  archetype: null,
  styles: [],
  rank: "HR",
  cap: "progress",
  monster_id: null,
  goal: null,
  notes: null,
});
export const emptyLocks = (): Locks => ({ head: null, chest: null, arms: null, waist: null, legs: null, charm: null, decorations: [] });

export const initialPlan = (): PlanState => ({
  objective: emptyObjective(),
  targets: [],
  set_bonus: null,
  mode: "ideal",
  locks: emptyLocks(),
  exclude: { armor: [], charms: [], decorations: [] },
  step: "objetivo",
  dirty: false,
  hints: null,
  results: [],
  selected: 0,
  solved: null,
  loadout: null,
});

/** Lo que se guarda en el borrador (sin ayudas ni nombres). */
export type DraftPlan = {
  objective: Objective;
  targets: { skill_id: number; level: number; tier: Tier }[];
  set_bonus: SetBonusSel | null;
  locks: Locks;
  exclude: Exclude;
  mode: Mode;
};
export type Draft = { plan: Partial<DraftPlan>; step?: string; saved_id?: number | null };

export type Action =
  | { type: "setObjective"; patch: Partial<Objective> }
  | { type: "applyTemplate"; template: Template; silent?: boolean }
  | { type: "addTarget"; target: Target }
  | { type: "removeTarget"; skill_id: number }
  | { type: "setLevel"; skill_id: number; level: number }
  | { type: "setTier"; skill_id: number; tier: Tier }
  | { type: "moveTarget"; skill_id: number; dir: -1 | 1 }
  | { type: "setSetBonus"; bonus: SetBonusSel | null }
  | { type: "setMode"; mode: Mode }
  | { type: "setStep"; step: StepId }
  | { type: "loadDraft"; draft: Draft }
  | { type: "solved"; resp: SolveResponse; sig: string }
  | { type: "pickResult"; index: number }
  | { type: "toggleLock"; kind: "piece"; slot: SlotId; id: number }
  | { type: "toggleLock"; kind: "charm"; id: number }
  | { type: "toggleLock"; kind: "deco"; id: number; piece: string; pieceId: number | null; locked: boolean }
  | { type: "setLocks"; locks: Locks }
  | { type: "excludePiece"; id: number }
  | { type: "unexcludePiece"; id: number }
  | { type: "markSaved" }
  | { type: "reset" };

const clampLevel = (n: number) => Math.max(1, Math.min(7, Math.round(n) || 1));
const asTier = (n: number): Tier => (n === 1 || n === 2 || n === 3 ? n : 3);

export function planReducer(s: PlanState, a: Action): PlanState {
  const touch = (p: Partial<PlanState>): PlanState => ({ ...s, ...p, dirty: true });
  switch (a.type) {
    case "setObjective":
      return touch({ objective: { ...s.objective, ...a.patch } });
    case "applyTemplate": {
      const targets: Target[] = a.template.targets.slice(0, MAX_TARGETS).map((t) => ({
        skill_id: t.skill_id,
        level: clampLevel(t.level),
        tier: asTier(t.tier),
        origin: t.origin,
        why_es: t.why_es,
      }));
      const hints: Hints = {
        discard: a.template.discard_hints,
        notes: a.template.notes_es,
        bonus: a.template.set_bonus_suggestion,
        title: a.template.objective?.name_es ?? null,
      };
      return { ...s, targets, hints, dirty: a.silent ? s.dirty : true };
    }
    case "addTarget":
      if (s.targets.length >= MAX_TARGETS || s.targets.some((t) => t.skill_id === a.target.skill_id)) return s;
      return touch({ targets: [...s.targets, { ...a.target, level: clampLevel(a.target.level), tier: asTier(a.target.tier) }] });
    case "removeTarget":
      return touch({ targets: s.targets.filter((t) => t.skill_id !== a.skill_id) });
    case "setLevel":
      return touch({ targets: s.targets.map((t) => (t.skill_id === a.skill_id ? { ...t, level: clampLevel(a.level) } : t)) });
    case "setTier": {
      const t = s.targets.find((x) => x.skill_id === a.skill_id);
      if (!t || t.tier === a.tier) return s;
      // al cambiar de prioridad pasa al final de la nueva lista
      const rest = s.targets.filter((x) => x.skill_id !== a.skill_id);
      let at = 0;
      rest.forEach((x, i) => {
        if (x.tier <= a.tier) at = i + 1;
      });
      rest.splice(at, 0, { ...t, tier: a.tier });
      return touch({ targets: rest });
    }
    case "moveTarget": {
      const i = s.targets.findIndex((t) => t.skill_id === a.skill_id);
      if (i < 0) return s;
      const tier = s.targets[i].tier;
      let j = i + a.dir;
      while (j >= 0 && j < s.targets.length && s.targets[j].tier !== tier) j += a.dir;
      if (j < 0 || j >= s.targets.length) return s;
      const next = s.targets.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return touch({ targets: next });
    }
    case "setSetBonus":
      return touch({ set_bonus: a.bonus });
    case "setMode":
      return touch({ mode: a.mode });
    case "setStep":
      return s.step === a.step ? s : { ...s, step: a.step };
    case "loadDraft": {
      const p = a.draft.plan ?? {};
      const base = initialPlan();
      return {
        ...base,
        objective: {
          ...base.objective,
          ...(p.objective ?? {}),
          weapon_slots: p.objective?.weapon_slots ?? [],
          styles: p.objective?.styles ?? [],
          rank: p.objective?.rank ?? base.objective.rank,
          cap: p.objective?.cap ?? base.objective.cap,
        },
        targets: (p.targets ?? []).map((t) => ({ skill_id: t.skill_id, level: clampLevel(t.level), tier: asTier(t.tier) })),
        set_bonus: p.set_bonus ?? null,
        mode: p.mode === "owned" ? "owned" : "ideal",
        locks: { ...base.locks, ...(p.locks ?? {}) },
        exclude: { ...base.exclude, ...(p.exclude ?? {}) },
        step: isStep(a.draft.step) ? a.draft.step : "objetivo",
        dirty: false,
      };
    }
    case "solved": {
      const m: SolveMeta = {
        scenario_notes: a.resp.scenario_notes_es ?? [],
        notes: a.resp.notes ?? [],
        truncated: !!a.resp.truncated,
        elapsed_ms: a.resp.elapsed_ms ?? 0,
        mode: a.resp.mode,
        owned_available: a.resp.owned_available,
        sig: a.sig,
      };
      return { ...s, results: a.resp.results, selected: 0, solved: m, loadout: a.resp.results[0]?.loadout ?? null };
    }
    case "pickResult": {
      const r = s.results[a.index];
      return r ? { ...s, selected: a.index, loadout: r.loadout } : s;
    }
    case "toggleLock": {
      const L = s.locks;
      if (a.kind === "piece") {
        const on = L.decorations.filter((d) => d.piece !== a.slot);
        return L[a.slot] === a.id ? touch({ locks: { ...L, [a.slot]: null, decorations: on } }) : touch({ locks: { ...L, [a.slot]: a.id } });
      }
      if (a.kind === "charm") return touch({ locks: { ...L, charm: L.charm === a.id ? null : a.id } });
      if (a.locked) {
        const i = L.decorations.map((d) => d.id === a.id && d.piece === a.piece).lastIndexOf(true);
        if (i < 0) return s;
        return touch({ locks: { ...L, decorations: L.decorations.filter((_, k) => k !== i) } });
      }
      const next: Locks = { ...L, decorations: [...L.decorations, { id: a.id, piece: a.piece }] };
      if (a.piece !== "weapon" && a.pieceId != null) next[a.piece as SlotId] = a.pieceId; // una joya fijada exige la pieza fijada
      return touch({ locks: next });
    }
    case "setLocks":
      return touch({ locks: a.locks });
    case "excludePiece": {
      if (s.exclude.armor.includes(a.id)) return s;
      const L = { ...s.locks, decorations: [...s.locks.decorations] };
      for (const sl of SLOTS)
        if (L[sl] === a.id) {
          L[sl] = null;
          L.decorations = L.decorations.filter((d) => d.piece !== sl);
        }
      return touch({ exclude: { ...s.exclude, armor: [...s.exclude.armor, a.id] }, locks: L });
    }
    case "unexcludePiece":
      return touch({ exclude: { ...s.exclude, armor: s.exclude.armor.filter((x) => x !== a.id) } });
    case "markSaved":
      return s.dirty ? { ...s, dirty: false } : s;
    case "reset":
      return { ...initialPlan(), step: s.step };
  }
}

/** True si el plan tiene algo que merezca guardarse. */
export const hasContent = (s: PlanState) =>
  s.targets.length > 0 || !!(s.objective.weapon_type || s.objective.archetype || s.objective.monster_id || s.objective.goal || s.objective.styles.length || s.set_bonus);

/* ---------------------------------------------------------------- arranque desde la URL */
export type Boot = {
  /** monster | goal (enlaces antiguos) | guardado: abre «probar» */
  kind: "legacy" | "saved" | "none";
  step: StepId | null;
  monster: number | null;
  goal: "recoleccion" | "botin" | null;
  rank: Rank | null;
  cap: "progress" | "full";
  owned: boolean;
  saved: number | null;
  version: number | null;
};

const intParam = (v: string | null) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 0 && n <= 2_000_000_000 ? n : null;
};

export function readBoot(sp: URLSearchParams): Boot {
  const rankRaw = (sp.get("rank") ?? "").toUpperCase();
  const rank = rankRaw === "LR" || rankRaw === "HR" || rankRaw === "MR" ? (rankRaw as Rank) : null;
  const goalRaw = sp.get("goal");
  const goal = goalRaw === "recoleccion" || goalRaw === "botin" ? goalRaw : null;
  const monster = intParam(sp.get("monster"));
  const saved = intParam(sp.get("guardado"));
  const paso = sp.get("paso");
  const kind: Boot["kind"] = saved != null ? "saved" : monster || goal ? "legacy" : "none";
  return {
    kind,
    step: isStep(paso) ? paso : null,
    monster: monster || null,
    goal,
    rank,
    cap: sp.get("cap") === "full" ? "full" : "progress",
    owned: sp.get("owned") === "1",
    saved,
    version: intParam(sp.get("v")),
  };
}

/** Paso efectivo para una URL: ?paso= válido, o «probar» si llega un enlace antiguo / guardado. */
export const stepFromParams = (sp: URLSearchParams): StepId => {
  const b = readBoot(sp);
  return b.step ?? (b.kind !== "none" ? "probar" : "objetivo");
};
