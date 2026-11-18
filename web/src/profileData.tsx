/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from "react-router-dom";

/** Algunos nombres llegan del guardado con UTF-8 leído como Latin-1 («Î±» en vez de «α»). Se repara en cliente. */
export function fixText<T extends string | null | undefined>(s: T): T {
  if (!s || !/[ÂÃÎÏ]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
    if (Array.from(s).some((c) => c.charCodeAt(0) > 255)) return s;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as T;
  } catch {
    return s;
  }
}

export type SnapshotMeta = { id: number; taken_at: string; source: string };

export type RankSummary = { pieces_owned: number; pieces_total: number; sets_complete: number; sets_total: number; percent: number };
export type ArmorProfile = {
  empty?: boolean;
  available?: boolean;
  snapshot?: SnapshotMeta;
  semantics?: string;
  pieces_owned: number;
  pieces_total: number;
  percent: number;
  sets_complete: number;
  sets_total: number;
  sets_percent: number;
  by_rank: Record<string, RankSummary>;
  owned_piece_ids: number[];
  complete_set_ids: number[];
  sets: {
    id: number;
    name_en: string;
    name_es: string;
    rank: string;
    pieces_total: number;
    pieces_owned: number;
    owned_piece_ids: number[];
    complete: boolean;
  }[];
};

export type CatBlock = {
  total: number;
  cleared: number;
  percent: number;
  by_rank: Record<string, { total: number; cleared: number }>;
};
export type QuestsProfile = {
  empty?: boolean;
  snapshot?: SnapshotMeta;
  counts_available?: boolean;
  counts?: Record<string, number>;
  total_cleared?: number | null;
  per_quest_available?: boolean;
  per_quest_reason?: string;
  cleared: number[];
  cleared_not_in_guide?: number[];
  cleared_count: number;
  catalog_total: number;
  percent: number;
  by_category: Record<string, CatBlock>;
  story?: { achievement: number; slug: string; name_en: string; name_es: string; unlocked: boolean }[];
};

export const NOT_READ = "Aún no se ha leído nada de tu partida. Actualizar el perfil es siempre manual: hazlo desde la tarjeta «Perfil del cazador» de Inicio.";

/** Texto + enlace a la tarjeta de perfil cuando falta un dato. */
export function ReadHint({ text = "Pulsa Actualizar perfil para leer este dato." }: { text?: string }) {
  return (
    <p className="st-hint">
      {text}{" "}
      <Link to="/#perfil">Ir al perfil del cazador</Link>
    </p>
  );
}

export const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "");
