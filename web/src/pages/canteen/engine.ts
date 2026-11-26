/*
 * Canteen rules engine (MHW Iceborne, PC). Pure module: no imports, no I/O, only erasable TypeScript, so the UI
 * bundles it and Node 24 imports it directly (tools/canteen-engine-check.mjs).
 *
 * Rules (decided; sources in brackets):
 * - Branches: every ingredient belongs to one branch (`skill_type`). Five food branches (Courage, Resilience, Vigor,
 *   Acumen, Artillery: 6 meat + 6 fish + 6 veggie each) and four drink branches (Perception, Fortune, Preparation,
 *   Trailblazer: 6 drinks each). Each branch has 3 skills. With n ingredients of one branch (summed over categories)
 *   it reaches tier floor(min(n,6)/2) and ONLY that tier's skill is active: lower tiers are superseded, higher ones
 *   locked [Fandom, Canteen: the tiers are exclusive].
 * - Stats, independent of branches: meat -> attack, fish -> defense, veggie -> elemental res., level
 *   floor(min(count,6)/2) = P/M/G. Drinks give no stat but take a slot [Fextralife, Canteen].
 * - Plate: 2..6 ingredient slots, no repeated ingredient. 3 skill slots: branch skills first, then the canteen's daily
 *   skills in order, then an unknown daily skill of the day.
 * - Activation: Voucher or Gourmet Voucher -> 3 stars, otherwise half a star per fresh ingredient (max 3). Gourmet
 *   makes every ingredient fresh. Max health +10 hunter / +4 palico per fresh ingredient, 5 counted at most
 *   (+50 / +20); stamina +50 [monsterhunterwiki.org, Game8].
 */

// ---------------------------------------------------------------------------------------------------- types: input

export type Category = "meat" | "fish" | "veggie" | "drink";
export type FoodCategory = "meat" | "fish" | "veggie";
export type BranchId =
  | "Courage" | "Resilience" | "Vigor" | "Acumen" | "Artillery"
  | "Perception" | "Fortune" | "Preparation" | "Trailblazer";
export type StatKey = "attack" | "defense" | "elemental_res";
export type Voucher = "none" | "voucher" | "gourmet";
export type Level = 0 | 1 | 2 | 3;
export type LevelLabel = "-" | "P" | "M" | "G";
export type SkillState = "active" | "superseded" | "locked";
export type ErrorCode = "unknown" | "duplicate" | "overflow";
/** Ingredient ids the user owns. Overrides `done`; base ingredients always count as owned. */
export type OwnedInput = ReadonlySet<string> | readonly string[];

export interface EIngredient {
  id: string;
  name_es: string;
  name_en: string;
  category: Category;
  skill_type: BranchId;
  skill_type_es?: string | null;
  done?: boolean;
  unlock_es?: string | null;
  /** API column; "base" = available from the start. */
  unlock_type?: string | null;
  /** Seed object ({type, is_base, ...}). */
  unlock?: unknown;
}

export interface ESkill {
  id: string;
  name_es: string;
  name_en: string;
  effect_es?: string | null;
  kind: string;
  skill_type: string | null;
  skill_type_es?: string | null;
  tier: number | null;
  ingredients_required: number | null;
  synergy_es?: string | null;
}

export interface EBranch {
  id: BranchId;
  name_es: string;
  name_en: string;
  color_name_es?: string | null;
  color_hex: string;
  glyph: string;
  group: "food" | "drink";
  categories: Category[];
  skill_ids: string[];
}

export interface ERecipeRow {
  count: number;
  category: Category;
  branch: BranchId;
}

export interface ERecipe {
  id: string;
  name_es: string;
  plate_type_es?: string | null;
  composition: ERecipeRow[];
  target_skill_ids: string[];
  needs_daily: string | null;
  variants_es?: unknown;
  voucher_es?: string | null;
  use_es?: string | null;
}

export interface EData {
  ingredients: EIngredient[];
  skills: { ingredient: ESkill[]; daily: ESkill[] };
  branches?: EBranch[] | null;
  recipes?: ERecipe[] | null;
}

// --------------------------------------------------------------------------------------------------- types: output

export interface PlatePick {
  id: string;
  fresh: boolean;
}

export interface SimOptions {
  slots: number;
  voucher: Voucher;
  /** Daily skill ids the canteen offers today, in order (max 3). */
  daily: readonly string[];
}

export interface SimError {
  code: ErrorCode;
  text_es: string;
  id?: string;
}

export interface BranchSkillState {
  id: string;
  tier: number;
  state: SkillState;
}

export interface BranchRow {
  branch: BranchId;
  count: number;
  tier: Level;
  /** Ingredients of this branch still missing for the next tier (null at tier 3). */
  nextAt: number | null;
  nextSkillId: string | null;
  skills: BranchSkillState[];
}

export interface SkillSlot {
  kind: "branch" | "daily" | "random";
  skillId: string | null;
  branch: BranchId | null;
}

export interface StatRow {
  category: FoodCategory;
  count: number;
  level: Level;
  label_es: LevelLabel;
  /** Ingredients of this category still missing for the next level (null at level 3). */
  nextAt: number | null;
}

