/* Piezas comunes de los pasos Armadura y Joyas: fijar, pestañas de resultados y aviso de resultados desfasados. */
import { KeyboardEvent } from "react";
import { EntityIcon } from "../../../components/Icon";
import { solveSig } from "../planApi";
import { PlanState, ResultDeco, SolveResult } from "../planState";

export function LockToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className={`pl-lock${on ? " pl-lock--on" : ""}`} aria-pressed={on} aria-label={`Fijar ${label}`} onClick={onToggle}>
      <span aria-hidden className="pl-lock__i">
        {on ? "✓" : "○"}
      </span>
      <span>Fijar</span>
    </button>
  );
}

/** Texto corto de cada chip de déficit; siempre con palabras, nunca solo color. */
export function DeficitChips({ d }: { d: SolveResult["deficit"] }) {
  const items: [string, number][] = [
    ["Primarias", d.t1],
    ["Secundarias", d.t2],
    ["Terciarias", d.t3],
  ];
  return (
    <span className="pl-defs">
      {items.map(([n, v]) => (
        <span key={n} className={`pl-def ${v ? "pl-def--no" : "pl-def--ok"}`} title={`${n}: ${v ? `faltan ${v} niveles` : "completas"}`} aria-label={`${n}: ${v ? `faltan ${v} niveles` : "completas"}`}>
          <span aria-hidden>{v ? "✕" : "✓"}</span>
          <span aria-hidden>
            {n[0]}
            {v ? ` −${v}` : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Pestañas de resultados con el patrón de .bg-alts (flechas, Inicio y Fin). */
export function ResultTabs({ results, selected, onPick, panelId }: { results: SolveResult[]; selected: number; onPick: (i: number) => void; panelId: string }) {
  const keys = (e: KeyboardEvent) => {
    let n = selected;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (selected + 1) % results.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (selected - 1 + results.length) % results.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = results.length - 1;
    else return;
    e.preventDefault();
    onPick(n);
    document.getElementById(`${panelId}-t${n}`)?.focus();
  };
  return (
    <div className="bg-alts" role="tablist" aria-label="Opciones de armadura" onKeyDown={keys}>
      {results.map((r, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          id={`${panelId}-t${i}`}
          aria-controls={panelId}
          aria-selected={i === selected}
          tabIndex={i === selected ? 0 : -1}
          className={i === selected ? "bg-alt bg-alt--on pl-alt" : "bg-alt pl-alt"}
          onClick={() => onPick(i)}
        >
          <span className="bg-alt__n">Opción {i + 1}</span>
          <span className="bg-alt__d">{r.name_es.replace(/^Opción \d+:\s*/, "")}</span>
          <span className="bg-alt__i">
            {r.pieces.map((p, k) =>
              p.empty ? null : <EntityIcon key={`${p.id}-${k}`} type="armor" sub={p.type} rarity={p.rarity} size="xs" />,
            )}
          </span>
          <DeficitChips d={r.deficit} />
        </button>
      ))}
    </div>
  );
}

const STALE_TXT = "Has cambiado objetivos, piezas fijadas o exclusiones desde el último cálculo. Estos resultados pueden no reflejarlo: pulsa recalcular.";
export const isStale = (state: PlanState) => !!state.solved && state.solved.sig !== solveSig(state);

/** Avisa si el plan cambió (objetivos, fijadas, exclusiones…) desde el último cálculo. */
export function StaleNote({ state }: { state: PlanState }) {
  if (!isStale(state)) return null;
  return (
    <p className="pl-note" role="note">
      {STALE_TXT}
    </p>
  );
}

/** Todos los avisos del buscador en un solo bloque plegable; se abre solo si hay alguno importante. */
export function SolverNotes({ state }: { state: PlanState }) {
  const sv = state.solved;
  if (!sv) return null;
  const items: { t: string; info?: boolean }[] = [];
  if (isStale(state)) items.push({ t: STALE_TXT });
  for (const n of sv.scenario_notes) items.push({ t: n });
  for (const n of sv.notes) items.push({ t: n, info: true });
  if (sv.truncated) items.push({ t: "La búsqueda se cortó por tiempo: puede haber combinaciones algo mejores. Fija las piezas que te gusten y recalcula para afinar." });
  const important = sv.truncated || state.results.length === 0 || sv.scenario_notes.some((n) => /no puede llegar/i.test(n));
  if (!items.length) return null;
  return (
    <details className="pl-notes" open={important}>
      <summary className="pl-notes__s">
        Avisos del buscador (<span className="pl-notes__n">{items.length}</span>)
      </summary>
      <ul className="pl-notes__l">
        {items.map((it, i) => (
          <li key={i} className={`pl-note${it.info ? " pl-note--info" : ""}`}>
            {it.t}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Joyas colocadas por el buscador en cada ranura de una pieza (misma posición que `sizes`; null = libre). */
export function placedDecos(r: SolveResult, piece: string, sizes: number[]): (ResultDeco | null)[] {
  const pool = r.decorations.filter((d) => d.piece === piece);
  const used = new Set<ResultDeco>();
  return sizes.map((sz) => {
    const d = pool.find((x) => !used.has(x) && x.slot_size === sz);
    if (d) used.add(d);
    return d ?? null;
  });
}

export const lockedDecoCount = (state: PlanState, id: number, piece: string) => state.locks.decorations.filter((d) => d.id === id && d.piece === piece).length;
