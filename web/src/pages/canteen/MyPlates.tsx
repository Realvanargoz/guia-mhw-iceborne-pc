/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import type { PlatePick, Voucher } from "./engine";
import type { Saved } from "./types";

export const SAVED_KEY = "mhw.canteen.combos";

/**
 * Keeps only well-formed plates, for localStorage and imported files alike (a corrupt entry must not break the page).
 * Ingredient and daily ids are checked against the catalogue later, when a plate is loaded (normalizePicks).
 */
function cleanSaved(arr: unknown, imported: boolean): Saved[] {
  if (!Array.isArray(arr)) return [];
  const now = Date.now();
  return arr
    .filter((c: any) => c && typeof c === "object" && Array.isArray(c.picks) && c.picks.every((p: any) => typeof p?.id === "string"))
    .map((c: any, i: number) => ({
      id: !imported && typeof c.id === "string" ? c.id : `${now}-${i}`,
      name: String(c.name ?? `${imported ? "Importado" : "Plato"} ${i + 1}`).slice(0, 60),
      updated: !imported && typeof c.updated === "number" ? c.updated : now,
      slots: Math.min(6, Math.max(2, Number(c.slots) || 4)),
      voucher: ["none", "voucher", "gourmet"].includes(c.voucher) ? c.voucher : "none",
      picks: c.picks.map((p: any) => ({ id: p.id, fresh: !!p.fresh })),
      daily: Array.isArray(c.daily) ? c.daily.filter((d: any) => typeof d === "string") : [],
    }));
}

function readSaved(): Saved[] {
  try {
    return cleanSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"), false);
  } catch {
    return [];
  }
}
function writeSaved(l: Saved[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(l));
    return true;
  } catch {
    return false;
  }
}

/** Saved plates: localStorage "mhw.canteen.combos", export/import JSON {kind:"mhw-canteen-combos",version:1,combos}. */
export function MyPlates({
  current,
  onLoad,
}: {
  current: { slots: number; voucher: Voucher; picks: PlatePick[]; daily: string[] };
  onLoad: (s: Saved) => void;
}) {
  const [saved, setSaved] = useState<Saved[]>(readSaved);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const nm = name.trim() || `Plato ${saved.length + 1}`;
    const next = [{ id: String(Date.now()), name: nm, updated: Date.now(), ...current }, ...saved];
    if (writeSaved(next)) {
      setSaved(next);
      setName("");
      setMsg(`Guardado «${nm}».`);
    } else setMsg("No se pudo guardar: el navegador bloquea el almacenamiento local.");
  };
  const del = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    writeSaved(next);
    setSaved(next);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ kind: "mhw-canteen-combos", version: 1, combos: saved }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cantina-combinaciones.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const ok = cleanSaved(Array.isArray(j) ? j : j?.combos, true);
      if (!ok.length) throw new Error("vacío");
      const next = [...ok, ...saved];
      writeSaved(next);
      setSaved(next);
      setMsg(`Importados ${ok.length} platos.`);
    } catch {
      setMsg("El archivo no tiene un formato válido de platos.");
    }
  };

  return (
    <section className="cs-plates parchment" aria-labelledby="cs-plates-h">
      <h3 className="cs-h" id="cs-plates-h">
        Mis platos
      </h3>
      <div className="cn-save__row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del plato" aria-label="Nombre del plato" maxLength={60} />
        <button type="button" className="bg-btn" onClick={save} disabled={!current.picks.length}>
          Guardar
        </button>
      </div>
      <div className="cn-save__row">
        <button type="button" className="cn-btn2" onClick={exportJson} disabled={!saved.length}>
          Exportar JSON
        </button>
        <button type="button" className="cn-btn2" onClick={() => importRef.current?.click()}>
          Importar JSON
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </div>
      {msg && (
        <p className="small" role="status">
          {msg}
        </p>
      )}
      <ul className="cn-saved">
        {saved.map((s) => (
          <li key={s.id}>
            <button type="button" className="cn-link" onClick={() => onLoad(s)}>
              {s.name}
            </button>
            <span className="muted small">
              {s.picks.length} ingr. · {s.picks.filter((p) => p.fresh).length} frescos
            </span>
            <button type="button" className="cn-x" aria-label={`Borrar ${s.name}`} onClick={() => del(s.id)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        ))}
        {!saved.length && <li className="muted small">Aún no hay platos guardados (se guardan solo en este navegador).</li>}
      </ul>
    </section>
  );
}
