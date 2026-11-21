/* Paso 6: qué cubre cada origen (armadura, amuleto, joyas), qué falta y qué compromisos tomó el motor. */
import { DecoChip, DefenseBox, Resistances, SlotRow } from "../../../components/BuildView";
import { SLOT_ES } from "../../../build";
import { useSolver } from "../planApi";
import { PlanState, ResultPiece, SolveResult, lockBase } from "../planState";
import { StepProps } from "./common";
import CoverageChecklist from "./CoverageChecklist";
import PieceTile from "./PieceTile";
import { LockToggle, ResultTabs, StaleNote, lockedDecoCount, placedDecos } from "./solveUi";

const PANEL = "pl-joy-panel";

function PieceJewels({ r, piece, sizes, label, state, dispatch, pieceId }: { r: SolveResult; piece: string; sizes: number[]; label: string; state: PlanState; dispatch: StepProps["dispatch"]; pieceId: number | null }) {
  const placed = placedDecos(r, piece, sizes);
  const seen = new Map<number, number>();
  return (
    <li className="pl-jp">
      <span className="pl-jp__l" title={label}>{label}</span>
      <div className="pl-jp__s">
        {sizes.map((sz, i) => {
          const d = placed[i];
          if (!d) return <SlotRow key={i} size={sz} />;
          const k = seen.get(d.decoration_id) ?? 0;
          seen.set(d.decoration_id, k + 1);
          const locked = lockedDecoCount(state, d.decoration_id, piece) > k;
          const name = d.name_es || d.name_en;
          return (
            <SlotRow key={i} size={sz}>
              <span className="pl-jrow">
                <DecoChip id={d.decoration_id} name={name} size={d.size} difficulty={d.difficulty} owned={d.owned} />
                <small className="pl-jrow__sk">{d.skills.map((s) => `${s.name_es} +${s.level}`).join(", ")}</small>
                <LockToggle
                  on={locked}
                  label={`joya ${name} en ${label}`}
                  onToggle={() => dispatch({ type: "toggleLock", kind: "deco", id: d.decoration_id, piece, pieceId, locked })}
                />
              </span>
            </SlotRow>
          );
        })}
      </div>
    </li>
  );
}