export interface SimResult {
  slots: number;
  count: number;
  full: boolean;
  /** Effective fresh ingredients (all of them with the Gourmet Voucher). */
  fresh: number;
  /** The picks that entered the computation, with effective freshness. */
  picks: PlatePick[];
  branches: BranchRow[];
  activeSkillIds: string[];
  skillSlots: SkillSlot[];
  stats: { attack: StatRow; defense: StatRow; elemental_res: StatRow };
  drinks: number;
  stars: number;
  health: { hunter: number; palico: number };
  stamina: 50;
  errors_es: SimError[];
  warnings_es: string[];
  summary_es: string;
}

export type FillMode = "singles" | "empty";

export interface SuggestReq {
  /** Ingredient skill ids (max 3, one per branch). */
  targets: readonly string[];
  stat: StatKey | "none";
  slots: number;
  preferOwned: boolean;
  ownedOnly: boolean;
  /** Default "singles": fill leftover slots with one ingredient each from other branches. */
  fill?: FillMode;
  owned?: OwnedInput;
}

export interface PlanRow {
  count: number;
  category: Category;
  /** null for filler rows (one ingredient from each of `count` distinct other branches). */
  branch: BranchId | null;
  role: "target" | "filler";
}

export interface MissingIngredient {
  id: string;
  name_es: string;
  unlock_es: string | null;
}

export interface SuggestResult {
  ok: boolean;
  reason_es: string | null;
  picks: PlatePick[];
  plan: PlanRow[];
  /** Chosen ingredients the user does not own (only when preferOwned or ownedOnly). */
  missing: MissingIngredient[];
  notes_es: string[];
  result: SimResult | null;
}

export interface RecipeOpts {
  preferOwned: boolean;
  ownedOnly: boolean;
  owned?: OwnedInput;
  /** Canteen slots; default = the recipe's ingredient count (min 2). */
  slots?: number;
}

export interface NormalizeResult {
  picks: PlatePick[];
  dropped: { id: string; code: ErrorCode }[];
}

export interface CanteenEngine {
  simulate(picks: readonly PlatePick[], opts: SimOptions): SimResult;
  suggest(req: SuggestReq): SuggestResult;
  recipePlate(recipe: ERecipe, opts: RecipeOpts): SuggestResult;
  normalizePicks(ids: readonly string[], slots: number): NormalizeResult;
  branchOf(ingredientId: string): BranchId | null;
  /** Ingredients in seed order; null = any category / any branch. */
  ingredientsBy(category: Category | null, branch: BranchId | null): readonly EIngredient[];
  ingredient(id: string): EIngredient | null;
  skill(id: string): ESkill | null;
  branch(id: string): EBranch | null;
  /** The branch's skills by tier (index 0 = tier 1). */
  branchSkills(branch: BranchId): ESkill[];
  /** Branch and tier of an ingredient skill; null for daily or unknown ids. */
  skillTier(skillId: string): { branch: BranchId; tier: number } | null;
  isOwned(ingredientId: string, owned?: OwnedInput): boolean;
  readonly branches: readonly EBranch[];
  readonly branchOrder: readonly BranchId[];
  readonly statOfCategory: Readonly<Record<Category, StatKey | null>>;
  readonly categoryOfStat: Readonly<Record<StatKey, FoodCategory>>;
  readonly categoryLabel_es: Readonly<Record<Category, string>>;
  readonly statLabel_es: Readonly<Record<StatKey, string>>;
  readonly levelLabel_es: readonly LevelLabel[];
}

// ------------------------------------------------------------------------------------------------------ constants

export const MIN_SLOTS = 2;
export const MAX_SLOTS = 6;
export const SKILL_SLOTS = 3;
export const CATEGORY_ORDER: readonly Category[] = ["meat", "fish", "veggie", "drink"];
export const FOOD_CATEGORIES: readonly FoodCategory[] = ["meat", "fish", "veggie"];
export const STAT_ORDER: readonly StatKey[] = ["attack", "defense", "elemental_res"];
export const CATEGORY_LABEL_ES: Readonly<Record<Category, string>> = {
  meat: "Carne", fish: "Pescado", veggie: "Verdura", drink: "Bebida",
};
export const STAT_LABEL_ES: Readonly<Record<StatKey, string>> = {
  attack: "Ataque", defense: "Defensa", elemental_res: "Res. elemental",
};
export const STAT_OF_CATEGORY: Readonly<Record<Category, StatKey | null>> = {
  meat: "attack", fish: "defense", veggie: "elemental_res", drink: null,
};
export const CATEGORY_OF_STAT: Readonly<Record<StatKey, FoodCategory>> = {
  attack: "meat", defense: "fish", elemental_res: "veggie",
};
export const LEVEL_LABEL_ES: readonly LevelLabel[] = ["-", "P", "M", "G"];

const DEFAULT_BRANCH_ORDER: readonly string[] = [
  "Courage", "Resilience", "Vigor", "Acumen", "Artillery", "Perception", "Fortune", "Preparation", "Trailblazer",
];
const NEUTRAL_HEX = "#8b8f97";
/** Glyph keys used by the seed's entries.branches; only for branches derived from old data. */
const DEFAULT_GLYPH: Readonly<Record<string, string>> = {
  Courage: "fist", Resilience: "shield", Vigor: "bolt", Acumen: "flask", Artillery: "bomb",
  Perception: "eye", Fortune: "coin", Preparation: "boot", Trailblazer: "compass",
};
const ORDINAL_ES: Readonly<Record<number, string>> = { 3: "tercero", 5: "quinto" };
const EMPTY: readonly EIngredient[] = Object.freeze([]);

// -------------------------------------------------------------------------------------------------- pure helpers

