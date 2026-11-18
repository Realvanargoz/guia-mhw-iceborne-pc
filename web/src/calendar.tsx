import { createContext, ReactNode, useContext, useEffect } from "react";
import { useApi } from "./api";

export type Ticket = { item_en: string; item_id?: number | null; note_es?: string };
export type Festival = {
  slug: string;
  season: string;
  name_es: string;
  astera_en: string;
  seliana_en: string;
  theme: string;
  sort_order: number;
  summary_es?: string;
  tickets: Ticket[];
  layered: { slug: string; name_es?: string }[];
};
export type CalEntry = {
  id: number | string;
  kind: "festival" | "siege" | "event" | "custom";
  title_es: string;
  title_en?: string;
  festival_slug?: string | null;
  festival?: Festival | null;
  siege?: "safi" | "kulve";
  theme?: string | null;
  notes?: string | null;
  start_at: string;
  end_at: string;
  estimated: boolean;
};
export type SiegeRotation = { anchor_at: string; anchor_siege: "safi" | "kulve"; period_days: number };
export type CalNow = {
  now: string;
  active: CalEntry[];
  upcoming: CalEntry[];
  festival: CalEntry | null;
  theme: string | null;
  siege_rotation: SiegeRotation | null;
};

export const FEST_ICON: Record<string, string> = {
  spring: "🌸",
  summer: "☀️",
  autumn: "🍂",
  winter: "❄️",
  appreciation: "✦",
  safi: "🐉",
  kulve: "🪙",
  event: "★",
  custom: "●",
};

export function entryTheme(e: CalEntry): string {
  return e.theme ?? (e.kind === "siege" ? e.siege ?? "event" : e.kind);
}

export const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Calendar dates are handled in UTC: event blocks switch at 00:00 UTC. */
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const utcDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function fmtDay(s: string): string {
  const d = utcDate(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3).toLowerCase()}`;
}

/** Inclusive last day of a period whose end_at is exclusive. */
export function lastDay(e: CalEntry): string {
  return ymd(addDays(utcDate(e.end_at), -1));
}

export function daysLeft(e: CalEntry, now = new Date()): number {
  return Math.max(0, Math.ceil((utcDate(e.end_at).getTime() - now.getTime()) / 86400000));
}

export function progressPct(e: CalEntry, now = new Date()): number {
  const s = utcDate(e.start_at).getTime();
  const t = utcDate(e.end_at).getTime();
  return Math.min(100, Math.max(0, ((now.getTime() - s) / (t - s)) * 100));
}

type Ctx = { data?: CalNow; reload: () => void };
const FestCtx = createContext<Ctx>({ reload: () => undefined });

/** Loads what is active now and applies the festival theme to <html data-fest>. */
export function FestProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<CalNow>("/calendar/now");
  useEffect(() => {
    const id = window.setInterval(reload, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [reload]);
  useEffect(() => {
    const root = document.documentElement;
    if (data?.theme) root.dataset.fest = data.theme;
    else delete root.dataset.fest;
  }, [data?.theme]);
  return <FestCtx.Provider value={{ data, reload }}>{children}</FestCtx.Provider>;
}

export const useFest = () => useContext(FestCtx);
