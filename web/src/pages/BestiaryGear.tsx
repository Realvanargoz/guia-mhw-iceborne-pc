import { ReactNode, useEffect, useId, useMemo, useState } from "react";
import { safeHref } from "../safeUrl";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../api";
import { Book, Page, RankSelector } from "../components/book";
import { DecoChip, DefenseBox, OwnedBadge, Resistances, SkillList, SlotRow } from "../components/BuildView";
import { EntityIcon, Icon } from "../components/Icon";
import { ErrorBox, OrnateHeader, useRovingKeys } from "../components/ui";
import { Build, MonsterBuilds, SLOTS, SLOT_ES, loadOwned, loadoutFromBuild, monsterBuildsPath } from "../build";
import { RANK_LABEL } from "../labels";

export function Skeleton() {
  return (
    <div className="bg-skel" role="status" aria-busy="true" aria-label="Calculando la recomendación">
      <Book>
        <Page className="bst__left">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="bg-skel__row" />
          ))}
        </Page>
        <Page className="bst__right">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-skel__row bg-skel__row--s" />
          ))}
        </Page>
      </Book>
    </div>
  );
}

function Toggle({ on, onChange, disabled, children, hint }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className={`bg-tog${on ? " bg-tog--on" : ""}${disabled ? " bg-tog--off" : ""}`} title={hint}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="bg-tog__box" aria-hidden />
      <span>{children}</span>
    </label>
  );
}

function PieceBlock({ p, build, slotDecos }: { p: Build["pieces"][number]; build: Build; slotDecos: (number | null)[] }) {
  const decoById = new Map(build.decorations.map((d) => [d.decoration_id, d]));
  return (
    <li className="bg-piece">
      <div className="bg-piece__head">
        <Link to={`/armaduras/piezas/${p.id}`} className="bg-piece__ico" title="Ver pieza">
          <EntityIcon type="armor" sub={p.type} rarity={p.rarity} size="lg" alt={SLOT_ES[p.type]} />
        </Link>
        <div className="bg-piece__t">
          <span className="bg-piece__slot">{SLOT_ES[p.type]}</span>
          <Link to={`/armaduras/piezas/${p.id}`} className="bg-piece__n">
            {p.name_es || p.name_en}
          </Link>
          <span className="bg-piece__set">
            {p.set_id ? <Link to={`/armaduras/${p.set_id}`}>{p.set_name_es || p.set_name_en}</Link> : p.set_name_es}
          </span>
        </div>
        <div className="bg-piece__def" title="Defensa base / mejorada">
          <b>{p.defense_base}</b>
          <small>→ {p.defense_max}</small>
        </div>
        {p.owned && <OwnedBadge />}
      </div>
      {p.slots.length > 0 && (
        <div className="bg-piece__slots">
          {p.slots.map((s, i) => {
            const d = slotDecos[i] != null ? decoById.get(slotDecos[i] as number) : undefined;
            return (
              <SlotRow key={i} size={s}>
                {d && <DecoChip id={d.decoration_id} name={d.name_es || d.name_en} size={d.size} difficulty={d.difficulty} owned={d.owned} />}
              </SlotRow>
            );
          })}
        </div>
      )}
    </li>
  );
}

