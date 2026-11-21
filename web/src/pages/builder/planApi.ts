/* Llamadas del asistente: catálogos con memoria (once), plantilla y borrador (guardado en el servidor, no en localStorage). */
import { Dispatch, useCallback, useEffect, useRef, useState } from "react";
import { getJson, sendJson } from "../../api";
import { once } from "../../build";
import { Action, Draft, Locks, Mode, PlanState, Rank, SolveResponse, StepId, Template, hasContent } from "./planState";

/* ---------------------------------------------------------------- tipos de los catálogos */
export type Archetype = {
  label_es: string;
  weapon_types: string[];
  notes_es?: string;
  skills: { skill_id: number; name_es: string; level: number; tier: number; why_es: string }[];
  discard: { skill_id: number; name_es: string; why_es: string }[];
  requires_bonus_any?: { bonus_id: number; name_es: string }[];
  needs_review?: boolean;
};
export type PlayStyle = { needs_review?: boolean; label_es: string; add: { skill_id: number; name_es: string; level: number; tier: number; why_es: string }[] };
export type Rules = {
  needs_review?: boolean;
  tiers_es: Record<string, string>;
  weapon_types: Record<string, { label_es: string; archetypes: string[] }>;
  archetypes: Record<string, Archetype>;
  play_styles: Record<string, PlayStyle>;
  sources?: Record<string, { title: string; url: string }>;
};
export type SkillCat = {
  id: number;
  name_es: string | null;
  name_en: string;
  /** es con respaldo en en (nunca null en la API nueva) */
  name?: string;
  description?: string | null;
  max_level: number;
  secret: number;
  cap: number;
  unlocks_skill_id: number | null;
  unlocked_by: { bonus_id: number; name_es: string | null; required: number; via: string }[];
  set_bonus_only: boolean;
  set_bonuses: { bonus_id: number; name_es: string | null; required: number }[];
  jewels: { size: number; level: number; double: boolean }[];
  charm_max_level: number | null;
};
export type BonusRank = { required: number; skill_id: number; skill_es: string | null; unlocks_skill_id: number | null; unlocks_es: string | null; skill_name?: string; skill_desc?: string | null; unlocks_all?: boolean };
export type BonusRow = { id: number; name_en: string; name_es: string | null; name?: string; monster_id?: number | null; ranks: BonusRank[]; sets: { id: number; name_es: string | null; rank: string }[] };
export type BonusPiece = { id: number; name_es: string | null; rarity: number; slots: number[]; skills: { skill_id: number; name_es: string | null; name?: string; level: number }[]; defense_max: number };
export type BonusDetail = BonusRow & { pieces: Record<"head" | "chest" | "arms" | "waist" | "legs", BonusPiece[]> };

/* ---------------------------------------------------------------- cargadores */
export const loadRules = () => once("plan:rules", () => getJson<Rules>("/builds/plan/rules"));
export const loadSkills = (rank: Rank) => once(`plan:skills:${rank}`, () => getJson<SkillCat[]>(`/skills?rank=${rank}`));
export const loadSetBonuses = (rank: Rank) => once(`plan:bonuses:${rank}`, () => getJson<BonusRow[]>(`/set-bonuses?rank=${rank}`));
export const loadBonusDetail = (id: number, rank: Rank) => once(`plan:bonus:${id}:${rank}`, () => getJson<BonusDetail>(`/set-bonuses/${id}?rank=${rank}`));

export type TemplateQuery = { monster?: number | null; goal?: string | null; rank: Rank; cap?: string; archetype?: string | null; styles?: string[] };
export function loadTemplate(q: TemplateQuery, signal?: AbortSignal) {
  const p = new URLSearchParams({ rank: q.rank });
  if (q.monster) p.set("monster", String(q.monster));
  else if (q.goal) p.set("goal", q.goal);
  if (q.cap) p.set("cap", q.cap);
  if (q.archetype) p.set("archetype", q.archetype);
  if (q.styles?.length) p.set("styles", q.styles.join(","));
  return getJson<Template>(`/builds/plan/template?${p}`, signal);
}

