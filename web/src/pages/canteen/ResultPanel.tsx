import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Gem } from "../../components/book";
import type { BranchRow, CanteenEngine, SimResult, StatKey, Voucher } from "./engine";
import { STAT_ORDER } from "./engine";
import { flipIn } from "./anim";
import { BranchGlyph } from "./BranchGlyph";
import { ROMAN, brKey } from "./types";

const STAR_D = "M12 2.3l2.9 6.1 6.7.9-4.9 4.6 1.2 6.6L12 17.2l-5.9 3.3 1.2-6.6-4.9-4.6 6.7-.9z";
const STAT_SRC: Record<StatKey, string> = { attack: "carne", defense: "pescado", elemental_res: "verdura" };
const fmt = (n: number) => String(n).replace(".", ",");

/** Wax seal that plays once at the scroll's top-right corner, fades out and unmounts (ended, error or 1.6 s fallback). */
function Seal({ onDone }: { onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), 1600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <video
      className="cs-seal"
      src="/ui/canteen/anim/skill-seal.webm"
      muted
      autoPlay
      playsInline
      aria-hidden
      onEnded={() => done.current()}
      onError={() => done.current()}
    />
  );
}

function HalfStars({ value }: { value: number }) {
  return (
    <span className="cs-stars" role="img" aria-label={`${fmt(value)} de 3 estrellas`}>
      {[0, 1, 2].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={`${i}-${fill}`} className="cs-star" style={{ "--i": i } as CSSProperties} data-fill={fill === 1 ? "full" : fill > 0 ? "half" : "none"}>
            <svg viewBox="0 0 24 24" className="bstar" aria-hidden>
              <path d={STAR_D} />
            </svg>
            {fill > 0 && (
              <span className="cs-star__fill" style={{ width: `${fill * 100}%` }}>
                <svg viewBox="0 0 24 24" className="bstar bstar--on" aria-hidden>
                  <path d={STAR_D} />
                </svg>
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Six pips in three pairs/segments; `count` filled, segment `hit` (1..3) is the reached one. */
function Pips({ count, hit, superseded = 0, labels }: { count: number; hit: number; superseded?: number; labels: string[] }) {
  const n = Math.min(6, count);
  return (
    <span className="cs-pips" aria-hidden>
      {[1, 2, 3].map((seg) => (
        <span key={seg} className={`cs-pips__seg${seg === hit ? " is-hit" : ""}${seg <= superseded ? " is-old" : ""}`} data-k={seg === hit ? `hit-${hit}` : undefined}>
          <span className="cs-pips__row">
            {[0, 1].map((j) => {
              const i = (seg - 1) * 2 + j;
              return <span key={j} className={`cs-pip${i < n ? " on" : ""}`} style={{ "--i": i } as CSSProperties} />;
            })}
          </span>
          <span className="cs-pips__lab">{labels[seg - 1]}</span>
        </span>
      ))}
    </span>
  );
}

function BranchBar({ row, engine, free }: { row: BranchRow; engine: CanteenEngine; free: number }) {
  const b = engine.branch(row.branch);
  const ladder = engine.branchSkills(row.branch);
  const active = row.tier ? ladder[row.tier - 1] : null;
  const next = row.nextSkillId ? engine.skill(row.nextSkillId) : null;
  const showNext = row.nextAt != null && next && free >= row.nextAt;
  return (
    <li className="cs-bbar" data-br={brKey(row.branch)}>
      <div className="cs-bbar__head">
        <span className="cs-chip">
          <BranchGlyph branch={row.branch} size={14} />
          {b?.name_es ?? row.branch}
        </span>
        <span className="cs-bbar__n">×{row.count}</span>
        <span className="cs-bbar__skill">
          {active ? (
            <>
              <Gem size={14} active />
              <b>{active.name_es}</b>
              <span className="muted"> · nivel {ROMAN[row.tier]}</span>
            </>
          ) : (
            <span className="muted">Aún sin habilidad: hacen falta 2</span>
          )}
        </span>
      </div>
      <Pips count={row.count} hit={row.tier} superseded={row.tier - 1} labels={ladder.map((s) => s.name_es)} />
      <p className="sr-only">
        {b?.name_es}: {row.count} ingredientes, {active ? `activa ${active.name_es}` : "sin habilidad"}.
      </p>
      {row.tier > 1 && (
        <p className="cs-bbar__old small">
          {ladder
            .slice(0, row.tier - 1)
            .map((s) => s.name_es)
            .join(" y ")}{" "}
          {row.tier > 2 ? "no incluidas" : "no incluida"}: la rama da solo su nivel más alto.
        </p>
      )}
      {showNext && (
        <p className="cs-bbar__next small">
          <b>+{row.nextAt}</b> → {next.name_es}
        </p>
      )}
    </li>
  );
}

export function ResultPanel({ engine, sim, voucher, reduced }: { engine: CanteenEngine; sim: SimResult; voucher: Voucher; reduced: boolean }) {
  const scrollRefs = useRef<(HTMLLIElement | null)[]>([]);
  const prevActive = useRef<Set<string>>(new Set());
  const [seals, setSeals] = useState<Record<number, number>>({});

  useLayoutEffect(() => {
    const before = prevActive.current;
    const fresh: number[] = [];
    sim.skillSlots.forEach((s, i) => {
      if (s.kind === "branch" && s.skillId && !before.has(s.skillId)) fresh.push(i);
    });
    prevActive.current = new Set(sim.activeSkillIds);
    if (!fresh.length) return;
    fresh.forEach((i, k) => flipIn(scrollRefs.current[i], k * 90));
    if (!reduced) setSeals((m) => ({ ...m, ...Object.fromEntries(fresh.map((i) => [i, Date.now() + i])) }));
  }, [sim, reduced]);

  const stats = STAT_ORDER.map((k) => ({ key: k, row: sim.stats[k] }));
  const allDrinks = sim.count > 0 && sim.drinks === sim.count;
  const free = sim.slots - sim.count;
  const starText =
    voucher === "gourmet"
      ? "Vale Gourmet: todo fresco y 3 estrellas."
      : voucher === "voucher"
        ? "Vale: activación al máximo (3 estrellas)."
        : sim.fresh
          ? `${sim.fresh} ${sim.fresh === 1 ? "ingrediente fresco" : "ingredientes frescos"}: media estrella cada uno.`
          : "Sin frescos ni vale: marca la hoja de los ingredientes frescos.";

  return (
    <div className="cs-res">
      <p className="cs-res__sum" aria-live="polite">
        {sim.count ? sim.summary_es : "Plato vacío: añade ingredientes para ver qué habilidades salen."}
      </p>

      <ol className="cs-scrolls" aria-label="Huecos de habilidad">
        {sim.skillSlots.map((s, i) => {
          const sk = s.skillId ? engine.skill(s.skillId) : null;
          const tier = s.skillId ? engine.skillTier(s.skillId)?.tier ?? 0 : 0;
          const bName = s.branch ? engine.branch(s.branch)?.name_es ?? s.branch : null;
          return (
            <li
              key={i}
              ref={(el) => {
                scrollRefs.current[i] = el;
              }}
              className={`cs-scroll cs-scroll--${s.kind}`}
              data-br={s.kind === "branch" ? brKey(s.branch) : undefined}
            >
              <div className="cs-scroll__head">
                {s.kind === "branch" ? (
                  <>
                    <BranchGlyph branch={s.branch} size={16} />
                    <span>{bName}</span>
                    <span className="cs-scroll__tier">
                      <Gem size={13} active />
                      {ROMAN[tier]}
                    </span>
                  </>
                ) : (
                  <span>{s.kind === "daily" ? "Diaria de la cantina" : "Hueco libre"}</span>
                )}
              </div>
              <div className="cs-scroll__body">
                {s.kind === "random" ? (
                  <>
                    <b className="cs-scroll__name">Diaria al azar</b>
                    <p className="small">La cantina rellena este hueco con una de sus habilidades diarias.</p>
                  </>
                ) : (
                  <>
                    <b className="cs-scroll__name">{sk?.name_es ?? s.skillId}</b>
                    {sk?.effect_es && <p className="small">{sk.effect_es}</p>}
                    {sk?.synergy_es && (
                      <p className="small cs-scroll__ideal">
                        <b>Uso:</b> {sk.synergy_es}
                      </p>
                    )}
                  </>
                )}
              </div>
              {seals[i] && !reduced && (
                <Seal
                  key={seals[i]}
                  onDone={() =>
                    setSeals((m) => {
                      const n = { ...m };
                      delete n[i];
                      return n;
                    })
                  }
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="cs-res__grid">
        <section className="cs-res__block" aria-labelledby="cs-act">
          <h4 className="cs-h" id="cs-act">
            Activación
          </h4>
          <div className="cs-act">
            <HalfStars value={sim.stars} />
            <b className="cs-act__n">{fmt(sim.stars)} / 3</b>
          </div>
          <p className="small">{starText}</p>
          <p className="small muted">Más estrellas, más probabilidad de que salten las habilidades (no hay cifras oficiales).</p>
        </section>

        <section className="cs-res__block" aria-labelledby="cs-stats">
          <h4 className="cs-h" id="cs-stats">
            Estadísticas
          </h4>
          {allDrinks ? (
            <p className="cs-nostat">Sin estadística: las bebidas no suben ataque, defensa ni resistencias.</p>
          ) : (
            <ul className="cs-meters">
              {stats.map(({ key, row }) => (
                <li key={key} className={`cs-meter${row.level ? " cs-meter--on" : ""}`}>
                  <span className="cs-meter__l">
                    {engine.statLabel_es[key]}
                    <small>{STAT_SRC[key]}</small>
                  </span>
                  <Pips count={row.count} hit={row.level} labels={["P", "M", "G"]} />
                  <span className="cs-meter__v" aria-hidden>
                    {row.level ? row.label_es : "—"}
                  </span>
                  <span className="sr-only">
                    {engine.statLabel_es[key]}: {row.count} de {STAT_SRC[key]}, {row.level ? `nivel ${row.label_es}` : "sin mejora"}.
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="cs-vitals small">
            <span>
              <b>+{sim.health.hunter}</b> vida máx.
            </span>
            <span>
              Camarada <b>+{sim.health.palico}</b>
            </span>
            <span>
              <b>+{sim.stamina}</b> aguante
            </span>
          </p>
        </section>
      </div>

      <section className="cs-res__block" aria-labelledby="cs-br">
        <h4 className="cs-h" id="cs-br">
          Ramas del plato
        </h4>
        {sim.branches.some((b) => b.count > 0) ? (
          <ul className="cs-bbars">
            {sim.branches
              .filter((b) => b.count > 0)
              .map((row) => (
                <BranchBar key={row.branch} row={row} engine={engine} free={free} />
              ))}
          </ul>
        ) : (
          <p className="small muted">Con 2, 4 o 6 ingredientes de la misma rama se activa su habilidad de nivel I, II o III.</p>
        )}
      </section>

      {(sim.errors_es.length > 0 || sim.warnings_es.length > 0) && (
        <ul className="cs-notes small">
          {sim.errors_es.map((e, i) => (
            <li key={`e${i}`} className="cs-notes__err">
              {e.text_es}
            </li>
          ))}
          {sim.warnings_es.map((w, i) => (
            <li key={`w${i}`}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
