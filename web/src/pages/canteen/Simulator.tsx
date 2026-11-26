import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BranchId, CanteenEngine, Level, PlatePick, Voucher } from "./engine";
import { MAX_SLOTS, MIN_SLOTS } from "./engine";
import { shrinkOut, useReducedMotion } from "./anim";
import { MyPlates } from "./MyPlates";
import { Flight, Plate } from "./Plate";
import { ResultPanel } from "./ResultPanel";
import { Seg } from "./Seg";
import { SkillFinder } from "./SkillFinder";
import { TypeBranchMatrix } from "./TypeBranchMatrix";
import type { Canteen, Ing, Saved } from "./types";
import "../../canteen-sim.css";

type Mode = "ing" | "skill";
const MAX_DAILY = 3;

/** The canteen offers 2, 4 or 6 slots; older saves with 3 or 5 round up so nothing is cut. */
export const evenSlots = (n: number, atLeast = 0) => {
  const v = Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, Math.max(Number(n) || 4, atLeast)));
  return Math.min(MAX_SLOTS, v + (v % 2));
};

function FreshBox() {
  return (
    <details className="cn-fresh cs-freshbox">
      <summary>Cómo reconocer un ingrediente fresco</summary>
      <ul>
        <li>
          En la cantina, un ingrediente fresco lo delatan unos <b>destellos verdes</b> y un <b>pequeño icono verde</b> junto a él.
        </li>
        <li>
          Cada ingrediente fresco añade <b>+10 de vida máxima al cazador</b>, <b>+4 al camarada</b> y <b>media estrella</b> de activación de habilidades (con 6 frescos, 3 estrellas).
        </li>
        <li>Un Vale pone la activación al máximo y el Vale Gourmet vuelve frescos todos los ingredientes.</li>
      </ul>
      <p className="review">
        Dato pendiente de verificación (needs_review): los efectos de la frescura salen de wikis que no coinciden del todo. Compruébalo en el juego.
      </p>
    </details>
  );
}

/** The plate in progress survives tab changes and reloads; only «Vaciar» resets it. */
const CURRENT_KEY = "mhw.canteen.current";
type Current = { slots: number; picks: PlatePick[]; voucher: Voucher; daily: string[]; mode: Mode };

function readCurrent(engine: CanteenEngine, dailyIds: ReadonlySet<string>): Current {
  const empty: Current = { slots: 4, picks: [], voucher: "none", daily: [], mode: "ing" };
  try {
    const raw = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.picks)) return empty;
    const freshOf = new Map<string, boolean>();
    const ids: string[] = [];
    for (const p of raw.picks.slice(0, MAX_SLOTS)) {
      if (p && typeof p.id === "string") {
        ids.push(p.id);
        freshOf.set(p.id, p.fresh === true);
      }
    }
    const slots = evenSlots(raw.slots, ids.length);
    const picks = engine.normalizePicks(ids, slots).picks.map((p) => ({ id: p.id, fresh: freshOf.get(p.id) ?? false }));
    const voucher: Voucher = raw.voucher === "voucher" || raw.voucher === "gourmet" ? raw.voucher : "none";
    const daily = Array.isArray(raw.daily)
      ? [...new Set<string>(raw.daily.filter((d: unknown): d is string => typeof d === "string" && dailyIds.has(d)))].slice(0, MAX_DAILY)
      : [];
    return { slots, picks, voucher, daily, mode: raw.mode === "skill" ? "skill" : "ing" };
  } catch {
    return empty;
  }
}