/** Carga un catálogo una vez y devuelve datos / error (no se repite al re-renderizar). */
export function useCatalog<T>(load: (() => Promise<T>) | null, deps: unknown[]): { data?: T; error?: string } {
  const [st, setSt] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!load) return;
    let live = true;
    setSt({});
    load().then(
      (data) => live && setSt({ data }),
      (e: Error) => live && setSt({ error: e.message }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

/* ---------------------------------------------------------------- borrador */
export const DRAFT_PATH = "/builds/plan/draft";
type DraftResp = { draft: Draft | null; updated_at: string | null };
export const getDraft = (signal?: AbortSignal) => getJson<DraftResp>(DRAFT_PATH, signal);
export const deleteDraft = (signal?: AbortSignal) => sendJson("DELETE", DRAFT_PATH, undefined, signal);

/** Cuerpo del PUT: solo campos que acepta el servidor (extra="forbid"). */
export function draftBody(s: PlanState) {
  const o = s.objective;
  return {
    plan: {
      objective: {
        weapon_type: o.weapon_type,
        weapon_slots: o.weapon_slots.length ? o.weapon_slots.slice(0, 3) : null,
        archetype: o.archetype,
        styles: o.styles,
        rank: o.rank,
        cap: o.cap,
        monster_id: o.monster_id,
        goal: o.goal,
        notes: o.notes,
      },
      targets: s.targets.map((t) => ({ skill_id: t.skill_id, level: t.level, tier: t.tier })),
      set_bonus: s.set_bonus,
      locks: s.locks,
      exclude: s.exclude,
      mode: s.mode,
    },
    step: s.step as StepId,
  };
}
/** Plan en el formato de la API (PlanIn) para guardarlo junto a un equipo o una versión. */
export const planBody = (s: PlanState) => draftBody(s).plan;
export const putDraft = (s: PlanState, signal?: AbortSignal) => sendJson("PUT", DRAFT_PATH, draftBody(s), signal);

export type DraftStatus = "idle" | "saving" | "saved" | "error";

/**
 * Guarda el borrador 1,5 s después del último cambio mientras `dirty`. `enabled` lo pausa
 * (p. ej. mientras el aviso «Continuar borrador» sigue sin respuesta).
 */
export function useDraftAutosave(state: PlanState, enabled: boolean, onSaved: () => void) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const latest = useRef(state);
  latest.current = state;
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !state.dirty || !hasContent(state)) return;
    const t = window.setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setStatus("saving");
      const snap = latest.current;
      putDraft(snap, c.signal).then(
        () => {
          setStatus("saved");
          if (latest.current === snap) saved.current();
        },
        (e: Error) => {
          if (e.name !== "AbortError") setStatus("error");
        },
      );
    }, 1500);
    return () => window.clearTimeout(t);
    // el estado completo cambia en cada edición; `state` es la dependencia correcta
  }, [state, enabled]);

  useEffect(() => () => ctrl.current?.abort(), []);
  return status;
}

/* ---------------------------------------------------------------- buscador de armadura (solve) */
export const SOLVE_PATH = "/builds/plan/solve";

/** Cuerpo del POST: solo campos que acepta el servidor (extra="forbid"). */
export function solveBody(s: PlanState, over?: { locks?: Locks; mode?: Mode }) {
  const o = s.objective;
  const locks = over?.locks ?? s.locks;
  const lk = locks as unknown as Record<string, number | null>;
  // una joya fijada exige su pieza fijada (o ranuras del arma)
  const decorations = locks.decorations.filter((d) => (d.piece === "weapon" ? o.weapon_slots.length > 0 : lk[d.piece] != null));
  return {
    rank: o.rank,
    cap: o.cap,
    ref_monster_id: o.monster_id,
    weapon_slots: o.weapon_slots.length ? o.weapon_slots.slice(0, 3) : null,
    targets: s.targets.map((t) => ({ skill_id: t.skill_id, level: t.level, tier: t.tier })),
    set_bonus: s.set_bonus,
    locks: { head: locks.head, chest: locks.chest, arms: locks.arms, waist: locks.waist, legs: locks.legs, charm: locks.charm, decorations },
    exclude: s.exclude,
    mode: over?.mode ?? s.mode,
    max_results: 5,
  };
}
export type SolveBodyOut = ReturnType<typeof solveBody>;
export const solveSig = (s: PlanState) => JSON.stringify(solveBody(s));

export const solve = (body: SolveBodyOut, signal?: AbortSignal) => sendJson<SolveResponse>("POST", SOLVE_PATH, body, signal);

/** Mensaje amable en español para errores del buscador (422, 429, red). */
export function solveMessage(e: Error): string {
  const m = e.message || "";
  if (/c[aá]lculo en curso|\b429\b/.test(m)) return "Ya hay un cálculo en curso. Espera a que termine y vuelve a pulsar el botón.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "No se pudo conectar con el servidor. Comprueba que la guía sigue abierta.";
  if (/^Error \d+$/.test(m)) return `El servidor no pudo calcular (${m.replace("Error ", "código ")}). Inténtalo de nuevo.`;
  return `No se pudo calcular: ${m}`;
}

