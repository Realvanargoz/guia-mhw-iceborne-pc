import { useMemo, useRef, useState } from "react";
import { Gem } from "../../components/book";
import type { CanteenEngine, PlatePick, StatKey } from "./engine";
import { BranchGlyph } from "./BranchGlyph";
import { IngIcon } from "./IngIcon";
import { Seg } from "./Seg";
import type { Ing } from "./types";
import { ROMAN, brKey } from "./types";

type StatPref = StatKey | "none";
const MAX_TARGETS = 3;

export function SkillFinder({
  engine,
  ingById,
  slots,
  owned,
  onLoad,
}: {
  engine: CanteenEngine;
  ingById: Map<string, Ing>;
  slots: number;
  owned: ReadonlySet<string>;
  /** Puts the proposal on the plate; `from` gives each icon's on-screen origin for the flight. */
  onLoad: (picks: PlatePick[], from: Map<string, HTMLElement>) => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [stat, setStat] = useState<StatPref>("attack");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const propRef = useRef<HTMLUListElement>(null);

  const toggle = (id: string) => {
    const tier = engine.skillTier(id);
    if (!tier) return;
    if (targets.includes(id)) {
      setTargets(targets.filter((t) => t !== id));
      setNote(null);
      return;
    }
    const same = targets.find((t) => engine.skillTier(t)?.branch === tier.branch);
    if (same) {
      const a = engine.skill(same)?.name_es ?? same;
      const b = engine.skill(id)?.name_es ?? id;
      const br = engine.branch(tier.branch)?.name_es ?? tier.branch;
      setTargets(targets.map((t) => (t === same ? id : t)));
      setNote(`«${b}» sustituye a «${a}»: la rama ${br} solo activa su nivel más alto, así que no puedes llevar dos habilidades de la misma rama.`);
      return;
    }
    if (targets.length >= MAX_TARGETS) return;
    setTargets([...targets, id]);
    setNote(null);
  };

  const res = useMemo(
    () => (targets.length ? engine.suggest({ targets, stat, slots, preferOwned: true, ownedOnly, owned }) : null),
    [engine, targets, stat, slots, ownedOnly, owned],
  );

  const load = () => {
    if (!res?.ok || !res.picks.length) return;
    const from = new Map<string, HTMLElement>();
    propRef.current?.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => {
      const ic = el.querySelector<HTMLElement>(".icon, .cn-mark");
      if (el.dataset.id && ic) from.set(el.dataset.id, ic);
    });
    onLoad(res.picks, from);
  };

  const full = targets.length >= MAX_TARGETS;
  const targetBranches = new Set(targets.map((t) => engine.skillTier(t)?.branch));

  return (
    <div className="sf">
      <p className="small sf__intro">
        Elige hasta 3 habilidades de rama. Te proponemos un plato que las activa con los huecos que tienes ({slots}), priorizando los ingredientes que ya
        tienes.
      </p>
      <ul className="sf__list">
        {engine.branches.map((b) => (
          <li key={b.id} className="sf__row" data-br={brKey(b.id)}>
            <span className="sf__band">
              <BranchGlyph branch={b.id} size={18} />
              <span>
                {b.name_es}
                <small>{b.group === "drink" ? "Bebidas" : "Carne, pescado o verdura"}</small>
              </span>
            </span>
            <span className="sf__tiers" role="group" aria-label={`Habilidades de ${b.name_es}`}>
              {engine.branchSkills(b.id).map((s, t) => {
                const on = targets.includes(s.id);
                const blocked = !on && full && !targetBranches.has(b.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="sf__skill"
                    aria-pressed={on}
                    aria-disabled={blocked || undefined}
                    title={blocked ? "Ya has elegido 3 habilidades: quita una para cambiarla" : `${s.name_es}: ${s.effect_es ?? ""}`}
                    onClick={() => !blocked && toggle(s.id)}
                  >
                    <Gem size={14} active={on} />
                    <span className="sf__tier" aria-hidden>
                      {ROMAN[t + 1]}
                    </span>
                    <span className="sf__name">
                      {s.name_es}
                      <small>
                        {(t + 1) * 2} ingr.<span className="sr-only">, nivel {t + 1}</span>
                      </small>
                    </span>
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      {note && (
        <p className="sf__note small" role="status">
          {note}
        </p>
      )}

      <div className="sf__opts">
        <Seg<StatPref>
          label="Estadística preferida"
          value={stat}
          onChange={setStat}
          options={[
            { id: "attack", label: "Ataque", title: "Las ramas de comida van con carne" },
            { id: "defense", label: "Defensa", title: "Las ramas de comida van con pescado" },
            { id: "elemental_res", label: "Res. elemental", title: "Las ramas de comida van con verdura" },
            { id: "none", label: "Sin estadística", title: "No importa la estadística" },
          ]}
        />
        <label className="cs-switch">
          <input type="checkbox" role="switch" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
          <span className="cs-switch__track" aria-hidden />
          Usar solo los que tengo
        </label>
      </div>

      <div className="sf__out" aria-live="polite">
        {!res ? (
          <p className="muted small">Elige una habilidad para ver la propuesta.</p>
        ) : (
          <>
            <h4 className="sf__h">{res.ok ? "Propuesta" : "No sale este plato"}</h4>
            {!res.ok && res.reason_es && <p className="sf__reason">{res.reason_es}</p>}
            {res.picks.length > 0 && (
              <ul className="sf__plate" ref={propRef} aria-label="Ingredientes propuestos">
                {res.picks.map((p) => {
                  const ing = ingById.get(p.id);
                  const br = engine.branchOf(p.id);
                  return (
                    <li key={p.id} data-id={p.id} data-br={brKey(br)} title={`${ing?.name_es ?? p.id} · ${engine.branch(br ?? "")?.name_es ?? ""}`}>
                      {ing && <IngIcon ing={ing} size={32} />}
                      <span className="sr-only">{ing?.name_es ?? p.id}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {res.result && res.ok && <p className="sf__sum">{res.result.summary_es}</p>}
            {res.notes_es.length > 0 && (
              <ul className="sf__notes small">
                {res.notes_es.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {res.missing.length > 0 && (
              <div className="sf__missing small">
                <b>Te faltan:</b>
                <ul>
                  {res.missing.map((m) => (
                    <li key={m.id}>
                      {m.name_es}
                      {m.unlock_es && <span className="muted"> · {m.unlock_es}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="bg-btn sf__load" onClick={load} disabled={!res.ok || !res.picks.length}>
              Cargar en el plato
            </button>
          </>
        )}
      </div>
    </div>
  );
}