export function BuildPages({ data, build, monsterName, heading = "Equipo para cazar en solitario" }: { data: MonsterBuilds; build: Build; monsterName: string; heading?: string }) {
  const lo = useMemo(() => loadoutFromBuild(build), [build]);
  const relevant = useMemo(() => {
    const set = new Set<number>();
    for (const s of build.skills) {
      const name = s.name_es ?? "";
      if (name && build.why_es.some((w) => w.startsWith(name) && /porque|evita|plaga|≥/i.test(w))) set.add(s.skill_id);
    }
    return set;
  }, [build]);
  const weaponDecos = build.decorations.filter((d) => d.piece === "weapon");
  const byType = new Map(build.pieces.map((p) => [p.type, p]));
  return (
    <Book>
      <Page className="bst__left bg-left">
        <div className="bst__title">
          <span className="bst__class">{heading}</span>
          <h2>{monsterName}</h2>
          <em>{build.name_es}</em>
        </div>
        <ul className="bg-pieces">
          {SLOTS.map((t) => {
            const p = byType.get(t);
            return p ? <PieceBlock key={t} p={p} build={build} slotDecos={lo.decos[t] ?? []} /> : null;
          })}
          {build.charm && (
            <li className="bg-piece">
              <div className="bg-piece__head">
                <Link to={`/amuletos/${build.charm.id}`} className="bg-piece__ico">
                  <EntityIcon type="charm" rarity={build.charm.rarity} size="lg" alt="Amuleto" />
                </Link>
                <div className="bg-piece__t">
                  <span className="bg-piece__slot">Amuleto</span>
                  <Link to={`/amuletos/${build.charm.id}`} className="bg-piece__n">
                    {build.charm.name_es || build.charm.name_en}
                  </Link>
                  <span className="bg-piece__set">{build.charm.generic_es}</span>
                </div>
                {build.charm.owned && <OwnedBadge />}
              </div>
            </li>
          )}
          {weaponDecos.length > 0 && (
            <li className="bg-piece">
              <div className="bg-piece__head">
                <Icon kind="ui" name="weapon-great-sword" tile size="lg" />
                <div className="bg-piece__t">
                  <span className="bg-piece__slot">Arma</span>
                  <span className="bg-piece__n">Joyas en las ranuras del arma</span>
                </div>
              </div>
              <div className="bg-piece__slots">
                {weaponDecos.map((d, i) => (
                  <SlotRow key={i} size={d.slot_size ?? d.size}>
                    <DecoChip id={d.decoration_id} name={d.name_es || d.name_en} size={d.size} difficulty={d.difficulty} owned={d.owned} />
                  </SlotRow>
                ))}
              </div>
            </li>
          )}
        </ul>
        {build.slots_free.length > 0 && (
          <p className="bv-hint">
            Ranuras libres: {build.slots_free.map((s) => `${SLOT_ES[s.piece] ?? s.piece} (${s.size})`).join(", ")}
          </p>
        )}
      </Page>
      <Page className="bst__right bg-right">
        <OrnateHeader as="h3" className="ohead--sm">
          Habilidades resultantes
        </OrnateHeader>
        <SkillList skills={build.skills} relevant={relevant} />
        {build.set_bonuses.length > 0 && (
          <ul className="bg-bonus">
            {build.set_bonuses.map((b, i) => (
              <li key={i} className={b.active ? "on" : ""}>
                <b>{b.name_es}</b> · {b.skill_es} <small>({b.pieces}/{b.required} piezas{b.active ? ", activo" : ""})</small>
              </li>
            ))}
          </ul>
        )}
        <OrnateHeader as="h3" className="ohead--sm">
          Defensa y resistencias
        </OrnateHeader>
        <DefenseBox d={build.defense} />
        <Resistances res={build.resistances} />
        {build.why_es.length > 0 && (
          <>
            <OrnateHeader as="h3" className="ohead--sm">
              Por qué este equipo
            </OrnateHeader>
            <ul className="bg-list">
              {build.why_es.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </>
        )}
        {(build.gaps_es.length > 0 || build.warnings.length > 0) && (
          <div className="bg-warn">
            <b>Ojo</b>
            <ul>
              {[...build.gaps_es, ...build.warnings].map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {build.swap_hints.length > 0 && (
          <div className="bg-sug">
            <OrnateHeader as="h3" className="ohead--sm">
              Sugerencias para pegar más fuerte
            </OrnateHeader>
            <p className="bv-hint">Opcionales: cambian seguridad por daño. No forman parte de la recomendación defensiva.</p>
            <ul className="bg-list bg-list--sug">
              {build.swap_hints.map((h, i) => (
                <li key={i}>{h.text_es}</li>
              ))}
            </ul>
          </div>
        )}
        {data.rules_version != null && <p className="bv-hint bg-meta">Reglas v{data.rules_version}{data.elapsed_ms != null ? ` · calculado en ${Math.round(data.elapsed_ms)} ms` : ""}</p>}
      </Page>
    </Book>
  );
}

export default function BestiaryGear({ monsterId, monsterName, ranks }: { monsterId: number; monsterName: string; ranks: string[] }) {
  const [sp, setSp] = useSearchParams();
  const rankParam = sp.get("rank");
  const rank = rankParam && ranks.includes(rankParam) ? rankParam : ranks[ranks.length - 1] ?? "HR";
  const wantOwned = sp.get("owned") === "1";
  const cap = sp.get("cap") === "full" ? "full" : "progress";
  const [idx, setIdx] = useState(0);
  const uid = useId();
  const [ownedOk, setOwnedOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    loadOwned().then((o) => live && setOwnedOk(o.available));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => setIdx(0), [monsterId, rank, wantOwned, cap]);

  const owned = wantOwned && ownedOk !== false;
  const { data, error, loading, reload } = useApi<MonsterBuilds>(monsterBuildsPath(monsterId, rank, owned, cap));
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k);
    else n.set(k, v);
    setSp(n, { replace: true });
  };
  const build = data?.builds?.[Math.min(idx, (data.builds.length || 1) - 1)];
  const curIdx = data ? Math.min(idx, (data.builds.length || 1) - 1) : 0;
  const altKeys = useRovingKeys(data?.builds.length ?? 0, curIdx, setIdx);
  const capVals = ["progress", "full"] as const;
  const capKeys = useRovingKeys(2, capVals.indexOf(cap), (i) => set("cap", i === 0 ? null : capVals[i]), true);

  return (
    <div className="bg">
      <div className="bg-bar">
        <RankSelector ranks={ranks.map((r) => ({ id: r, label: RANK_LABEL[r] ?? r }))} value={rank} onChange={(r) => set("rank", r)} />
        <div className="bg-bar__opts">
          <Toggle
            on={owned}
            onChange={(v) => set("owned", v ? "1" : null)}
            disabled={ownedOk === false}
            hint={ownedOk === false ? "Pulsa Actualizar perfil en el inicio para leer tu cofre de equipo" : "Usa solo las piezas y joyas de tu cofre"}
          >
            Solo mis piezas
          </Toggle>
          <div className="bg-seg" role="radiogroup" aria-label="Límite de rareza" onKeyDown={capKeys}>
            {(
              [
                ["progress", "Progresión"],
                ["full", "Todo el rango"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={cap === v} tabIndex={cap === v ? 0 : -1} className={cap === v ? "on" : ""} onClick={() => set("cap", v === "progress" ? null : v)} title={v === "progress" ? "Equipo accesible durante la progresión de este rango" : "Incluye lo más raro de todo el rango"}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {ownedOk === false && <p className="bv-hint bg-bar__hint">«Solo mis piezas» no está disponible: pulsa «Actualizar perfil» en el inicio para leer tu cofre de equipo.</p>}
      </div>

      {rankParam && !ranks.includes(rankParam) && (
        <p className="bg-note">
          {monsterName} no aparece en {RANK_LABEL[rankParam] ?? rankParam}; se muestra {RANK_LABEL[rank] ?? rank}.
        </p>
      )}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.available === false && (
        <div className="bg-empty">
          <p>
            <b>{monsterName}</b> no aparece en {RANK_LABEL[rank] ?? rank}: no hay equipo que recomendar para este rango.
          </p>
          {data.related?.length ? (
            <p>
              Variante en este rango:{" "}
              {data.related.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link to={`/bestiario/${r.id}?tab=equipo&rank=${rank}`}>{r.name_es || r.name_en}</Link>
                </span>
              ))}
              .
            </p>
          ) : null}
        </div>
      )}
      {data && data.available !== false && !data.builds.length && (
        <div className="bg-empty">
          <p>No se pudo componer un equipo con las restricciones actuales{owned ? " (quizá te falten piezas en el cofre)" : ""}.</p>
          {data.notes.map((n, i) => (
            <p key={i} className="bv-hint">
              {n}
            </p>
          ))}
        </div>
      )}
      {data && data.owned_mode && data.owned_available === false && (
        <p className="bg-note">Tu partida guardada aún no incluye el cofre de equipo: se muestra la recomendación general. Pulsa «Actualizar perfil».</p>
      )}

      {data && build && (
        <>
          {data.builds.length > 1 && (
            <div className="bg-alts" role="tablist" aria-label="Alternativas" onKeyDown={altKeys}>
              {data.builds.map((b, i) => (
                <button key={i} type="button" role="tab" id={`${uid}-alt-${i}`} aria-controls={`${uid}-altp`} aria-selected={i === curIdx} tabIndex={i === curIdx ? 0 : -1} className={i === curIdx ? "bg-alt bg-alt--on" : "bg-alt"} onClick={() => setIdx(i)}>
                  <span className="bg-alt__n">{i === 0 ? "Recomendado" : `Alternativa ${i + 1}`}</span>
                  <span className="bg-alt__d">{b.pieces.map((p) => p.set_name_es || p.set_name_en).filter((v, k, a) => a.indexOf(v) === k).slice(0, 3).join(" + ")}</span>
                  <span className="bg-alt__i">
                    {b.pieces.map((p) => (
                      <EntityIcon key={p.id} type="armor" sub={p.type} rarity={p.rarity} size="xs" />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div
            id={`${uid}-altp`}
            role={data.builds.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={data.builds.length > 1 ? `${uid}-alt-${curIdx}` : undefined}
          >
            <BuildPages data={data} build={build} monsterName={monsterName} />
          </div>
          <div className="bg-actions">
            <Link
              className="bg-btn"
              to={`/constructor?monster=${monsterId}&rank=${rank}&build=${Math.min(idx, data.builds.length - 1)}${owned ? "&owned=1" : ""}${cap === "full" ? "&cap=full" : ""}`}
            >
              Abrir en el constructor
            </Link>
            <span className="bv-hint">Cambia piezas y joyas con libertad y comprueba las habilidades al instante.</span>
          </div>
        </>
      )}

      {data && (
        <div className="bg-foot">
          <p className="bg-disc" role="note">
            <b>Importante.</b> {data.disclaimer_es}
          </p>
          {data.notes.length > 0 && data.builds.length > 0 && (
            <ul className="bg-notes">
              {data.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {data.sources?.length > 0 && (
            <details className="bg-src">
              <summary>Fuentes y reglas ({data.sources.length})</summary>
              <p className="bv-hint">
                Las reglas de composición (qué estados alterados y elementos importan, qué habilidades priorizar) salen de estas fuentes; revísalas si algo no te cuadra.
              </p>
              <ul>
                {data.sources.map((s) => (
                  <li key={s.id}>
                    <a href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