/** Nombres de piezas vistos en resultados, para poder listar exclusiones aunque el resultado ya no las traiga. */
export const pieceNames = new Map<number, string>();

/**
 * Lanza un cálculo cancelando el anterior (AbortController). `busy` y `status` alimentan la región aria-live.
 * Usa siempre el estado más reciente salvo lo que se pase en `over`.
 */
export function useSolver(state: PlanState, dispatch: Dispatch<Action>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const ctrl = useRef<AbortController | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(
    async (over?: { locks?: Locks; mode?: Mode }) => {
      const s = latest.current;
      if (!s.targets.length) {
        setError("Elige al menos una habilidad en el paso «Habilidades» antes de buscar.");
        setStatus("");
        return;
      }
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setBusy(true);
      setError(null);
      setStatus("Calculando armadura…");
      const merged = { ...s, locks: over?.locks ?? s.locks, mode: over?.mode ?? s.mode };
      try {
        const resp = await solve(solveBody(s, over), c.signal);
        for (const r of resp.results) for (const p of r.pieces) if (!p.empty) pieceNames.set(p.id, p.name_es || p.name_en);
        dispatch({ type: "solved", resp, sig: solveSig(merged) });
        const n = resp.results.length;
        setStatus(n ? `${n} ${n === 1 ? "opción encontrada" : "opciones encontradas"} en ${(resp.elapsed_ms / 1000).toFixed(1)} s.` : "No se encontró ninguna combinación.");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(solveMessage(e as Error));
        setStatus("");
      } finally {
        if (ctrl.current === c) setBusy(false);
      }
    },
    [dispatch],
  );
  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setBusy(false);
    setStatus("Cálculo cancelado.");
  }, []);
  return { busy, error, status, run, cancel };
}

/* ---------------------------------------------------------------- versiones y registro de pruebas */
export type TestLog = {
  monster_id: number;
  tier: "normal" | "templado" | "arch_templado";
  checklist: Partial<Record<CheckKey, "bien" | "regular" | "mal">>;
  gaps: CheckKey[];
  minutes: number;
  carts: number;
  notes: string;
  verdict: "lista" | "ajustar" | "descartar";
};
export type CheckKey = "comodidad" | "ritmo" | "habilidades" | "supervivencia" | "estados" | "dano" | "afilado" | "movilidad";
export type VersionMeta = { id: number; build_id: number; seq: number; label: string; parent_id: number | null; created_at: string; updated_at: string; has_tests: number | boolean };
export type VersionFull = Omit<VersionMeta, "has_tests"> & { payload: Record<string, unknown>; plan: Record<string, unknown> | null; tests: TestLog[] | null };

const vBase = (savedId: string | number) => `/builds/saved/${encodeURIComponent(String(savedId))}/versions`;
export const listVersions = (savedId: string | number, signal?: AbortSignal) => getJson<VersionMeta[]>(vBase(savedId), signal);
export const getVersion = (savedId: string | number, vid: number, signal?: AbortSignal) => getJson<VersionFull>(`${vBase(savedId)}/${vid}`, signal);
export const createVersion = (savedId: string | number, body: { label?: string; major: boolean; payload: Record<string, unknown>; plan: unknown; tests: TestLog[]; parent_id: number | null }) =>
  sendJson<VersionFull>("POST", vBase(savedId), { ...body, label: body.label || undefined });
export const patchVersion = (savedId: string | number, vid: number, patch: { label?: string; tests?: TestLog[] }) => sendJson<VersionFull>("PUT", `${vBase(savedId)}/${vid}`, patch);
export const restoreVersion = (savedId: string | number, vid: number) => sendJson<VersionFull>("POST", `${vBase(savedId)}/${vid}/restore`);
export const deleteVersion = (savedId: string | number, vid: number) => sendJson("DELETE", `${vBase(savedId)}/${vid}`);

/** Mensaje en español para errores de versiones. */
export function versionMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/M[aá]ximo \d+ versiones/i.test(m)) return m;
  if (/etiqueta/i.test(m)) return m;
  if (/demasiado grande|413/.test(m)) return "La versión es demasiado grande (máx. 64 KB).";
  if (/No se encontr|404/.test(m)) return "Esa versión o ese equipo ya no existe.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "No se pudo conectar con el servidor.";
  return m || "No se pudo completar la operación.";
}