export function Simulator({ data, engine, owned }: { data: Canteen; engine: CanteenEngine; owned: ReadonlySet<string> }) {
  const ingById = useMemo(() => new Map<string, Ing>(data.ingredients.map((i) => [i.id, i])), [data]);
  const [initial] = useState(() => readCurrent(engine, new Set(data.skills.daily.map((s) => s.id))));
  const [slots, setSlotsRaw] = useState(initial.slots);
  const [picks, setPicks] = useState<PlatePick[]>(initial.picks);
  const [voucher, setVoucher] = useState<Voucher>(initial.voucher);
  const [daily, setDaily] = useState<string[]>(initial.daily);
  const [mode, setMode] = useState<Mode>(initial.mode);
  useEffect(() => {
    try {
      localStorage.setItem(CURRENT_KEY, JSON.stringify({ slots, picks, voucher, daily, mode }));
    } catch {
      /* storage blocked: the plate just won't persist */
    }
  }, [slots, picks, voucher, daily, mode]);
  const [msg, setMsg] = useState<string | null>(null);
  const flights = useRef<Flight[]>([]);
  const reduced = useReducedMotion();
  const [sp, setSp] = useSearchParams();

  const sim = useMemo(() => engine.simulate(picks, { slots, voucher, daily }), [engine, picks, slots, voucher, daily]);
  const picked = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
  const tiers = useMemo(() => new Map<BranchId, Level>(sim.branches.map((b) => [b.branch, b.tier])), [sim]);

  /** Applies ids through normalizePicks (no repeats, unknown ids out) and says what was dropped. */
  const applyIds = (ids: string[], wantSlots: number, freshOf: Map<string, boolean>, label: string) => {
    const n = evenSlots(wantSlots, ids.length);
    const res = engine.normalizePicks(ids, n);
    const dup = res.dropped.filter((d) => d.code === "duplicate").length;
    const unk = res.dropped.filter((d) => d.code === "unknown").length;
    const over = res.dropped.filter((d) => d.code === "overflow").length;
    setSlotsRaw(n);
    setPicks(res.picks.map((p) => ({ id: p.id, fresh: freshOf.get(p.id) ?? false })));
    const extra = [
      dup ? `se ${dup === 1 ? "quitó 1 ingrediente repetido" : `quitaron ${dup} ingredientes repetidos`}` : null,
      unk ? `${unk === 1 ? "se ignoró 1 ingrediente desconocido" : `se ignoraron ${unk} ingredientes desconocidos`}` : null,
      over ? `${over === 1 ? "1 ingrediente no cabía" : `${over} ingredientes no cabían`}` : null,
    ].filter(Boolean);
    setMsg(`${label}${extra.length ? `; ${extra.join(", ")}` : ""}.`);
  };

  // ?plato=id1,id2,... loads a plate (from the Recetario or a shared link) and is then removed from the URL.
  const plato = sp.get("plato");
  useEffect(() => {
    if (plato == null) return;
    const ids = plato
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (ids.length) applyIds(ids, Math.max(slots, ids.length), new Map(), "Plato cargado desde el enlace");
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("plato");
        return n;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plato]);

  const setSlots = (n: number) => {
    setSlotsRaw(n);
    if (picks.length > n) {
      const cut = picks.length - n;
      setPicks(picks.slice(0, n));
      setMsg(`Se ${cut === 1 ? "quitó el último ingrediente" : `quitaron los ${cut} últimos ingredientes`}: ahora caben ${n}.`);
    }
  };

  const plateArt = (id: string) => document.querySelector<HTMLElement>(`.cs-plate [data-pick="${CSS.escape(id)}"] .cs-slot__art`);

  const toggleFromMatrix = (id: string, from: HTMLElement | null) => {
    if (picked.has(id)) {
      shrinkOut(plateArt(id)).then(() => setPicks((a) => a.filter((p) => p.id !== id)));
      return;
    }
    if (picks.length >= slots) return;
    if (from) flights.current.push({ id, from: from.getBoundingClientRect(), delay: 0 });
    setPicks([...picks, { id, fresh: false }]);
    setMsg(null);
  };

  const loadSuggestion = (next: PlatePick[], from: Map<string, HTMLElement>) => {
    flights.current = next.flatMap((p, k) => {
      const el = from.get(p.id);
      return el ? [{ id: p.id, from: el.getBoundingClientRect(), delay: k * 70 }] : [];
    });
    setPicks(next.slice(0, slots).map((p) => ({ id: p.id, fresh: p.fresh })));
    setMsg("Propuesta cargada en el plato.");
  };

  const loadSaved = (s: Saved) => {
    const freshOf = new Map<string, boolean>();
    for (const p of s.picks) if (!freshOf.has(p.id)) freshOf.set(p.id, !!p.fresh);
    applyIds(
      s.picks.map((p) => p.id),
      s.slots,
      freshOf,
      `Cargado «${s.name}»`,
    );
    setVoucher(s.voucher);
    const known = new Set(data.skills.daily.map((d) => d.id));
    setDaily((s.daily ?? []).filter((d) => known.has(d)).slice(0, MAX_DAILY));
  };

  const toggleDaily = (id: string) => setDaily((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= MAX_DAILY ? d : [...d, id]));

  return (
    <div className="cs-sim">
      <div className="cs-stage">
        <section className="cs-table" aria-label="Mesa">
          <Plate
            engine={engine}
            ingById={ingById}
            picks={picks}
            slots={slots}
            sim={sim}
            gourmet={voucher === "gourmet"}
            reduced={reduced}
            flights={flights}
            onRemove={(id) => setPicks((a) => a.filter((p) => p.id !== id))}
            onToggleFresh={(k) => setPicks((a) => a.map((p, i) => (i === k ? { ...p, fresh: !p.fresh } : p)))}
            onClear={() => {
              setPicks([]);
              setVoucher("none");
              setDaily([]);
              setMsg("Simulador reiniciado.");
            }}
          />
          <div className="cs-ctl wood">
            <Seg<number>
              label="Huecos"
              value={slots}
              onChange={setSlots}
              options={[2, 4, 6].map((n) => ({ id: n, label: String(n), title: `${n} huecos de ingrediente` }))}
            />
            <Seg<Voucher>
              label="Vale"
              value={voucher}
              onChange={setVoucher}
              options={[
                { id: "none", label: "Ninguno" },
                { id: "voucher", label: "Vale", title: "Activación al máximo" },
                { id: "gourmet", label: "Vale Gourmet", title: "Todo fresco y activación al máximo" },
              ]}
            />
          </div>
          {msg && (
            <p className="cs-msg small" role="status">
              {msg}
            </p>
          )}
        </section>
        <section className="cs-result parchment" aria-label="Resultado">
          <ResultPanel engine={engine} sim={sim} voucher={voucher} reduced={reduced} />
        </section>
      </div>
      <details className="cs-daily">
          <summary>
            Diarias de hoy en tu cantina <span className="cs-daily__n">{daily.length}/3</span>
          </summary>
          <p className="small muted">Marca las 3 que muestre tu cantina hoy: ocupan los huecos de habilidad que dejan libres las ramas.</p>
          <ul className="cs-daily__list">
            {data.skills.daily.map((s) => {
              const on = daily.includes(s.id);
              const blocked = !on && daily.length >= MAX_DAILY;
              return (
                <li key={s.id}>
                  <button type="button" className="cs-dchip" aria-pressed={on} disabled={blocked} onClick={() => toggleDaily(s.id)} title={s.effect_es}>
                    {s.name_es}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      <section className="cs-input parchment" aria-label="Elegir">
          <Seg<Mode>
            label="Modo"
            hideLabel
            className="cs-mode"
            value={mode}
            onChange={setMode}
            options={[
              { id: "ing", label: "Elegir ingredientes" },
              { id: "skill", label: "Elegir habilidades" },
            ]}
          />
          {mode === "ing" ? (
            <TypeBranchMatrix
              engine={engine}
              ingById={ingById}
              picked={picked}
              full={picks.length >= slots}
              owned={owned}
              tiers={tiers}
              anyOwnedMarked={owned.size > 0}
              onToggle={toggleFromMatrix}
            />
          ) : (
            <SkillFinder engine={engine} ingById={ingById} slots={slots} owned={owned} onLoad={loadSuggestion} />
          )}
        </section>
      <div className="cs-extra">
        <FreshBox />
        <MyPlates current={{ slots, voucher, picks, daily }} onLoad={loadSaved} />
      </div>
    </div>
  );
}
