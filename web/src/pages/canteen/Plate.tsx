import { CSSProperties, KeyboardEvent, MutableRefObject, useLayoutEffect, useRef } from "react";
import type { CanteenEngine, PlatePick, SimResult } from "./engine";
import { flyIcon, popIn, shrinkOut } from "./anim";
import { BranchGlyph } from "./BranchGlyph";
import { IngIcon, ingIconSrc } from "./IngIcon";
import type { Ing } from "./types";
import { brKey } from "./types";

export type Flight = { id: string; from: DOMRect; delay: number };

/** Hexagon positions (0 = top, clockwise) used by each slot count; the rest are locked. */
const POSITIONS: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [1, 2, 4, 5],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

function LeafSvg() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" fill="currentColor" opacity=".9" />
      <path d="M5 19 13.5 10.5" fill="none" stroke="var(--cs-leaf-vein, #1d3a12)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LockSvg({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor" fillOpacity=".18" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

export function Plate({
  engine,
  ingById,
  picks,
  slots,
  sim,
  gourmet,
  reduced,
  flights,
  onRemove,
  onToggleFresh,
  onClear,
}: {
  engine: CanteenEngine;
  ingById: Map<string, Ing>;
  picks: PlatePick[];
  slots: number;
  sim: SimResult;
  gourmet: boolean;
  reduced: boolean;
  flights: MutableRefObject<Flight[]>;
  /** By id: the shrink animation runs first, and the plate may change meanwhile (an index would be stale). */
  onRemove: (id: string) => void;
  onToggleFresh: (index: number) => void;
  onClear: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const prevIds = useRef<string[]>(picks.map((p) => p.id));
  const removing = useRef(new Set<string>());
  const focusAfter = useRef<number | null>(null);

  // Arrivals: flights from the matrix / finder land with a pop; anything else that appears (saved plate, URL) just pops.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const before = new Set(prevIds.current);
    prevIds.current = picks.map((p) => p.id);
    if (!root) return;
    const pending = flights.current;
    flights.current = [];
    const flown = new Set<string>();
    for (const f of pending) {
      const img = root.querySelector<HTMLElement>(`[data-pick="${CSS.escape(f.id)}"] .cs-slot__art`);
      if (!img) continue;
      flown.add(f.id);
      flyIcon(ingIconSrc(f.id), f.from, img, f.delay);
    }
    let k = 0;
    for (const p of picks) {
      if (before.has(p.id) || flown.has(p.id)) continue;
      const el = root.querySelector<HTMLElement>(`[data-pick="${CSS.escape(p.id)}"] .cs-slot__art`);
      if (el) popIn(el, 60 * k++);
    }
    // keep keyboard focus on the plate after a removal
    if (focusAfter.current != null) {
      const btns = root.querySelectorAll<HTMLElement>(".cs-slot__ing");
      const target = btns[Math.min(focusAfter.current, btns.length - 1)] ?? root.querySelector<HTMLElement>(".cs-mesa__count");
      target?.focus();
      focusAfter.current = null;
    }
  }, [picks, flights]);

  const remove = (index: number, viaKeyboard: boolean) => {
    const p = picks[index];
    if (!p || removing.current.has(p.id)) return;
    removing.current.add(p.id);
    const art = rootRef.current?.querySelector<HTMLElement>(`[data-pick="${CSS.escape(p.id)}"] .cs-slot__art`);
    shrinkOut(art).then(() => {
      removing.current.delete(p.id);
      if (viaKeyboard) focusAfter.current = index;
      onRemove(p.id);
    });
  };

  const order = POSITIONS[slots] ?? POSITIONS[6];
  const freshOf = new Map(sim.picks.map((p) => [p.id, p.fresh]));
  const count = picks.length;

  return (
    <div className="cs-mesa wood" ref={rootRef}>
      <div className="cs-mesa__bar">
        <p className="cs-mesa__count" tabIndex={-1}>
          <b>{count}</b>
          <span aria-hidden>/</span>
          <span className="sr-only"> de </span>
          {slots} <span className="cs-mesa__unit">ingredientes</span>
        </p>
        <button type="button" className="cs-btn cs-btn--wood" onClick={onClear} disabled={!count}>
          Vaciar
        </button>
      </div>
      <div className={`cs-plate${sim.full ? " cs-plate--full" : ""}`} role="group" aria-label={`Plato: ${count} de ${slots} ingredientes`}>
        {Array.from({ length: 6 }, (_, pos) => {
          const k = order.indexOf(pos);
          const style = { "--a": `${-90 + pos * 60}deg` } as CSSProperties;
          if (k < 0) {
            return (
              <div key={`lock-${pos}`} className="cs-slot cs-slot--locked" style={style} aria-hidden>
                <span className="cs-slot__well">
                  <LockSvg size={20} />
                </span>
              </div>
            );
          }
          const p = picks[k];
          if (!p) {
            return (
              <div key={`empty-${pos}`} className="cs-slot cs-slot--empty" style={style} aria-hidden>
                <span className="cs-slot__well" />
              </div>
            );
          }
          const ing = ingById.get(p.id);
          const branch = engine.branchOf(p.id);
          const bName = branch ? engine.branch(branch)?.name_es ?? branch : "";
          const fresh = freshOf.get(p.id) ?? p.fresh;
          const name = ing?.name_es ?? p.id;
          const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              remove(k, true);
            }
          };
          return (
            <div key={p.id} className={`cs-slot cs-slot--filled${fresh ? " cs-slot--fresh" : ""}`} style={style} data-br={brKey(branch)} data-pick={p.id}>
              <button
                type="button"
                className="cs-slot__ing"
                onClick={() => remove(k, false)}
                onKeyDown={onKey}
                aria-label={`Quitar ${name} (${bName}${fresh ? ", fresco" : ""})`}
                title={`${name} · ${bName}\nClic o Supr para quitarlo`}
              >
                <span className="cs-slot__art">{ing ? <IngIcon ing={ing} size="lg" /> : <span className="icon icon--missing" style={{ width: 48, height: 48 }} />}</span>
              </button>
              {fresh && !reduced && (
                <video className="cs-slot__spark" src="/ui/canteen/anim/fresh-sparkle.webm" muted autoPlay loop playsInline aria-hidden />
              )}
              <span className="cs-slot__badge" aria-hidden>
                <BranchGlyph branch={branch} size={14} />
              </span>
              <button
                type="button"
                className="cs-leaf"
                aria-pressed={fresh}
                disabled={gourmet}
                onClick={() => onToggleFresh(k)}
                aria-label={`Fresco: ${name}`}
                title={gourmet ? "El Vale Gourmet vuelve frescos todos los ingredientes" : fresh ? "Fresco (pulsa para quitarlo)" : "Marcar como fresco"}
              >
                <LeafSvg />
              </button>
            </div>
          );
        })}
        {!count && <p className="cs-plate__hint">Plato vacío</p>}
        {sim.full && !reduced && <video className="cs-steam" src="/ui/canteen/anim/vapor.webm" muted autoPlay loop playsInline aria-hidden />}
      </div>
    </div>
  );
}
