/* Constructor por pasos (método de Dem): /constructor?paso=objetivo|habilidades|bono|prioridades|armadura|joyas|probar */
import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJson } from "../../api";
import Dialog from "../../components/Dialog";
import type { EditorSeed } from "./editor/EditorPage";
import { SavedRow, fromRow, SAVED_PATH } from "../../build";
import { Gem, KeyCap, useKeyPair } from "../../components/book";
import { OwnedBadge } from "../../components/BuildView";
import { Loading } from "../../components/ui";
import { RANK_LABEL } from "../../labels";
import "../../builder.css";
import "../../planner.css";
import { DraftStatus, SkillCat, deleteDraft, getDraft, getVersion, loadSetBonuses, loadSkills, loadTemplate, solveSig, useCatalog, useDraftAutosave } from "./planApi";
import {
  Draft,
  PlanState,
  SolveResult,
  STEPS,
  StepId,
  TIER_NAME,
  Tier,
  emptyObjective,
  hasContent,
  initialPlan,
  loadoutFromResult,
  planReducer,
  readBoot,
  stepFromParams,
} from "./planState";
import Armadura from "./steps/Armadura";
import BonoSet from "./steps/BonoSet";
import { skillLabel } from "./steps/common";
import Habilidades from "./steps/Habilidades";
import JoyasAmuleto from "./steps/JoyasAmuleto";
import Objetivo from "./steps/Objetivo";
import Prioridades from "./steps/Prioridades";

/* El editor actual (Builder) es el paso «Probar»; se carga solo al llegar a él. */
const Editor = lazy(() => import("./editor/EditorPage"));

type Badge = { text: string; tone: "ok" | "todo" | "opt" | "soon" };
function badgeFor(id: StepId, s: PlanState): Badge {
  const o = s.objective;
  switch (id) {
    case "objetivo":
      return o.weapon_type || o.archetype || o.monster_id || o.goal ? { text: "Hecho", tone: "ok" } : { text: "Pendiente", tone: "todo" };
    case "habilidades":
      return s.targets.length ? { text: `${s.targets.length}`, tone: "ok" } : { text: "Pendiente", tone: "todo" };
    case "bono":
      return s.set_bonus ? { text: "Elegido", tone: "ok" } : { text: "Opcional", tone: "opt" };
    case "prioridades":
      return s.targets.some((t) => t.tier === 1) ? { text: "Hecho", tone: "ok" } : { text: s.targets.length ? "Revisar" : "Pendiente", tone: "todo" };
    case "armadura":
      return s.results.length ? { text: `${s.results.length} opc.`, tone: "ok" } : s.solved ? { text: "Sin resultados", tone: "todo" } : { text: "Pendiente", tone: "todo" };
    case "joyas": {
      const r = s.results[s.selected];
      if (!r) return { text: "Pendiente", tone: "todo" };
      const ok = r.coverage.filter((c) => c.status === "ok").length;
      return { text: `${ok}/${r.coverage.length}`, tone: ok === r.coverage.length ? "ok" : "todo" };
    }
    case "probar":
      return { text: "Editor", tone: "opt" };
  }
}

