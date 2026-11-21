/* Paso 5: el motor propone 3-5 bases de armadura; se pueden fijar o excluir piezas y recalcular. */
import { DecoChip } from "../../../components/BuildView";
import { SLOT_ES, SLOTS, SlotId, loadOwned } from "../../../build";
import { useRovingKeys } from "../../../components/ui";
import { RANK_LABEL } from "../../../labels";
import { pieceNames, useCatalog, useSolver } from "../planApi";
import { PlanState, ResultPiece, SolveResult } from "../planState";
import { StepProps } from "./common";
import PieceTile from "./PieceTile";
import { LockToggle, ResultTabs, SolverNotes, placedDecos } from "./solveUi";

const PANEL = "pl-arm-panel";

function SetBonusStatus({ state, r }: { state: PlanState; r: SolveResult }) {
  const sb = state.set_bonus;
  if (!sb) return null;
  const act = r.set_bonuses.find((b) => b.bonus_id === sb.bonus_id);
  const ok = !!act && act.pieces >= sb.required;
  return (
    <p className={`pl-msg ${ok ? "pl-msg--ok" : "pl-msg--warn"}`}>
      <b aria-hidden>{ok ? "✓ " : "✕ "}</b>
      {ok && act
        ? `Bono de set activo: ${act.name_es} (${act.pieces}/${sb.required} piezas).`
        : `El bono de set pedido no queda activo en esta opción (necesita ${sb.required} piezas).`}
    </p>
  );
}

function PieceCard({ p, r, state, dispatch }: { p: Extract<ResultPiece, { id: number }>; r: SolveResult; state: PlanState; dispatch: StepProps["dispatch"] }) {
  const slot = p.type as SlotId;
  const locked = state.locks[slot] === p.id;
  const name = p.name_es || p.name_en;
  const onlyBonus = !!p.aporta_es && p.aporta_es.startsWith("Solo activa");
  const placed = placedDecos(r, slot, p.slots);
  const gives = p.aporta_es?.startsWith("Aporta ") && !p.aporta_es.startsWith("Aporta ranuras") ? p.aporta_es.slice(7).split(/,\s*/) : [];
  const skills = gives.map((t) => {
    const m = /^(.*?)\s*\+(\d+)$/.exec(t);
    return { name: m ? m[1] : t, level: m ? Number(m[2]) : 0, hit: true };
  });
  return (
    <li>
      <PieceTile
        slot={slot}
        rarity={p.rarity}
        name={name}
        part={SLOT_ES[slot]}
        meta={`${p.set_name_es} · ${RANK_LABEL[p.rank] ?? p.rank} · def ${p.defense_base}→${p.defense_max}`}
        slots={p.slots}
        jewels={placed.map((d) => (d ? <DecoChip id={d.decoration_id} name={d.name_es || d.name_en} size={d.size} difficulty={d.difficulty} owned={d.owned} /> : undefined))}
        skills={skills}
        role={onlyBonus ? "activa" : null}
        roleText={onlyBonus ? p.aporta_es : undefined}
        owned={p.owned}
        selected={locked}
        actions={
          <>
            <LockToggle on={locked} label={`${SLOT_ES[slot]}: ${name}`} onToggle={() => dispatch({ type: "toggleLock", kind: "piece", slot, id: p.id })} />
            <button type="button" className="pl-btn" aria-label={`Excluir ${name}`} onClick={() => dispatch({ type: "excludePiece", id: p.id })}>
              Excluir
            </button>
          </>
        }
      />
      {(!p.aporta_es || p.aporta_es.startsWith("No aporta")) && <p className="pl-muted">No aporta a los objetivos.</p>}
    </li>
  );
}