/** Tier (or stat level) reached with n ingredients: floor(min(n,6)/2). */
export function tierForCount(n: number): Level {
  const k = Number.isFinite(n) ? Math.max(0, Math.min(6, Math.floor(n))) : 0;
  return Math.floor(k / 2) as Level;
}

/** Ingredients still missing for the next tier (null at tier 3). */
export function nextAtForCount(n: number): number | null {
  const level = tierForCount(n);
  return level >= 3 ? null : (level + 1) * 2 - Math.max(0, Math.floor(n));
}

function isCategory(x: unknown): x is Category {
  return x === "meat" || x === "fish" || x === "veggie" || x === "drink";
}

function isFood(c: Category): c is FoodCategory {
  return c !== "drink";
}

function isStat(x: unknown): x is StatKey {
  return x === "attack" || x === "defense" || x === "elemental_res";
}

function validSlots(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= MIN_SLOTS && x <= MAX_SLOTS;
}

function clampSlots(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return MAX_SLOTS;
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, Math.round(x)));
}

function asList<T>(x: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(x) ? x : [];
}

function pickId(p: unknown): string {
  if (typeof p === "string") return p.trim();
  if (p && typeof p === "object") {
    const id = (p as { id?: unknown }).id;
    if (typeof id === "string") return id.trim();
  }
  return "";
}

function pickFresh(p: unknown): boolean {
  return !!p && typeof p === "object" && (p as { fresh?: unknown }).fresh === true;
}