function StepNav({ state, step, onPick }: { state: PlanState; step: StepId; onPick: (s: StepId) => void }) {
  return (
    <nav aria-label="Pasos del constructor" className="pl-nav">
      <ol className="pl-steps">
        {STEPS.map((s) => {
          const b = badgeFor(s.id, state);
          return (
            <li key={s.id}>
              <button type="button" className="pl-step" aria-current={s.id === step ? "step" : undefined} onClick={() => onPick(s.id)}>
                <Gem active={s.id === step} size={20} />
                <span className="pl-step__t">{s.label}</span>
                <span className="pl-step__st">
                  {b.tone === "ok" && <OwnedBadge title="Paso completado" />}
                  <span className={`pl-badge pl-badge--${b.tone}`}>{b.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function LiveCoverage({ state, skills }: { state: PlanState; skills: Map<number, SkillCat> | undefined }) {
  const r = state.results[state.selected];
  if (!r) return null;
  const stale = state.solved ? state.solved.sig !== solveSig(state) : false;
  return (
    <div className="pl-sum__cov" aria-label="Cobertura de la opción elegida">
      <h3 className="pl-h4">Cobertura · opción {state.selected + 1}</h3>
      <ul className="pl-sumcov">
        {r.coverage.map((c) => (
          <li key={c.skill_id} className={`pl-sumcov__i pl-sumcov__i--${c.status}`}>
            <span aria-hidden>{c.status === "ok" ? "✓" : c.status === "parcial" ? "◐" : "✕"}</span> {skillLabel(skills, c.skill_id)} <b>{c.achieved}/{c.target}</b>
            <span className="pl-sr"> {c.status === "ok" ? "completa" : c.status === "parcial" ? "parcial" : "falta"}</span>
          </li>
        ))}
      </ul>
      {stale && <p className="pl-muted">Datos anteriores al último cambio del plan.</p>}
    </div>
  );
}

const STATUS_TXT: Record<DraftStatus, string> = { idle: "", saving: "Guardando borrador…", saved: "Borrador guardado", error: "No se pudo guardar el borrador" };

export default function Wizard() {
  const [sp, setSp] = useSearchParams();
  const [state, dispatch] = useReducer(planReducer, undefined, initialPlan);
  const step = stepFromParams(sp);
  const idx = STEPS.findIndex((s) => s.id === step);
  const [offer, setOffer] = useState<Draft | null>(null);
  const [bootDone, setBootDone] = useState(() => readBoot(sp).kind !== "none");
  const [navOpen, setNavOpen] = useState(false);
  const [live, setLive] = useState("");
  const [visitedEditor, setVisitedEditor] = useState(step === "probar");
  const [seed, setSeed] = useState<EditorSeed | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const booted = useRef(false);

  /* el paso vive en la URL; el estado lo refleja */
  useEffect(() => {
    dispatch({ type: "setStep", step });
    if (step === "probar") setVisitedEditor(true);
  }, [step]);

  const go = useCallback(
    (id: StepId) => {
      const n = new URLSearchParams(sp);
      n.set("paso", id);
      setSp(n);
      setNavOpen(false);
    },
    [sp, setSp],
  );

  /* arranque: enlaces antiguos (?monster|goal…), ?guardado= o borrador previo */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const b = readBoot(sp);
    if (b.kind === "legacy") {
      const objective = { ...emptyObjective(), monster_id: b.monster, goal: b.goal, rank: b.rank ?? "HR", cap: b.cap };
      dispatch({ type: "loadDraft", draft: { plan: { objective, mode: b.owned ? "owned" : "ideal" }, step: "probar" } });
      loadTemplate({ monster: b.monster, goal: b.goal, rank: objective.rank, cap: b.cap })
        .then((template) => dispatch({ type: "applyTemplate", template, silent: true }))
        .catch(() => undefined); // la plantilla es solo informativa; el editor sigue funcionando
      return;
    }
    if (b.kind === "saved" && b.saved != null) {
      /* ?guardado=ID[&v=VID]: carga el equipo (y la versión) en el editor y el plan en el asistente */
      const sid = b.saved;
      const c = new AbortController();
      (async () => {
        try {
          const rows = await getJson<SavedRow[]>(SAVED_PATH, c.signal);
          const row = (rows as (SavedRow & { plan?: Record<string, unknown> | null; current_version_id?: number | null })[]).find((r) => r.id === sid);
          if (!row) throw new Error("No se encontró el equipo guardado.");
          let payload = row.payload;
          let plan = row.plan ?? null;
          const vid = b.version ?? row.current_version_id ?? null;
          if (b.version != null) {
            const v = await getVersion(sid, b.version, c.signal);
            payload = v.payload;
            plan = v.plan ?? plan;
          }
          const sb = fromRow({ ...row, payload });
          dispatch({ type: "loadDraft", draft: { plan: (plan ?? {}) as never, step: "probar", saved_id: sid } });
          setSeed((p) => ({ nonce: (p?.nonce ?? 0) + 1, state: sb.state, label: `Cargado «${row.name}»${b.version != null ? ` (versión #${b.version})` : ""}.`, savedId: String(sid), name: row.name, versionId: vid }));
          setVisitedEditor(true);
          setLive(`Equipo «${row.name}» cargado en el editor.`);
        } catch (e) {
          if ((e as Error).name !== "AbortError") setBootError(`No se pudo abrir el equipo guardado: ${(e as Error).message}`);
        } finally {
          setBootDone(true);
        }
      })();
      return () => c.abort();
    }
    const c = new AbortController();
    getDraft(c.signal)
      .then((r) => {
        if (r.draft && (r.draft.plan?.targets?.length || r.draft.plan?.objective)) setOffer(r.draft);
      })
      .catch(() => undefined)
      .finally(() => setBootDone(true));
    return () => c.abort();
  }, [sp]);

  const status = useDraftAutosave(state, bootDone && !offer, useCallback(() => dispatch({ type: "markSaved" }), []));

  const skillsCat = useCatalog(() => loadSkills(state.objective.rank), [state.objective.rank]);
  const bonusCat = useCatalog(() => loadSetBonuses(state.objective.rank), [state.objective.rank]);
  const skills = useMemo(() => (skillsCat.data ? new Map(skillsCat.data.map((s) => [s.id, s])) : undefined), [skillsCat.data]);

  /* foco y anuncio al cambiar de paso */
  const cur = STEPS[idx];
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    setLive(`Paso ${idx + 1} de ${STEPS.length}: ${cur.label}`);
    headRef.current?.focus({ preventScroll: false });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = () => idx > 0 && go(STEPS[idx - 1].id);
  const next = () => idx < STEPS.length - 1 && go(STEPS[idx + 1].id);
  useKeyPair("q", "e", prev, next);

  /* «Usar esta base»: el editor (Builder) recibe el equipo por la prop `seed` y el asistente pasa a «Probar» */
  const useBase = useCallback(
    (r: SolveResult) => {
      const ls = loadoutFromResult(r);
      const decos = r.decorations.map((d) => ({ id: d.decoration_id, name: d.name_es || d.name_en, size: d.size, difficulty: d.difficulty }));
      setSeed((p) => ({ nonce: (p?.nonce ?? 0) + 1, state: ls, decos, label: `Base del asistente: ${r.name_es}` }));
      setVisitedEditor(true);
      go("probar");
    },
    [go],
  );
  const common = { state, dispatch, skills, go, onUseBase: useBase };

  const continueDraft = () => {
    if (!offer) return;
    dispatch({ type: "loadDraft", draft: offer });
    setOffer(null);
    const s = offer.step;
    if (s && STEPS.some((x) => x.id === s)) {
      const n = new URLSearchParams(sp);
      n.set("paso", s);
      setSp(n, { replace: true });
    }
  };
  const startOver = () => {
    deleteDraft().catch(() => undefined);
    dispatch({ type: "reset" });
    setOffer(null);
  };

  return (
    <div className="pl">
      <h1 className="page-title">Constructor de equipo</h1>

      {bootError && (
        <p className="pl-msg pl-msg--err" role="alert">
          {bootError}
        </p>
      )}

      {offer && (
        <section className="pl-banner" aria-label="Borrador anterior">
          <p>
            <b>Tienes un borrador sin terminar</b>
            {offer.plan?.targets?.length ? ` con ${offer.plan.targets.length} habilidades` : ""}. ¿Quieres continuar donde lo dejaste?
          </p>
          <div className="pl-row">
            <button type="button" className="bd-btn" onClick={continueDraft}>
              Continuar borrador
            </button>
            <button type="button" className="bd-btn bd-btn--ghost" onClick={startOver}>
              Empezar de cero
            </button>
          </div>
        </section>
      )}

      <div className="pl-toolbar">
        <button type="button" className="bd-btn bd-btn--ghost pl-drawerbtn" aria-haspopup="dialog" onClick={() => setNavOpen(true)}>
          Pasos ({idx + 1} de {STEPS.length}: {cur.label})
        </button>
      </div>
      <Dialog open={navOpen} onClose={() => setNavOpen(false)} title="Pasos del constructor" variant="drawer">
        <StepNav state={state} step={step} onPick={go} />
      </Dialog>

      <div className="pl-layout">
        <div className="pl-side">
          <StepNav state={state} step={step} onPick={go} />
        </div>

        <section className="pl-main" aria-labelledby="pl-h2">
          <h2 id="pl-h2" ref={headRef} tabIndex={-1} className="pl-h2">
            <span className="pl-h2__n">Paso {idx + 1} de {STEPS.length}</span> {cur.label}
          </h2>
          {step === "objetivo" && <Objetivo {...common} />}
          {step === "habilidades" && <Habilidades {...common} />}
          {step === "bono" && <BonoSet {...common} />}
          {step === "prioridades" && <Prioridades {...common} />}
          {step === "armadura" && <Armadura {...common} />}
          {step === "joyas" && <JoyasAmuleto {...common} />}
          {visitedEditor && (
            <div hidden={step !== "probar"}>
              <Suspense fallback={<Loading />}>
                <Editor embedded seed={seed} plan={{ state, dispatch, skills, bootVersion: readBoot(sp).version }} />
              </Suspense>
            </div>
          )}

          <div className="pl-pager">
            <button type="button" className="bd-btn bd-btn--ghost" onClick={prev} disabled={idx === 0}>
              Anterior
            </button>
            <span className="pl-keys" aria-hidden>
              <KeyCap title="Paso anterior (Q)">Q</KeyCap>
              <KeyCap title="Paso siguiente (E)">E</KeyCap>
            </span>
            <button type="button" className="bd-btn" onClick={next} disabled={idx === STEPS.length - 1}>
              Siguiente
            </button>
          </div>
        </section>

        <aside className="pl-summary" aria-label="Resumen del plan">
          <h2 className="pl-h3">Tu plan</h2>
          <p className="pl-muted">
            {RANK_LABEL[state.objective.rank]} · {state.mode === "owned" ? "solo mis cosas" : "catálogo completo"}
          </p>
          {state.set_bonus && (() => {
            const id = state.set_bonus.bonus_id;
            const b = bonusCat.data?.find((x) => x.id === id);
            const nm = b ? b.name || b.name_es || b.name_en : null;
            return <p className="pl-muted">Bono de set: {nm ? `«${nm}» (${state.set_bonus.required} piezas)` : `${state.set_bonus.required} piezas`}</p>;
          })()}
          {state.targets.length === 0 ? (
            <p className="pl-muted">Aún sin habilidades.</p>
          ) : (
            ([1, 2, 3] as Tier[]).map((t) => {
              const items = state.targets.filter((x) => x.tier === t);
              return items.length ? (
                <div key={t} className="pl-sum__g">
                  <h3 className="pl-h4">{TIER_NAME[t]}s</h3>
                  <ul>
                    {items.map((x) => (
                      <li key={x.skill_id}>
                        {skillLabel(skills, x.skill_id)} <b>{x.level}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })
          )}
          <LiveCoverage state={state} skills={skills} />
          <p className={`pl-draft pl-draft--${status}`}>{hasContent(state) ? STATUS_TXT[status] : ""}</p>
        </aside>
      </div>

      <div className="pl-sr" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </div>
    </div>
  );
}
