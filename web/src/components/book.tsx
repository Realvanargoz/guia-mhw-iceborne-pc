import { ReactNode, useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { OrnateHeader, ProgressBar, TabPanel, Tabs, panelDomId, tabDomId, useRovingKeys } from "./ui";

/** Book components ("Libro del cazador"). Section / Tabs / ProgressBar live in ui.tsx and are re-exported. */
export { OrnateHeader, ProgressBar, TabPanel, Tabs, panelDomId, tabDomId };

/* ------------------------------------------------------------------ helpers */
/** True when a letter hotkey must NOT fire: focus is on an interactive control, in a dialog, or outside the book. */
function ignoreHotkey(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || el.isContentEditable) return true;
  if (el.closest('[role="dialog"],[role="alertdialog"],dialog')) return true;
  return !el.closest(".book, .booktabs, .ranksel, .bst__main");
}

/** Calls prev/next on the given keys (ignored with modifiers, in fields/buttons/links/dialogs, or when focus is outside the book). */
function useKeyPair(prevKey: string, nextKey: string, prev: () => void, next: () => void, enabled = true) {
  const ref = useRef({ prev, next });
  ref.current = { prev, next };
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || ignoreHotkey(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === prevKey) ref.current.prev();
      else if (k === nextKey) ref.current.next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prevKey, nextKey, enabled]);
}

/* ------------------------------------------------------------------ KeyCap */
export function KeyCap({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <kbd className="keycap" title={title} aria-hidden>
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ frame */
/** Four filigree corners (/ui/corner.png top-left, mirrored with CSS). Purely decorative. */
export function Corners() {
  return (
    <>
      <span className="corner corner--tl" aria-hidden />
      <span className="corner corner--tr" aria-hidden />
      <span className="corner corner--bl" aria-hidden />
      <span className="corner corner--br" aria-hidden />
    </>
  );
}

export function Book({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="bookwrap">
      <div className={`book ${className}`.trim()}>{children}</div>
    </div>
  );
}

export function Page({
  children,
  title,
  className = "",
  corners = true,
}: {
  children: ReactNode;
  title?: ReactNode;
  className?: string;
  corners?: boolean;
}) {
  return (
    <div className={`bpage ${className}`.trim()}>
      {corners && <Corners />}
      {title && <OrnateHeader>{title}</OrnateHeader>}
      {children}
    </div>
  );
}

export function Parchment({
  children,
  tone = "light",
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  tone?: "light" | "aged" | "dark";
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={`parchment parchment--${tone} ${className}`.trim()}>{children}</Tag>;
}

/* ------------------------------------------------------------------ tabs */
export function BookTabs<T extends string>({
  tabs,
  value,
  onChange,
  keys = true,
  idPrefix,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  /** Q / E switch tabs (ignored while typing in a field). */
  keys?: boolean;
  /** Wire tabs to panels rendered with <TabPanel prefix={idPrefix} id=…>. */
  idPrefix?: string;
}) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
  const go = (d: number) => onChange(tabs[(idx + d + tabs.length) % tabs.length].id);
  useKeyPair("q", "e", () => go(-1), () => go(1), keys && tabs.length > 1);
  return (
    <div className="booktabs">
      {keys && <KeyCap title="Pestaña anterior (Q)">Q</KeyCap>}
      <Tabs tabs={tabs} value={value} onChange={onChange} className="tabs--book" idPrefix={idPrefix} />
      {keys && <KeyCap title="Pestaña siguiente (E)">E</KeyCap>}
    </div>
  );
}

/* ------------------------------------------------------------------ icons */
const STAR_D = "M12 2.3l2.9 6.1 6.7.9-4.9 4.6 1.2 6.6L12 17.2l-5.9 3.3 1.2-6.6-4.9-4.6 6.7-.9z";

export function Stars({ n, max = 3, size = 16, label }: { n: number; max?: number; size?: number; label?: string }) {
  return (
    <span className="bstars" role="img" aria-label={label ?? `${n} de ${max} estrellas`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" className={i < n ? "bstar bstar--on" : "bstar"}>
          <path d={STAR_D} />
        </svg>
      ))}
    </span>
  );
}

const CROWN = {
  mini: { fill: "#8fa3a8", hi: "#d6e3e5", lo: "#4f6468", label: "Corona mini" },
  silver: { fill: "#b9c0c6", hi: "#f4f6f8", lo: "#6c747c", label: "Corona de plata" },
  gold: { fill: "#eaa62e", hi: "#ffe39a", lo: "#8a5a0d", label: "Corona de oro" },
} as const;

export function Crown({ kind, size = 24 }: { kind: "mini" | "silver" | "gold"; size?: number }) {
  const c = CROWN[kind];
  return (
    <span className={`crown crown--${kind}`} role="img" aria-label={c.label} title={c.label} style={{ width: size, height: size }}>
      <Icon kind="ui" name={`crown-${kind}`} size={size} />
    </span>
  );
}

export function Gem({ active = false, size = 22 }: { active?: boolean; size?: number }) {
  return (
    <svg className={active ? "gem gem--on" : "gem"} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2l8 7-8 13L4 9z" className="gem__body" />
      <path d="M4 9h16M12 2l-3 7 3 13 3-13-3-7" className="gem__facet" fill="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------ bars */
export function ResearchBar({ level, max = 10, label = "Nivel de investigación" }: { level: number; max?: number; label?: string }) {
  return (
    <div className="rbar" role="img" aria-label={`${label}: ${level} de ${max}`}>
      <span className="rbar__label">{label}</span>
      <span className="rbar__segs">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={i < level ? "rbar__seg rbar__seg--on" : "rbar__seg"} />
        ))}
      </span>
      <span className="rbar__num">{level}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ rank selector */
export function RankSelector({
  ranks,
  value,
  onChange,
  keys = true,
}: {
  ranks: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  /** A / D switch rank (ignored while typing in a field). */
  keys?: boolean;
}) {
  const idx = Math.max(0, ranks.findIndex((r) => r.id === value));
  const go = (d: number) => {
    const n = idx + d;
    if (n >= 0 && n < ranks.length) onChange(ranks[n].id);
  };
  useKeyPair("a", "d", () => go(-1), () => go(1), keys && ranks.length > 1);
  const onKeyDown = useRovingKeys(ranks.length, idx, (i) => onChange(ranks[i].id), true);
  return (
    <div className="ranksel" role="radiogroup" aria-label="Rango" onKeyDown={onKeyDown}>
      {keys && <KeyCap title="Rango anterior (A)">A</KeyCap>}
      {ranks.map((r, i) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={r.id === value}
          tabIndex={i === idx ? 0 : -1}
          className={r.id === value ? "ranksel__r ranksel__r--on" : "ranksel__r"}
          onClick={() => onChange(r.id)}
        >
          <Gem active={r.id === value} />
          <span>{r.label}</span>
        </button>
      ))}
      {keys && <KeyCap title="Rango siguiente (D)">D</KeyCap>}
    </div>
  );
}
