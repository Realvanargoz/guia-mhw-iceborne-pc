import { KeyboardEvent, useMemo, useState } from "react";
import { Gem } from "../../components/book";
import { Tabs } from "../../components/ui";
import type { BranchId, CanteenEngine, Category, Level } from "./engine";
import { CATEGORY_ORDER } from "./engine";
import { BranchGlyph } from "./BranchGlyph";
import { IngIcon } from "./IngIcon";
import { LockSvg } from "./Plate";
import type { Ing } from "./types";
import { ROMAN, brKey } from "./types";

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Geometric arrow-key navigation over the visible buttons of a 2D layout (works for both wide and tabbed modes). */
function moveFocus(root: HTMLElement, from: HTMLElement, key: string): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>(".tbm__ing")).filter((b) => b.offsetParent !== null);
  const r0 = from.getBoundingClientRect();
  const cx0 = r0.left + r0.width / 2;
  const cy0 = r0.top + r0.height / 2;
  const half = r0.height / 2;
  const pts = all.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const sameRow = pts.filter((p) => Math.abs(p.cy - cy0) < half);
  const by = <T,>(arr: T[], f: (x: T) => number) => arr.reduce<T | null>((best, x) => (best == null || f(x) < f(best) ? x : best), null);
  switch (key) {
    case "ArrowRight":
      return by(sameRow.filter((p) => p.cx > cx0 + 1), (p) => p.cx)?.el ?? null;
    case "ArrowLeft":
      return by(sameRow.filter((p) => p.cx < cx0 - 1), (p) => -p.cx)?.el ?? null;
    case "ArrowDown":
    case "ArrowUp": {
      const down = key === "ArrowDown";
      const cand = pts.filter((p) => (down ? p.cy > cy0 + half : p.cy < cy0 - half));
      const rowY = by(cand, (p) => (down ? p.cy : -p.cy))?.cy;
      if (rowY == null) return null;
      return by(cand.filter((p) => Math.abs(p.cy - rowY) < half), (p) => Math.abs(p.cx - cx0))?.el ?? null;
    }
    case "Home":
      return by(sameRow, (p) => p.cx)?.el ?? null;
    case "End":
      return by(sameRow, (p) => -p.cx)?.el ?? null;
    default:
      return null;
  }
}

