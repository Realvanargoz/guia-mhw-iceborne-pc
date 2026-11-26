/* Shapes of GET /api/canteen as the canteen pages use them. Newer fields (branches, recipes, unlock_type, doc_id,
 * synergy_es) are optional: the engine derives what is missing. */
import type { EBranch, ERecipe, PlatePick, Voucher } from "./engine";

export type Ing = {
  id: string;
  name_en: string;
  name_es: string;
  category: string;
  category_es?: string;
  skill_type: string | null;
  skill_type_es: string | null;
  unlock_es?: string | null;
  unlock_type?: string | null;
  unlock?: unknown;
  doc_id?: string | null;
  item_id: number | null;
  icon_url: string | null;
  done: boolean;
  needs_review: boolean;
};

export type Skill = {
  id: string;
  name_es: string;
  name_en: string;
  effect_es: string;
  kind: string;
  skill_type: string | null;
  skill_type_es: string | null;
  tier: number | null;
  ingredients_required: number | null;
  hunter_effect: boolean;
  palico_effect: boolean;
  synergy_es?: string | null;
  note_es?: string | null;
  pool_note?: string | null;
  numeric_details?: { text_es: string }[] | null;
  needs_review: boolean;
};

export type Canteen = {
  ingredients: Ing[];
  skills: { ingredient: Skill[]; daily: Skill[] };
  skill_types: { skill_type: string; skill_type_es: string; categories: string[] }[];
  rules: { id: string; title_es: string; text_es: string; needs_review: boolean }[];
  meta: { categories: { id: string; name_es: string }[]; simulate: { max_ingredients: number } };
  branches?: EBranch[] | null;
  recipes?: ERecipe[] | null;
};

export type Saved = {
  id: string;
  name: string;
  updated: number;
  slots: number;
  voucher: Voucher;
  picks: PlatePick[];
  daily: string[];
};

/** Lower-case key used by the CSS (data-br) and the glyph files (branch-<key>.svg). */
export const brKey = (id: string | null | undefined) => (id ?? "").toLowerCase();

export const ROMAN = ["", "I", "II", "III"] as const;