export default function JoyasAmuleto({ state, dispatch, go, onUseBase }: StepProps) {
  const { busy, error, status, run } = useSolver(state, dispatch);
  const r = state.results[state.selected];

  if (!r) {
    return (
      <div className="pl-stack">
        <p className="pl-lead">Aquí verás qué aporta cada pieza, el amuleto y las joyas, qué te falta y qué compromisos se han tomado.</p>
        <p className="pl-empty">
          Todavía no hay una base de armadura.{" "}
          <button type="button" className="pl-linkbtn" onClick={() => go("armadura")}>
            Buscar armadura
          </button>
        </p>
      </div>
    );
  }

  const weapon = r.loadout.weapon_slots ?? [];
  const charm = r.charm;
  const charmLocked = !!charm && state.locks.charm === charm.id;
  const notOwnedPieces = r.pieces.filter((p): p is Extract<ResultPiece, { id: number }> => !p.empty && p.owned === false);
  const recalcJewels = () => {
    const locks = lockBase(state.locks, r);
    dispatch({ type: "setLocks", locks });
    run({ locks });
  };
  const freeTxt = r.slots_free.length ? r.slots_free.map((s) => `${SLOT_ES[s.piece] ?? s.piece} (tamaño ${s.size})`).join(", ") : "";
  const hasMissing = r.missing.jewels.length > 0 || notOwnedPieces.length > 0 || r.missing.charm_owned === false;

  return (
    <div className="pl-stack">
      <p className="pl-lead">Primero el amuleto, para las habilidades que costarían más ranuras; después las joyas de las primarias y, con lo que sobre, el resto.</p>

      <ResultTabs results={state.results} selected={state.selected} onPick={(i) => dispatch({ type: "pickResult", index: i })} panelId={PANEL} />
      <StaleNote state={state} />

      <div id={PANEL} role="tabpanel" aria-labelledby={`${PANEL}-t${state.selected}`} className="pl-stack">
        <section className="pl-card" aria-labelledby="pl-joy-cov">
          <h3 id="pl-joy-cov" className="pl-h3">Cobertura de objetivos</h3>
          <CoverageChecklist rows={r.coverage} />
        </section>

        <section className="pl-card" aria-labelledby="pl-joy-charm">
          <h3 id="pl-joy-charm" className="pl-h3">Amuleto</h3>
          {charm ? (
            <PieceTile
              slot="charm"
              rarity={charm.rarity}
              name={charm.name_es || charm.name_en}
              part="Amuleto"
              meta={(charm.skills ?? []).length ? undefined : charm.generic_es}
              skills={(charm.skills ?? []).map((k) => ({ name: k.name_es ?? `Habilidad ${k.skill_id}`, level: k.level, hit: true }))}
              owned={charm.owned}
              selected={charmLocked}
              actions={<LockToggle on={charmLocked} label={`amuleto ${charm.name_es || charm.name_en}`} onToggle={() => dispatch({ type: "toggleLock", kind: "charm", id: charm.id })} />}
            />
          ) : (
            <p className="pl-muted">Esta opción no usa amuleto.</p>
          )}
        </section>

        <section className="pl-card" aria-labelledby="pl-joy-j">
          <h3 id="pl-joy-j" className="pl-h3">Joyas</h3>
          <ul className="pl-jps">
            {r.pieces.map((p) =>
              p.empty || p.slots.length === 0 ? null : (
                <PieceJewels key={p.id} r={r} piece={p.type} sizes={p.slots} label={`${SLOT_ES[p.type]}: ${p.name_es || p.name_en}`} state={state} dispatch={dispatch} pieceId={p.id} />
              ),
            )}
            {weapon.length > 0 && <PieceJewels r={r} piece="weapon" sizes={weapon} label="Arma" state={state} dispatch={dispatch} pieceId={null} />}
          </ul>
          {!r.decorations.length && <p className="pl-muted">No hace falta ninguna joya en esta opción.</p>}
          {freeTxt && <p className="pl-muted">Ranuras libres: {freeTxt}.</p>}
        </section>

        <section className="pl-card" aria-labelledby="pl-joy-miss">
          <h3 id="pl-joy-miss" className="pl-h3">Lo que te falta</h3>
          {hasMissing ? (
            <ul className="pl-callouts">
              {r.missing.jewels.map((j) => (
                <li key={j.decoration_id} className="pl-note">
                  {j.text_es}
                  {j.difficulty && j.difficulty !== "normal" && <span className="pl-tag"> {j.difficulty}</span>}
                </li>
              ))}
              {r.missing.charm_owned === false && charm && <li className="pl-note">No tienes el amuleto «{charm.name_es || charm.name_en}».</li>}
              {notOwnedPieces.map((p) => (
                <li key={`m${p.id}`} className="pl-note">No tienes {p.name_es || p.name_en} ({SLOT_ES[p.type]}).</li>
              ))}
            </ul>
          ) : (
            <p className="pl-muted">{state.solved?.mode === "owned" ? "Con lo que tienes en el cofre no falta nada." : "En modo catálogo completo no se comprueba tu cofre."}</p>
          )}
        </section>

        <section className="pl-card" aria-labelledby="pl-joy-trade">
          <h3 id="pl-joy-trade" className="pl-h3">Compromisos</h3>
          {r.tradeoffs_es.length ? (
            <ul className="pl-callouts">
              {r.tradeoffs_es.map((t, i) => (
                <li key={i} className="pl-note">{t}</li>
              ))}
            </ul>
          ) : (
            <p className="pl-muted">Sin compromisos: todo lo pedido entra.</p>
          )}
          {r.warnings.map((w, i) => (
            <p key={i} className="pl-note" role="note">
              {w}
            </p>
          ))}
        </section>

        <section className="pl-card" aria-labelledby="pl-joy-def">
          <h3 id="pl-joy-def" className="pl-h3">Defensa y resistencias</h3>
          <DefenseBox d={r.defense} />
          <Resistances res={r.resistances} />
        </section>

        <div className="pl-row pl-row--act">
          <button type="button" className="bd-btn" disabled={busy} aria-busy={busy} onClick={recalcJewels}>
            {busy ? "Calculando…" : "Recalcular joyas"}
          </button>
          <button type="button" className="bd-btn" onClick={() => onUseBase?.(r)}>
            Usar esta base
          </button>
        </div>
        <p className="pl-muted">«Recalcular joyas» fija las piezas y el amuleto y vuelve a repartir las joyas. «Usar esta base» la copia al editor del último paso.</p>
        <p className="pl-status" role="status" aria-live="polite" aria-atomic="true">
          {status}
        </p>
        {error && (
          <p className="pl-msg pl-msg--err" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