export function TypeBranchMatrix({
  engine,
  ingById,
  picked,
  full,
  owned,
  tiers,
  anyOwnedMarked,
  onToggle,
}: {
  engine: CanteenEngine;
  ingById: Map<string, Ing>;
  picked: ReadonlySet<string>;
  full: boolean;
  owned: ReadonlySet<string>;
  /** Tier reached per branch in the current plate (gems light up). */
  tiers: ReadonlyMap<BranchId, Level>;
  anyOwnedMarked: boolean;
  onToggle: (id: string, from: HTMLElement | null) => void;
}) {
  const [q, setQ] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [cat, setCat] = useState<Category>("meat");
  const [focusId, setFocusId] = useState<string | null>(null);

  const needle = fold(q.trim());
  const matches = useMemo(() => {
    if (!needle) return null;
    const s = new Set<string>();
    for (const i of engine.ingredientsBy(null, null)) {
      const b = engine.branch(i.skill_type);
      if (fold(`${i.name_es} ${i.name_en} ${b?.name_es ?? ""}`).includes(needle)) s.add(i.id);
    }
    return s;
  }, [needle, engine]);

  const firstId = engine.ingredientsBy(null, null)[0]?.id ?? null;
  const tabId = focusId ?? firstId;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.classList?.contains("tbm__ing") || e.altKey || e.metaKey || e.shiftKey) return;
    const next = moveFocus(e.currentTarget, t, e.key);
    if (!next && !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (next) {
      setFocusId(next.dataset.id ?? null);
      next.focus();
    }
  };

  const catTabs = CATEGORY_ORDER.map((c) => ({ id: c, label: engine.categoryLabel_es[c] }));

  return (
    <div className="tbm" data-cat={cat}>
      <div className="tbm__tools">
        <label className="tbm__search">
          <span className="sr-only">Buscar ingrediente</span>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ingrediente o rama…" />
        </label>
        <label className="cs-switch">
          <input type="checkbox" role="switch" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} />
          <span className="cs-switch__track" aria-hidden />
          Solo los que tengo
        </label>
        <p className="tbm__status small" role="status">
          {matches ? (matches.size ? `${matches.size} coincidencias` : "Sin coincidencias") : full ? "Plato lleno: quita uno para cambiarlo" : ""}
        </p>
      </div>
      {onlyOwned && !anyOwnedMarked && (
        <p className="small muted tbm__hint">
          Aún no has marcado ingredientes: hazlo en la pestaña Ingredientes o pulsa «Actualizar perfil». Ahora solo cuentan los básicos.
        </p>
      )}

      <Tabs className="tbm__cats" tabs={catTabs} value={cat} onChange={(c) => {
          setCat(c);
          setFocusId(engine.ingredientsBy(c, null)[0]?.id ?? null);
        }} label="Categoría" />

      <div className="tbm__grid" onKeyDown={onKeyDown}>
        <div className="tbm__head" aria-hidden>
          <span />
          {CATEGORY_ORDER.map((c) => (
            <span key={c} className="tbm__colh" data-cat={c}>
              {engine.categoryLabel_es[c]}
              <small>{c === "meat" ? "Ataque" : c === "fish" ? "Defensa" : c === "veggie" ? "Res. elem." : "sin estadística"}</small>
            </span>
          ))}
        </div>
        {engine.branches.map((b) => {
          const ladder = engine.branchSkills(b.id);
          const reached = tiers.get(b.id) ?? 0;
          const isDrink = b.group === "drink";
          return (
            <div key={b.id} className="tbm__row" data-br={brKey(b.id)} data-group={b.group} role="group" aria-label={`Rama ${b.name_es}`}>
              <div className="tbm__band">
                <span className="tbm__bname">
                  <BranchGlyph branch={b.id} size={18} />
                  {b.name_es}
                </span>
                <span className="tbm__ladder">
                  {ladder.map((s, t) => (
                    <span key={s.id} className={`tbm__rung${reached === t + 1 ? " tbm__rung--on" : ""}`} title={`Nivel ${ROMAN[t + 1]} (${(t + 1) * 2} ingredientes): ${s.name_es}`}>
                      <Gem size={12} active={reached === t + 1} />
                      <span aria-hidden>{ROMAN[t + 1]}</span>
                      <span className="sr-only">
                        Nivel {t + 1}: {s.name_es}.
                      </span>
                    </span>
                  ))}
                </span>
              </div>
              {isDrink && (
                <div className="tbm__merge" aria-hidden>
                  Solo bebidas · no dan estadística
                </div>
              )}
              {CATEGORY_ORDER.map((c) => {
                const list = engine.ingredientsBy(c, b.id);
                if (!b.categories.includes(c) || !list.length) {
                  if (isDrink && c !== "drink") return null;
                  return <div key={c} className="tbm__cell tbm__cell--none" data-cat={c} aria-hidden />;
                }
                return (
                  <div key={c} className="tbm__cell" data-cat={c} role="group" aria-label={`${b.name_es} · ${engine.categoryLabel_es[c]}`}>
                    {list.map((i) => {
                      const ing = ingById.get(i.id);
                      const on = picked.has(i.id);
                      const have = engine.isOwned(i.id, owned);
                      const missing = onlyOwned && !have;
                      const dimmed = matches ? !matches.has(i.id) : false;
                      const blocked = full && !on;
                      const tip = [
                        `${i.name_es} · ${b.name_es} · ${engine.categoryLabel_es[c]}`,
                        !have ? `No lo tienes${i.unlock_es ? `: ${i.unlock_es}` : ""}` : null,
                        on ? "En el plato (pulsa para quitarlo)" : blocked ? "El plato está lleno" : null,
                      ]
                        .filter(Boolean)
                        .join("\n");
                      return (
                        <button
                          key={i.id}
                          type="button"
                          className="tbm__ing"
                          data-id={i.id}
                          data-match={matches ? (dimmed ? "0" : "1") : undefined}
                          data-missing={missing ? "1" : undefined}
                          aria-pressed={on}
                          aria-disabled={blocked || undefined}
                          aria-label={`${i.name_es}${!have && onlyOwned ? ", no lo tienes" : ""}`}
                          title={tip}
                          tabIndex={i.id === tabId ? 0 : -1}
                          onFocus={() => setFocusId(i.id)}
                          onClick={(e) => {
                            if (blocked) return;
                            onToggle(i.id, e.currentTarget.querySelector<HTMLElement>(".icon, .cn-mark"));
                          }}
                        >
                          {ing ? <IngIcon ing={ing} size={32} /> : <span className="icon icon--missing" style={{ width: 32, height: 32 }} />}
                          {missing && (
                            <span className="tbm__lock" aria-hidden>
                              <LockSvg size={12} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
