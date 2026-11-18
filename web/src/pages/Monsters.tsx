/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { Check, ELink, Empty, ErrorBox, Loading, Name, Pct, RankBadge, Section, Tabs } from "../components/ui";
import { Stars as BookStars } from "../components/book";
import "../builder.css";
import { ELEMENTS, QUEST_CATEGORY, RANK_LABEL, STATUSES } from "../labels";
import { usePageTitle } from "../usePageTitle";

export function MonsterList() {
  const [size, setSize] = useState<"large" | "small">("large");
  const [filter, setFilter] = useState("");
  const { data, error, loading } = useApi<any[]>(`/monsters?size=${size}`);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    return (data ?? []).filter(
      (m) => !f || `${m.name_es ?? ""} ${m.name_en}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(f),
    );
  }, [data, filter]);
  return (
    <div>
      <h1 className="page-title">Monstruos</h1>
      <div className="toolbar">
        <Tabs
          tabs={[
            { id: "large", label: "Grandes" },
            { id: "small", label: "Pequeños" },
          ]}
          value={size}
          onChange={setSize}
        />
        <input className="filter" placeholder="Filtrar…" aria-label="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <div className="cards">
        {rows.map((m) => (
          <div key={m.id} className="card">
            <Link to={`/monstruos/${m.id}`} className="card__link card__link--icon">
              <Icon kind="monster" id={m.id} size="xl" className="icon--mcard" />
              <Name es={m.name_es} en={m.name_en} />
              <span className="muted small">{m.ecology_en ?? ""}</span>
              <span className="card__badges">
                {(m.ranks ?? []).map((r: string) => (
                  <RankBadge key={r} rank={r} />
                ))}
              </span>
            </Link>
            {size === "large" && (
              <div className="card__checks">
                <Check type="monster_hunted" id={m.id} done={m.hunted} label="Cazado" />
                <Check type="monster_captured" id={m.id} done={m.captured} label="Capturado" />
              </div>
            )}
          </div>
        ))}
      </div>
      {!loading && data && !rows.length && filter.trim() && <Empty>Sin resultados para «{filter.trim()}»</Empty>}
    </div>
  );
}

function Stars({ n }: { n?: number | null }) {
  if (n == null) return <span className="muted">—</span>;
  return <BookStars n={n} max={3} />;
}

export function MonsterPage() {
  const { id } = useParams();
  const { data: m, error, loading } = useApi<any>(`/monsters/${id}`);
  const ranks = Object.keys(m?.rewards ?? {});
  const [rank, setRank] = useState<string | null>(null);
  const [showHz, setShowHz] = useState(false);
  usePageTitle(m ? m.name_es || m.name_en : null);
  if (loading && !m) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!m) return null;
  const activeRank = rank && ranks.includes(rank) ? rank : ranks[ranks.length - 1];
  const traps = [
    ["Trampa de foso", m.pitfall_trap],
    ["Trampa de choque", m.shock_trap],
    ["Trampa de enredadera", m.vine_trap],
  ];

  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <Icon kind="monster" id={m.id} size={96} alt={m.name_es || m.name_en} />
          <Name as="h1" es={m.name_es} en={m.name_en} />
        </div>
        <div className="ehead__meta">
          {m.ecology_en && <span className="badge">{m.ecology_en}</span>}
          <span className="badge">{m.size === "large" ? "Grande" : "Pequeño"}</span>
        </div>
        {m.size === "large" && (
          <div className="ehead__checks">
            <Check type="monster_hunted" id={m.id} done={m.progress.hunted} label="Cazado" />
            <Check type="monster_captured" id={m.id} done={m.progress.captured} label="Capturado" />
          </div>
        )}
      </header>
      {m.description_es && <p className="lead">{m.description_es}</p>}
      {m.size === "large" && (
        <div className="eqcard">
          <Icon kind="ui" name="armor-armorset" tile size="lg" />
          <div className="eqcard__t">
            <b>Equipo recomendado</b>
            <span>El set y las joyas para cazarlo en solitario sin sufrir; después lo ajustas a tu gusto.</span>
          </div>
          <Link className="bg-btn" to={`/bestiario/${m.id}?tab=equipo${activeRank ? `&rank=${activeRank}` : ""}`}>
            Ver equipo
          </Link>
        </div>
      )}

      {m.weaknesses?.length > 0 && (
        <Section title="Debilidades">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Forma</th>
                  {[...ELEMENTS, ...STATUSES].map(([k, l]) => (
                    <th key={k}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.weaknesses.map((w: any) => (
                  <tr key={w.id}>
                    <td>{w.form === "normal" ? "Normal" : w.alt_description || w.form}</td>
                    {[...ELEMENTS, ...STATUSES].map(([k]) => (
                      <td key={k}>
                        <Stars n={w[k]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.size === "large" && (
            <p className="muted small">
              Trampas:{" "}
              {traps.map(([l, v]) => (
                <span key={String(l)} className={v ? "ok" : "no"}>
                  {String(l)} {v ? "✓" : "✗"}{"  "}
                </span>
              ))}
            </p>
          )}
        </Section>
      )}

      <Section title="Dónde encontrarlo">
        {m.habitats?.length ? (
          <ul className="habitats">
            {m.habitats.map((h: any) => (
              <li key={h.id}>
                <ELink type="location" id={h.location_id} es={h.location_es} en={h.location_en} />
                {h.rank && <RankBadge rank={h.rank} />}
                <div className="small">
                  {h.areas?.length > 0 && (
                    <span>
                      Áreas: <b>{h.areas.join(", ")}</b>
                    </span>
                  )}
                  {h.start_area && <span> · Aparece en: {h.start_area}</span>}
                  {h.rest_area && <span> · Duerme en: {h.rest_area}</span>}
                </div>
                {h.notes_es && <p className="small">{h.notes_es}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Sin datos de hábitat todavía. Revisa sus misiones abajo.</Empty>
        )}
      </Section>

      {ranks.length > 0 && (
        <Section
          title="Recompensas"
          aside={
            <Tabs
              tabs={ranks.map((r) => ({ id: r, label: RANK_LABEL[r] ?? r }))}
              value={activeRank}
              onChange={(r) => setRank(r)}
            />
          }
        >
          <div className="rewards">
            {m.rewards[activeRank].map((g: any) => (
              <div key={g.condition_en} className="rewards__group">
                <h3>
                  {g.condition_es}
                  {g.condition_es !== g.condition_en && <span className="name__en">{g.condition_en}</span>}
                </h3>
                <ul>
                  {g.items.map((it: any, i: number) => (
                    <li key={i}>
                      <ELink type="item" id={it.item_id} es={it.item_es} en={it.item_en} />
                      <span className="rewards__nums">
                        {it.stack > 1 && <span className="muted">×{it.stack}</span>}
                        <Pct value={it.percentage} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {m.breaks?.length > 0 && (
        <Section title="Partes rompibles">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Parte</th>
                  <th>Retroceso</th>
                  <th>Herida</th>
                  <th>Cortar</th>
                  <th>Extracto</th>
                </tr>
              </thead>
              <tbody>
                {m.breaks.map((b: any) => (
                  <tr key={b.id}>
                    <td>{b.part_en}</td>
                    <td>{b.flinch ?? "—"}</td>
                    <td>{b.wound ?? "—"}</td>
                    <td>{b.sever ?? "—"}</td>
                    <td>
                      <span className={`extract extract--${b.extract}`}>{b.extract ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {m.hitzones?.length > 0 && (
        <Section
          title="Zonas de daño"
          aside={
            <button className="btn-link" onClick={() => setShowHz(!showHz)}>
              {showHz ? "Ocultar" : `Mostrar (${m.hitzones.length})`}
            </button>
          }
        >
          {showHz && (
            <div className="table-wrap">
              <table className="table table--num">
                <thead>
                  <tr>
                    <th>Zona</th>
                    <th>Corte</th>
                    <th>Impacto</th>
                    <th>Disparo</th>
                    {ELEMENTS.map(([k, l]) => (
                      <th key={k}>{l}</th>
                    ))}
                    <th>KO</th>
                  </tr>
                </thead>
                <tbody>
                  {m.hitzones.map((h: any) => (
                    <tr key={h.id}>
                      <td>{h.hitzone_en}</td>
                      {["cut", "impact", "shot", "fire", "water", "thunder", "ice", "dragon", "ko"].map((k) => (
                        <td key={k} className={h[k] >= 45 && k in { cut: 1, impact: 1, shot: 1 } ? "hot" : ""}>
                          {h[k]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {m.armor_sets?.length > 0 && (
        <Section title="Sets de armadura">
          <ul className="inline-list">
            {m.armor_sets.map((s: any) => (
              <li key={s.id}>
                <ELink type="armor_set" id={s.id} es={s.name_es} en={s.name_en} rarity={s.rarity} /> <RankBadge rank={s.rank} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {m.quests?.length > 0 && (
        <Section title={`Misiones (${m.quests.length})`}>
          <ul className="rows">
            {m.quests.map((q: any) => (
              <li key={q.id}>
                <ELink type="quest" id={q.id} es={q.name_es} en={q.name_en} />
                <span className="muted small">
                  {QUEST_CATEGORY[q.category] ?? q.category} · {q.stars}★
                </span>
                <RankBadge rank={q.rank} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Guides guides={m.guides} />
    </article>
  );
}

export function Guides({ guides }: { guides?: any[] }) {
  if (!guides?.length) return null;
  return (
    <Section title="Guías relacionadas">
      <ul className="rows">
        {guides.map((g) => (
          <li key={g.slug}>
            <Link to={`/guias/${g.slug}`}>{g.title_es}</Link>
            <span className="muted small">{g.summary_es}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
