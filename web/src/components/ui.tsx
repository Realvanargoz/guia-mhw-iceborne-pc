import { KeyboardEvent, ReactNode, useState } from "react";
import { safeHref } from "../safeUrl";
import { Link } from "react-router-dom";
import { putProgress } from "../api";
import { EntityIcon, IconSize } from "./Icon";
import { RANK_LABEL, RANK_SHORT, TYPE_LABEL, entityPath } from "../labels";

export function Name({ es, en, as = "span" }: { es?: string | null; en?: string | null; as?: "span" | "h1" }) {
  const main = es || en || "—";
  const Tag = as;
  return (
    <Tag className={as === "h1" ? "name name--h1" : "name"}>
      <span className="name__es">{main}</span>
      {en && es && en !== es && <span className="name__en">{en}</span>}
      {!es && en && <span className="name__en name__en--missing">sin traducción</span>}
    </Tag>
  );
}

export function ELink({
  type,
  id,
  es,
  en,
  sub,
  rarity,
  icon = true,
  iconSize = "sm",
}: {
  type: string;
  id: string | number;
  es?: string | null;
  en?: string | null;
  /** weapon_type / armor type: enables the equip icon for weapon/armor links */
  sub?: string | null;
  rarity?: number | null;
  icon?: boolean;
  iconSize?: IconSize;
}) {
  const ic = icon ? <EntityIcon type={type} id={id} sub={sub} rarity={rarity} size={iconSize} /> : null;
  return (
    <Link className={ic ? "elink elink--icon" : "elink"} to={entityPath(type, id)}>
      {ic}
      <Name es={es} en={en} />
    </Link>
  );
}

export function RankBadge({ rank }: { rank?: string | null }) {
  if (!rank) return <span className="badge">RB/RA</span>;
  return (
    <span className={`badge badge--${rank.toLowerCase()}`} title={RANK_LABEL[rank]}>
      <span aria-hidden={RANK_LABEL[rank] ? true : undefined}>{RANK_SHORT[rank] ?? rank}</span>
      {RANK_LABEL[rank] && <span className="sr-only">{RANK_LABEL[rank]}</span>}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return <span className={`badge badge--type badge--${type}`}>{TYPE_LABEL[type] ?? type}</span>;
}

export function Rarity({ value }: { value?: number | null }) {
  if (value == null) return null;
  return (
    <span className={`rarity rarity--${Math.min(value, 12)}`} title={`Rareza ${value}`}>
      <span aria-hidden>R{value}</span>
      <span className="sr-only">Rareza {value}</span>
    </span>
  );
}

export function Pct({ value }: { value?: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const v = Number(value);
  const cls = v >= 20 ? "pct pct--high" : v >= 8 ? "pct pct--mid" : "pct pct--low";
  return <span className={cls}>{v % 1 === 0 ? v : v.toFixed(1)}%</span>;
}

/** Game-style ornate header frame (9-slice /ui/header-frame.png over a wood gradient). */
export function OrnateHeader({
  children,
  aside,
  as: Tag = "h2",
  className = "",
}: {
  children: ReactNode;
  aside?: ReactNode;
  as?: "h1" | "h2" | "h3" | "div";
  className?: string;
}) {
  return (
    <header className={`ohead ${className}`.trim()}>
      <Tag className="ohead__t">{children}</Tag>
      {aside && <div className="ohead__aside">{aside}</div>}
    </header>
  );
}

export function Section({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <OrnateHeader aside={aside}>{title}</OrnateHeader>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      Cargando…
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      <span>No se pudo cargar: {error}</span>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm error__retry" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

/** Roving-focus keyboard handler for tablists / radiogroups: Left/Right (+Up/Down when `all`), Home, End. Selection follows focus. */
export function useRovingKeys(count: number, cur: number, onSelect: (i: number) => void, all = false) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || count < 1) return;
    let n: number;
    switch (e.key) {
      case "ArrowRight":
        n = (cur + 1) % count;
        break;
      case "ArrowLeft":
        n = (cur - 1 + count) % count;
        break;
      case "ArrowDown":
        if (!all) return;
        n = (cur + 1) % count;
        break;
      case "ArrowUp":
        if (!all) return;
        n = (cur - 1 + count) % count;
        break;
      case "Home":
        n = 0;
        break;
      case "End":
        n = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    onSelect(n);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"],[role="radio"]')[n]?.focus();
  };
}

/** DOM ids shared by a tablist and its panels (pass the same prefix to both). */
export const tabDomId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelDomId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export function Check({
  type,
  id,
  done,
  label = "Obtenido",
  onChange,
}: {
  type: string;
  id: string | number;
  done: boolean;
  label?: string;
  onChange?: (v: boolean) => void;
}) {
  const [value, setValue] = useState(done);
  const [busy, setBusy] = useState(false);
  return (
    <label className={`check ${value ? "check--on" : ""}`} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={value}
        disabled={busy}
        onChange={async (e) => {
          const v = e.target.checked;
          setValue(v);
          setBusy(true);
          try {
            await putProgress(type, id, v);
            onChange?.(v);
          } catch {
            setValue(!v);
          } finally {
            setBusy(false);
          }
        }}
      />
      <span>{label}</span>
    </label>
  );
}

export type Source = { url: string; title?: string; note?: string };

export function Sources({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <div className="sources">
      <h3>Fuentes</h3>
      <ul>
        {sources.map((s, i) => (
          <li key={i}>
            <a href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">
              {s.title || new URL(s.url).hostname}
            </a>
            {s.note && <span className="muted"> · {s.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Steps({ steps }: { steps?: string[] }) {
  if (!steps?.length) return null;
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

export function ReviewNote({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <div className="review">
      Dato pendiente de verificación: las fuentes no coinciden del todo. Compruébalo en el juego antes de farmear.
    </div>
  );
}

export function PcBadge({ value }: { value?: boolean | null }) {
  if (value === true) return <span className="badge badge--ok">Disponible en PC</span>;
  if (value === false) return <span className="badge badge--no">No existe en PC</span>;
  return <span className="badge">PC: sin confirmar</span>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
  idPrefix,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** When given, tabs get id / aria-controls matching panelDomId(idPrefix, id). Render the panel with role="tabpanel". */
  idPrefix?: string;
  label?: string;
}) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
  const onKeyDown = useRovingKeys(tabs.length, idx, (i) => onChange(tabs[i].id));
  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={idPrefix ? tabDomId(idPrefix, t.id) : undefined}
          aria-selected={t.id === value}
          aria-controls={idPrefix ? panelDomId(idPrefix, t.id) : undefined}
          tabIndex={i === idx ? 0 : -1}
          className={t.id === value ? "tab tab--on" : "tab"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && <span className="tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Panel for a Tabs/BookTabs tab (only the active one is rendered by callers). */
export function TabPanel({ prefix, id, children, className }: { prefix: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={panelDomId(prefix, id)} aria-labelledby={tabDomId(prefix, id)} tabIndex={-1} className={className}>
      {children}
    </div>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="pbar" title={`${done} de ${total}`}>
      {label && <span className="pbar__label">{label}</span>}
      <div className="pbar__track">
        <div className="pbar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="pbar__num">
        {done}/{total} · {pct}%
      </span>
    </div>
  );
}