function listEs(items: readonly string[], conj = "y"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`;
}

function nIngredients(n: number): string {
  return n === 1 ? "1 ingrediente" : `${n} ingredientes`;
}

function lower(c: Category): string {
  return CATEGORY_LABEL_ES[c].toLowerCase();
}

function failed(reason: string): SuggestResult {
  return { ok: false, reason_es: reason, picks: [], plan: [], missing: [], notes_es: [], result: null };
}

// ---------------------------------------------------------------------------------------------------------- engine

interface PickCtx {
  owned: (i: EIngredient) => boolean;
  preferOwned: boolean;
  ownedOnly: boolean;
  used: Set<string>;
}

export function createEngine(data: EData): CanteenEngine {
  const src: Partial<EData> = data && typeof data === "object" ? data : {};

  // ---- ingredients (seed order, first occurrence wins)
  const ingById = new Map<string, EIngredient>();
  const ingList: EIngredient[] = [];
  for (const i of asList(src.ingredients)) {
    if (!i || typeof i.id !== "string" || ingById.has(i.id)) continue;
    if (!isCategory(i.category) || typeof i.skill_type !== "string") continue;
    ingById.set(i.id, i);
    ingList.push(i);
  }

  // ---- skills
  const skillGroups = src.skills && typeof src.skills === "object" ? src.skills : { ingredient: [], daily: [] };
  const skillById = new Map<string, ESkill>();
  const ingSkills: ESkill[] = [];
  const dailyIds = new Set<string>();
  for (const s of asList(skillGroups.ingredient)) {
    if (!s || typeof s.id !== "string" || skillById.has(s.id)) continue;
    skillById.set(s.id, s);
    ingSkills.push(s);
  }
  for (const s of asList(skillGroups.daily)) {
    if (!s || typeof s.id !== "string" || skillById.has(s.id)) continue;
    skillById.set(s.id, s);
    dailyIds.add(s.id);
  }

  // ---- tiers: branch -> [_, tier1, tier2, tier3]
  const tierMap = new Map<string, (ESkill | undefined)[]>();
  const setTier = (branch: string, tier: number, s: ESkill): void => {
    const arr = tierMap.get(branch) ?? [];
    if (!arr[tier]) arr[tier] = s;
    tierMap.set(branch, arr);
  };
  for (const s of ingSkills) {
    const raw = typeof s.tier === "number" ? s.tier
      : typeof s.ingredients_required === "number" ? s.ingredients_required / 2 : NaN;
    if (s.skill_type && Number.isInteger(raw) && raw >= 1 && raw <= 3) setTier(s.skill_type, raw, s);
  }
  const tierIds = (branch: string): string[] => {
    const arr = tierMap.get(branch) ?? [];
    return [1, 2, 3].map((t) => arr[t]?.id).filter((x): x is string => typeof x === "string");
  };

  // ---- branches: given ones (sanitised) first, then any branch only seen in ingredients/skills (derived)
  const catsOf = new Map<string, Set<Category>>();
  const nameEsOf = new Map<string, string>();
  const seenOrder: string[] = [];
  const see = (b: string): void => {
    if (!catsOf.has(b)) {
      catsOf.set(b, new Set());
      seenOrder.push(b);
    }
  };
  for (const i of ingList) {
    see(i.skill_type);
    catsOf.get(i.skill_type)?.add(i.category);
    if (i.skill_type_es && !nameEsOf.has(i.skill_type)) nameEsOf.set(i.skill_type, i.skill_type_es);
  }
  for (const s of ingSkills) {
    if (!s.skill_type) continue;
    see(s.skill_type);
    if (s.skill_type_es && !nameEsOf.has(s.skill_type)) nameEsOf.set(s.skill_type, s.skill_type_es);
  }
  const derive = (id: string): EBranch => {
    const cats = CATEGORY_ORDER.filter((c) => catsOf.get(id)?.has(c));
    const name = nameEsOf.get(id) ?? id;
    return {
      id: id as BranchId, name_es: name, name_en: id, color_name_es: "Gris", color_hex: NEUTRAL_HEX,
      glyph: DEFAULT_GLYPH[id] ?? name.charAt(0).toUpperCase(), group: cats.length > 0 && cats.every((c) => c === "drink") ? "drink" : "food",
      categories: cats, skill_ids: tierIds(id),
    };
  };
  const branchList: EBranch[] = [];
  const branchById = new Map<string, EBranch>();
  const addBranch = (b: EBranch): void => {
    branchById.set(b.id, b);
    branchList.push(b);
  };
  for (const b of asList(src.branches)) {
    if (!b || typeof b.id !== "string" || branchById.has(b.id)) continue;
    // Skills without a usable tier: take the tiers from the branch's skill_ids order.
    if (!tierMap.has(b.id) && Array.isArray(b.skill_ids)) {
      b.skill_ids.forEach((sid, k) => {
        const s = skillById.get(sid);
        if (s && k < 3) setTier(b.id, k + 1, s);
      });
    }
    const d = derive(b.id);
    const cats = Array.isArray(b.categories) ? b.categories.filter(isCategory) : [];
    addBranch({
      ...b,
      name_es: typeof b.name_es === "string" && b.name_es ? b.name_es : d.name_es,
      name_en: typeof b.name_en === "string" && b.name_en ? b.name_en : d.name_en,
      color_hex: typeof b.color_hex === "string" && b.color_hex ? b.color_hex : d.color_hex,
      glyph: typeof b.glyph === "string" && b.glyph ? b.glyph : d.glyph,
      group: b.group === "food" || b.group === "drink" ? b.group : d.group,
      categories: cats.length > 0 ? cats : d.categories,
      skill_ids: Array.isArray(b.skill_ids) && b.skill_ids.length > 0 ? b.skill_ids : d.skill_ids,
    });
  }
  const rest = [
    ...DEFAULT_BRANCH_ORDER.filter((id) => catsOf.has(id)),
    ...seenOrder.filter((id) => !DEFAULT_BRANCH_ORDER.includes(id)),
  ];
  for (const id of rest) if (!branchById.has(id)) addBranch(derive(id));
  const branchIdx = new Map<string, number>(branchList.map((b, k) => [b.id, k]));
  const branchOrder = Object.freeze(branchList.map((b) => b.id));
  const branchName = (id: string): string => branchById.get(id)?.name_es ?? nameEsOf.get(id) ?? id;
  const skillName = (id: string): string => skillById.get(id)?.name_es ?? id;
  const orderOf = (id: string): number => branchIdx.get(id) ?? Number.MAX_SAFE_INTEGER;

  // ---- skill -> (branch, tier)
  const tierOfSkill = new Map<string, { branch: BranchId; tier: number }>();
  for (const [b, arr] of tierMap) {
    for (let t = 1; t <= 3; t++) {
      const s = arr[t];
      if (s && !tierOfSkill.has(s.id)) tierOfSkill.set(s.id, { branch: b as BranchId, tier: t });
    }
  }

  // ---- ingredient index by (category|*, branch|*)
  const byKey = new Map<string, EIngredient[]>();
  const key = (c: Category | null, b: string | null): string => `${c ?? "*"}|${b ?? "*"}`;
  for (const i of ingList) {
    for (const k of [key(i.category, i.skill_type), key(i.category, null), key(null, i.skill_type), key(null, null)]) {
      const arr = byKey.get(k);
      if (arr) arr.push(i);
      else byKey.set(k, [i]);
    }
  }
  const ingredientsBy = (category: Category | null, branch: BranchId | string | null): readonly EIngredient[] =>
    byKey.get(key(category, branch)) ?? EMPTY;

  // ---- ownership
  const isBase = (i: EIngredient): boolean => {
    if (i.unlock_type === "base") return true;
    const u = i.unlock;
    if (u && typeof u === "object") {
      const o = u as { type?: unknown; is_base?: unknown };
      return o.type === "base" || o.is_base === true;
    }
    return false;
  };
  const ownedFn = (owned?: OwnedInput): ((i: EIngredient) => boolean) => {
    let set: ReadonlySet<string> | null = null;
    if (owned != null) {
      set = typeof (owned as ReadonlySet<string>).has === "function"
        ? (owned as ReadonlySet<string>)
        : new Set((owned as readonly string[]).filter((x) => typeof x === "string"));
    }
    return (i) => isBase(i) || (set ? set.has(i.id) : i.done === true);
  };
  const foodCats = (branch: string): FoodCategory[] =>
    (branchById.get(branch)?.categories ?? []).filter(isFood);
  const allowedCats = (branch: string): Category[] => {
    const b = branchById.get(branch);
    return b ? CATEGORY_ORDER.filter((c) => b.categories.includes(c)) : [];
  };
  const mostOwnedFood = (branch: string, cats: readonly FoodCategory[], owned: (i: EIngredient) => boolean): FoodCategory => {
    let best = cats[0] ?? "meat";
    let bestN = -1;
    for (const c of cats) {
      const n = ingredientsBy(c, branch).filter(owned).length;
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  };

  // ======================================================================================================= simulate
  function simulate(picks: readonly PlatePick[], opts: SimOptions): SimResult {
    const o: Partial<SimOptions> = opts && typeof opts === "object" ? opts : {};
    const errors: SimError[] = [];
    const warnings: string[] = [];
    const slots = clampSlots(o.slots);
    if (o.slots !== undefined && !validSlots(o.slots)) {
      warnings.push(`Huecos fuera de rango (de ${MIN_SLOTS} a ${MAX_SLOTS}): se usan ${slots}.`);
    }
    const voucher: Voucher = o.voucher === "voucher" || o.voucher === "gourmet" ? o.voucher : "none";

    // ---- accepted picks
    const accepted: { ing: EIngredient; fresh: boolean }[] = [];
    const seen = new Set<string>();
    for (const p of asList(picks as readonly unknown[])) {
      const id = pickId(p);
      const ing = ingById.get(id);
      if (!ing) {
        errors.push({ code: "unknown", id, text_es: id ? `Ingrediente desconocido: «${id}».` : "Ingrediente sin id." });
      } else if (seen.has(id)) {
        errors.push({ code: "duplicate", id, text_es: `«${ing.name_es}» está repetido: un plato no lleva dos veces el mismo ingrediente.` });
      } else if (accepted.length >= slots) {
        errors.push({ code: "overflow", id, text_es: `«${ing.name_es}» no cabe: tu cantina tiene ${slots} huecos.` });
      } else {
        seen.add(id);
        accepted.push({ ing, fresh: pickFresh(p) });
      }
    }
    const count = accepted.length;
    const fresh = voucher === "gourmet" ? count : accepted.filter((a) => a.fresh).length;

    // ---- counts
    const branchCount = new Map<string, number>();
    const catCount: Record<Category, number> = { meat: 0, fish: 0, veggie: 0, drink: 0 };
    for (const a of accepted) {
      branchCount.set(a.ing.skill_type, (branchCount.get(a.ing.skill_type) ?? 0) + 1);
      catCount[a.ing.category] += 1;
    }

    // ---- branch rows (count desc, then canonical order)
    const rows: BranchRow[] = [...branchCount.entries()]
      .map(([b, n]): BranchRow => {
        const tier = tierForCount(n);
        const arr = tierMap.get(b) ?? [];
        const skills: BranchSkillState[] = [];
        for (let t = 1; t <= 3; t++) {
          const s = arr[t];
          if (s) skills.push({ id: s.id, tier: t, state: t === tier ? "active" : t < tier ? "superseded" : "locked" });
        }
        return {
          branch: b as BranchId, count: n, tier, nextAt: nextAtForCount(n),
          nextSkillId: tier < 3 ? arr[tier + 1]?.id ?? null : null, skills,
        };
      })
      .sort((x, y) => y.count - x.count || orderOf(x.branch) - orderOf(y.branch));
    const activeSkillIds = rows.flatMap((r) => r.skills.filter((s) => s.state === "active").map((s) => s.id));

    // ---- daily skills
    const daily: ESkill[] = [];
    const seenDaily = new Set<string>();
    for (const d of asList(o.daily as readonly unknown[] | undefined)) {
      const id = pickId(d);
      const s = dailyIds.has(id) ? skillById.get(id) : undefined;
      if (!s) {
        errors.push({ code: "unknown", id, text_es: `Habilidad diaria desconocida: «${id}».` });
      } else if (seenDaily.has(id)) {
        errors.push({ code: "duplicate", id, text_es: `«${s.name_es}» está repetida en las habilidades diarias.` });
      } else if (daily.length >= SKILL_SLOTS) {
        errors.push({ code: "overflow", id, text_es: `La cantina ofrece ${SKILL_SLOTS} habilidades diarias como máximo: sobra «${s.name_es}».` });
      } else {
        seenDaily.add(id);
        daily.push(s);
      }
    }

    // ---- skill slots: branch skills, chosen dailies, then the unknown daily of the day
    const skillSlots: SkillSlot[] = [];
    for (const r of rows) {
      for (const s of r.skills) {
        if (s.state === "active" && skillSlots.length < SKILL_SLOTS) skillSlots.push({ kind: "branch", skillId: s.id, branch: r.branch });
      }
    }
    const dailyRoom = SKILL_SLOTS - skillSlots.length;
    for (const s of daily.slice(0, dailyRoom)) skillSlots.push({ kind: "daily", skillId: s.id, branch: null });
    while (skillSlots.length < SKILL_SLOTS) skillSlots.push({ kind: "random", skillId: null, branch: null });
    const dailyLeftOut = daily.slice(Math.max(0, dailyRoom)).map((s) => `«${s.name_es}»`);
    if (dailyLeftOut.length > 0) {
      warnings.push(`Sin hueco para ${listEs(dailyLeftOut)}: las habilidades de rama tienen prioridad.`);
    }

    // ---- stats
    const statRow = (c: FoodCategory): StatRow => {
      const n = catCount[c];
      const level = tierForCount(n);
      return { category: c, count: n, level, label_es: LEVEL_LABEL_ES[level], nextAt: nextAtForCount(n) };
    };
    const stats = { attack: statRow("meat"), defense: statRow("fish"), elemental_res: statRow("veggie") };

    // ---- warnings
    for (const r of rows) {
      const ord = ORDINAL_ES[r.count];
      if (ord) warnings.push(`${r.count} de ${branchName(r.branch)}: el ${ord} no sube de nivel.`);
      const sup = r.skills.filter((s) => s.state === "superseded").map((s) => skillName(s.id));
      const act = r.skills.find((s) => s.state === "active");
      if (sup.length > 0 && act) {
        warnings.push(`La rama da solo su nivel más alto: con ${r.count} de ${branchName(r.branch)} tienes ${skillName(act.id)}, no ${listEs(sup, "ni")}.`);
      }
    }
    if (count > 0 && catCount.drink === count) {
      warnings.push("Solo bebidas: el plato no sube ataque, defensa ni resistencia elemental.");
    }

    // ---- activation and health
    const stars = voucher !== "none" ? 3 : Math.min(3, fresh * 0.5);
    const counted = Math.min(fresh, 5);

    // ---- summary
    let summary = "Plato vacío";
    if (count > 0) {
      const left = rows.map((r) => `${r.count} ${branchName(r.branch)}`).join(" + ");
      const sk = activeSkillIds.length > 0 ? activeSkillIds.map(skillName).join(", ") : "Sin habilidades de rama";
      const st = STAT_ORDER.filter((k) => stats[k].level > 0).map((k) => `${STAT_LABEL_ES[k]} ${stats[k].label_es}`).join(", ");
      summary = `${left} → ${sk} · ${st || "sin estadística"}`;
    }

    return {
      slots, count, full: count === slots, fresh,
      picks: accepted.map((a) => ({ id: a.ing.id, fresh: voucher === "gourmet" || a.fresh })),
      branches: rows, activeSkillIds, skillSlots, stats, drinks: catCount.drink, stars,
      health: { hunter: counted * 10, palico: counted * 4 }, stamina: 50,
      errors_es: errors, warnings_es: warnings, summary_es: summary,
    };
  }

  // ========================================================================================= concrete ingredient picks
  /** Picks k ingredients of a branch, preferred category first; owned-first / owned-only logic. */
  function pickFrom(branch: string, preferred: Category, allowed: readonly Category[], k: number, ctx: PickCtx):
    { picked: EIngredient[]; fallbackCats: Category[] } {
    const out: EIngredient[] = [];
    const fallbackCats: Category[] = [];
    const free = (c: Category): EIngredient[] => ingredientsBy(c, branch).filter((i) => !ctx.used.has(i.id));
    const ownedFirst = (l: EIngredient[]): EIngredient[] =>
      ctx.preferOwned ? [...l.filter(ctx.owned), ...l.filter((i) => !ctx.owned(i))] : l;
    const take = (l: readonly EIngredient[], c: Category): void => {
      for (const i of l) {
        if (out.length >= k) return;
        if (ctx.used.has(i.id)) continue;
        out.push(i);
        ctx.used.add(i.id);
        if (c !== preferred && !fallbackCats.includes(c)) fallbackCats.push(c);
      }
    };
    const others = allowed.filter((c) => c !== preferred);
    if (ctx.ownedOnly) {
      take(free(preferred).filter(ctx.owned), preferred);
      const byOwned = [...others].sort((a, b) => free(b).filter(ctx.owned).length - free(a).filter(ctx.owned).length);
      for (const c of byOwned) take(free(c).filter(ctx.owned), c);
      take(free(preferred), preferred);
      for (const c of others) take(free(c), c);
    } else {
      take(ownedFirst(free(preferred)), preferred);
      for (const c of others) take(ownedFirst(free(c)), c);
    }
    return { picked: out, fallbackCats };
  }

  /** Groups picked ingredients into plan rows by category, keeping first-seen order. */
  function planRows(picked: readonly EIngredient[], branch: BranchId | null, role: PlanRow["role"]): PlanRow[] {
    const rows: PlanRow[] = [];
    for (const i of picked) {
      const r = rows.find((x) => x.category === i.category);
      if (r) r.count += 1;
      else rows.push({ count: 1, category: i.category, branch, role });
    }
    return rows;
  }

  function fallbackNote(skillId: string | null, branch: string, preferred: Category, cats: readonly Category[]): string {
    const who = skillId ? `Para ${skillName(skillId)}` : `En ${branchName(branch)}`;
    return `${who} no tienes bastante ${lower(preferred)} de ${branchName(branch)}: se completa con ${listEs(cats.map(lower))}, así que cambia la estadística.`;
  }

  /** Concrete picks, the ingredients the user lacks (when ownership matters) and the simulated plate. */
  function finish(picked: readonly EIngredient[], notes: string[], slots: number, ctx: PickCtx):
    { picks: PlatePick[]; missing: MissingIngredient[]; result: SimResult } {
    const picks = picked.map((i) => ({ id: i.id, fresh: false }));
    const missing = ctx.preferOwned
      ? picked.filter((i) => !ctx.owned(i)).map((i) => ({ id: i.id, name_es: i.name_es, unlock_es: i.unlock_es ?? null }))
      : [];
    if (missing.length > 0) notes.push(`Aún no tienes ${nIngredients(missing.length)} del plato.`);
    const result = simulate(picks, { slots, voucher: "none", daily: [] });
    return { picks, missing, result };
  }

  // ======================================================================================================== suggest
  function suggest(req: SuggestReq): SuggestResult {
    const r: Partial<SuggestReq> = req && typeof req === "object" ? req : {};
    const slots = clampSlots(r.slots);
    const stat: StatKey | "none" = isStat(r.stat) ? r.stat : "none";
    const fill: FillMode = r.fill === "empty" ? "empty" : "singles";
    const ownedOnly = r.ownedOnly === true;
    const ctx: PickCtx = { owned: ownedFn(r.owned), preferOwned: r.preferOwned === true || ownedOnly, ownedOnly, used: new Set() };

    // ---- validate targets
    const targets: string[] = [];
    for (const t of asList(r.targets as readonly unknown[] | undefined)) {
      const id = pickId(t);
      if (!targets.includes(id)) targets.push(id);
    }
    if (targets.length > SKILL_SLOTS) return failed(`Un plato da como máximo ${SKILL_SLOTS} habilidades de rama: elige ${SKILL_SLOTS} o menos.`);
    const wanted: { id: string; branch: BranchId; need: number }[] = [];
    for (const id of targets) {
      const info = tierOfSkill.get(id);
      if (!info) {
        if (dailyIds.has(id)) {
          return failed(`«${skillName(id)}» es una habilidad diaria: sale al azar en la cantina y no depende de los ingredientes.`);
        }
        return failed(skillById.has(id) ? `«${skillName(id)}» no es una habilidad de rama.` : `Habilidad desconocida: «${id}».`);
      }
      if (wanted.some((w) => w.branch === info.branch)) {
        return failed(`Solo se activa el nivel más alto de cada rama: elige una sola habilidad de ${branchName(info.branch)}.`);
      }
      wanted.push({ id, branch: info.branch, need: info.tier * 2 });
    }
    const total = wanted.reduce((a, w) => a + w.need, 0);
    if (total > slots) return failed(`Necesitas ${total} huecos y tu cantina tiene ${slots}.`);

    // ---- target ingredients
    const picked: EIngredient[] = [];
    const plan: PlanRow[] = [];
    const notes: string[] = [];
    for (const w of wanted) {
      const food = foodCats(w.branch);
      let preferred: Category;
      if (food.length === 0) preferred = "drink";
      else if (stat !== "none" && food.includes(CATEGORY_OF_STAT[stat])) preferred = CATEGORY_OF_STAT[stat];
      else preferred = mostOwnedFood(w.branch, food, ctx.owned);
      const allowed = food.length === 0 ? allowedCats(w.branch) : food;
      const got = pickFrom(w.branch, preferred, allowed, w.need, ctx);
      if (got.picked.length < w.need) {
        return failed(`No hay bastantes ingredientes de ${branchName(w.branch)} en los datos para ${skillName(w.id)}.`);
      }
      if (got.fallbackCats.length > 0) notes.push(fallbackNote(w.id, w.branch, preferred, got.fallbackCats));
      picked.push(...got.picked);
      plan.push(...planRows(got.picked, w.branch, "target"));
    }

    // ---- leftover slots
    let left = slots - picked.length;
    if (left > 0 && fill === "empty") {
      notes.push(left === 1 ? "Queda 1 hueco libre sin relleno." : `Quedan ${left} huecos libres sin relleno.`);
    } else if (left > 0) {
      const targetBranches = new Set<string>(wanted.map((w) => w.branch));
      const options: { ing: EIngredient; owned: boolean }[] = [];
      for (const b of branchList) {
        if (targetBranches.has(b.id) || b.categories.length === 0) continue;
        let cat: Category | null;
        if (stat !== "none") cat = b.categories.includes(CATEGORY_OF_STAT[stat]) ? CATEGORY_OF_STAT[stat] : null;
        else cat = foodCats(b.id).length > 0 ? mostOwnedFood(b.id, foodCats(b.id), ctx.owned) : "drink";
        if (!cat) continue;
        const pool = ingredientsBy(cat, b.id).filter((i) => !ctx.used.has(i.id));
        const own = pool.find(ctx.owned);
        const choice = ctx.ownedOnly ? own : ctx.preferOwned ? own ?? pool[0] : pool[0];
        if (choice) options.push({ ing: choice, owned: ctx.owned(choice) });
      }
      if (ctx.preferOwned) options.sort((a, b) => Number(b.owned) - Number(a.owned));
      const fillers = options.slice(0, left).map((x) => x.ing);
      for (const i of fillers) ctx.used.add(i.id);
      left -= fillers.length;
      if (fillers.length > 0) {
        picked.push(...fillers);
        plan.push(...planRows(fillers, null, "filler"));
        const one = fillers.length === 1;
        const from = one ? "de otra rama" : "de ramas distintas (uno por rama)";
        notes.push(stat !== "none"
          ? `Relleno: ${nIngredients(fillers.length)} de ${lower(CATEGORY_OF_STAT[stat])} ${from} que ${one ? "sube" : "suben"} ${STAT_LABEL_ES[stat].toLowerCase()} sin crear otra habilidad.`
          : `Relleno: ${nIngredients(fillers.length)} ${from} que no ${one ? "crea" : "crean"} otra habilidad.`);
      }
      if (left > 0) {
        const head = left === 1 ? "Queda 1 hueco vacío" : `Quedan ${left} huecos vacíos`;
        const mine = ctx.ownedOnly ? " que tengas" : "";
        notes.push(stat !== "none"
          ? `${head}: no hay más ${lower(CATEGORY_OF_STAT[stat])}${mine} de otras ramas que no cree otra habilidad. ${left === 1 ? "Una bebida de otra rama lo llenaría" : "Bebidas de otras ramas los llenarían"} sin dar estadística.`
          : `${head}: no hay más ingredientes${mine} de otras ramas que no creen otra habilidad.`);
      }
    }

    const out = finish(picked, notes, slots, ctx);
    const want = new Set(targets);
    const got = out.result.activeSkillIds;
    const same = got.length === want.size && got.every((id) => want.has(id)) && out.result.errors_es.length === 0;
    return {
      ok: same,
      reason_es: same ? null : "Error interno: el plato calculado no da exactamente las habilidades pedidas.",
      picks: out.picks, plan, missing: out.missing, notes_es: notes, result: out.result,
    };
  }

  // ==================================================================================================== recipePlate
  function recipePlate(recipe: ERecipe, opts: RecipeOpts): SuggestResult {
    if (!recipe || typeof recipe !== "object" || !Array.isArray(recipe.composition) || recipe.composition.length === 0) {
      return failed("La receta no tiene composición.");
    }
    const o: Partial<RecipeOpts> = opts && typeof opts === "object" ? opts : {};
    const ownedOnly = o.ownedOnly === true;
    const ctx: PickCtx = { owned: ownedFn(o.owned), preferOwned: o.preferOwned === true || ownedOnly, ownedOnly, used: new Set() };
    let total = 0;
    for (const row of recipe.composition) {
      const n = row && typeof row.count === "number" && Number.isInteger(row.count) ? row.count : 0;
      if (n < 1 || !isCategory(row.category) || !branchById.has(row.branch) || ingredientsBy(row.category, row.branch).length === 0) {
        return failed(`La receta «${recipe.name_es}» pide una combinación que no existe: ${n} de ${row ? String(row.category) : "?"} de ${row ? String(row.branch) : "?"}.`);
      }
      total += n;
    }
    if (total > MAX_SLOTS) return failed(`La receta suma ${total} ingredientes y el máximo es ${MAX_SLOTS}.`);
    const slots = o.slots === undefined ? clampSlots(Math.max(total, MIN_SLOTS)) : clampSlots(o.slots);
    if (total > slots) return failed(`Necesitas ${total} huecos y tu cantina tiene ${slots}.`);

    const picked: EIngredient[] = [];
    const plan: PlanRow[] = [];
    const notes: string[] = [];
    for (const row of recipe.composition) {
      const allowed = isFood(row.category) ? foodCats(row.branch) : allowedCats(row.branch);
      const got = pickFrom(row.branch, row.category, allowed, row.count, ctx);
      if (got.picked.length < row.count) {
        return failed(`No hay bastantes ingredientes de ${lower(row.category)} de ${branchName(row.branch)} para la receta.`);
      }
      if (got.fallbackCats.length > 0) notes.push(fallbackNote(null, row.branch, row.category, got.fallbackCats));
      picked.push(...got.picked);
      plan.push(...planRows(got.picked, row.branch, "target"));
    }
    const out = finish(picked, notes, slots, ctx);
    const targets = asList(recipe.target_skill_ids).filter((x) => typeof x === "string");
    const active = out.result.activeSkillIds;
    const lacking = targets.filter((t) => !active.includes(t));
    const extra = active.filter((t) => !targets.includes(t));
    if (extra.length > 0) notes.push(`Este plato también da ${listEs(extra.map(skillName))}.`);
    if (recipe.needs_daily) {
      notes.push(`Además necesita que la cantina ofrezca hoy «${skillName(recipe.needs_daily)}» como habilidad diaria.`);
    }
    const ok = lacking.length === 0 && out.result.errors_es.length === 0;
    return {
      ok,
      reason_es: ok ? null : `La receta no da ${listEs(lacking.map(skillName)) || "lo que promete"}: revisa su composición.`,
      picks: out.picks, plan, missing: out.missing, notes_es: notes, result: out.result,
    };
  }

  // ================================================================================================= normalizePicks
  function normalizePicks(ids: readonly string[], slots: number): NormalizeResult {
    const cap = clampSlots(slots);
    const picks: PlatePick[] = [];
    const dropped: { id: string; code: ErrorCode }[] = [];
    const seen = new Set<string>();
    for (const x of asList(ids as readonly unknown[])) {
      const id = pickId(x);
      if (!ingById.has(id)) dropped.push({ id, code: "unknown" });
      else if (seen.has(id)) dropped.push({ id, code: "duplicate" });
      else if (picks.length >= cap) dropped.push({ id, code: "overflow" });
      else {
        seen.add(id);
        picks.push({ id, fresh: false });
      }
    }
    return { picks, dropped };
  }

  return {
    simulate,
    suggest,
    recipePlate,
    normalizePicks,
    branchOf: (id) => (ingById.get(id)?.skill_type ?? null),
    ingredientsBy: (category, branch) => ingredientsBy(category, branch),
    ingredient: (id) => ingById.get(id) ?? null,
    skill: (id) => skillById.get(id) ?? null,
    branch: (id) => branchById.get(id) ?? null,
    branchSkills: (b) => {
      const arr = tierMap.get(b) ?? [];
      return [1, 2, 3].map((t) => arr[t]).filter((s): s is ESkill => !!s);
    },
    skillTier: (id) => tierOfSkill.get(id) ?? null,
    isOwned: (id, owned) => {
      const i = ingById.get(id);
      return i ? ownedFn(owned)(i) : false;
    },
    branches: Object.freeze([...branchList]),
    branchOrder,
    statOfCategory: STAT_OF_CATEGORY,
    categoryOfStat: CATEGORY_OF_STAT,
    categoryLabel_es: CATEGORY_LABEL_ES,
    statLabel_es: STAT_LABEL_ES,
    levelLabel_es: LEVEL_LABEL_ES,
  };
}