export default function Armadura({ state, dispatch, go }: StepProps) {
  const { busy, error, status, run, cancel } = useSolver(state, dispatch);
  const owned = useCatalog(loadOwned, []);
  const ownedOk = owned.data?.available === true;
  const r = state.results[state.selected];
  const nLocked = SLOTS.filter((s) => state.locks[s] != null).length;
  const excluded = state.exclude.armor;

  return (
    <div className="pl-stack">
      <p className="pl-lead">
        El asistente prueba combinaciones de piezas para cumplir tus objetivos y te propone hasta 5 bases. Fija las piezas que te gusten, excluye las que no
        quieras y recalcula.
      </p>

      <section className="pl-card" aria-labelledby="pl-arm-h">
        <h3 id="pl-arm-h" className="pl-h3">Buscar armadura</h3>
        <div
          className="pl-seg"
          role="radiogroup"
          aria-label="Con qué equipo contar"
          onKeyDown={useRovingKeys(ownedOk ? 2 : 1, state.mode === "owned" ? 1 : 0, (i) => dispatch({ type: "setMode", mode: i === 1 ? "owned" : "ideal" }))}
        >
          <button type="button" role="radio" aria-checked={state.mode === "ideal"} tabIndex={state.mode === "ideal" || !ownedOk ? 0 : -1} className={state.mode === "ideal" ? "pl-seg__b pl-seg__b--on" : "pl-seg__b"} onClick={() => dispatch({ type: "setMode", mode: "ideal" })}>
            Catálogo completo
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.mode === "owned"}
            tabIndex={state.mode === "owned" ? 0 : -1}
            disabled={!ownedOk}
            className={state.mode === "owned" ? "pl-seg__b pl-seg__b--on" : "pl-seg__b"}
            onClick={() => dispatch({ type: "setMode", mode: "owned" })}
          >
            Mis cosas
          </button>
        </div>
        {!ownedOk && <p className="pl-muted">«Mis cosas» necesita que importes tu partida en el perfil del cazador.</p>}
        <div className="pl-row pl-row--act">
          <button type="button" className="bd-btn" disabled={busy || !state.targets.length} aria-busy={busy} onClick={() => run()}>
            {busy ? "Calculando…" : "Buscar armadura"}
          </button>
          {busy && (
            <button type="button" className="bd-btn bd-btn--ghost" onClick={cancel}>
              Cancelar
            </button>
          )}
        </div>
        {!state.targets.length && (
          <p className="pl-note" role="note">
            Aún no hay habilidades objetivo.{" "}
            <button type="button" className="pl-linkbtn" onClick={() => go("habilidades")}>
              Elegir habilidades
            </button>
          </p>
        )}
        <p className="pl-status" role="status" aria-live="polite" aria-atomic="true">
          {status}
        </p>
        {error && (
          <p className="pl-msg pl-msg--err" role="alert">
            {error}
          </p>
        )}
      </section>

      <SolverNotes state={state} />

      {state.solved && state.results.length === 0 && (
        <section className="pl-card" aria-labelledby="pl-arm-empty">
          <h3 id="pl-arm-empty" className="pl-h3">Sin resultados</h3>
          <p>No se encontró ninguna combinación con estas condiciones.</p>
          <ul className="pl-bul">
            <li>Baja el nivel o pasa a secundaria alguna habilidad primaria.</li>
            <li>Quita el bono de set o elige otro con menos piezas.</li>
            {state.mode === "owned" && <li>Prueba con «Catálogo completo» para ver qué te falta.</li>}
            {(nLocked > 0 || excluded.length > 0) && <li>Quita piezas fijadas o exclusiones: pueden estar bloqueando todas las opciones.</li>}
          </ul>
        </section>
      )}

      {state.results.length > 0 && r && (
        <section className="pl-stack" aria-label="Resultados">
          <ResultTabs results={state.results} selected={state.selected} onPick={(i) => dispatch({ type: "pickResult", index: i })} panelId={PANEL} />
          <div id={PANEL} role="tabpanel" aria-labelledby={`${PANEL}-t${state.selected}`} className="pl-stack">
            {r.scenario_es && <p className="pl-muted">{r.scenario_es}</p>}
            <ul className="pl-pcs">
              {r.pieces.map((p, i) =>
                p.empty ? (
                  <li key={`e${i}`}>
                    <PieceTile slot={p.type} part={SLOT_ES[p.type]} meta="Sin pieza en esta opción" />
                  </li>
                ) : (
                  <PieceCard key={p.id} p={p} r={r} state={state} dispatch={dispatch} />
                ),
              )}
            </ul>
            <SetBonusStatus state={state} r={r} />
            <div className="pl-row pl-row--act">
              <button type="button" className="bd-btn" disabled={busy} onClick={() => run()}>
                Recalcular con fijadas
              </button>
              <button type="button" className="bd-btn bd-btn--ghost" onClick={() => go("joyas")}>
                Ver joyas y amuleto
              </button>
              {nLocked > 0 && <span className="pl-muted">{nLocked === 1 ? "1 pieza fijada" : `${nLocked} piezas fijadas`}</span>}
            </div>
          </div>
        </section>
      )}

      {excluded.length > 0 && (
        <section className="pl-card" aria-labelledby="pl-arm-ex">
          <h3 id="pl-arm-ex" className="pl-h3">Piezas excluidas</h3>
          <ul className="pl-list">
            {excluded.map((id) => (
              <li key={id} className="pl-row-item pl-row-item--ex">
                <span className="pl-row-item__n">{pieceNames.get(id) ?? `Pieza #${id}`}</span>
                <button type="button" className="pl-btn" aria-label={`Quitar la exclusión de ${pieceNames.get(id) ?? `pieza ${id}`}`} onClick={() => dispatch({ type: "unexcludePiece", id })}>
                  Quitar exclusión
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
