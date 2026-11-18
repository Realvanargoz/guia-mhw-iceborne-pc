/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeHref } from "../safeUrl";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useApi } from "../api";
import { ELink, ErrorBox, Loading, Name, Pct, RankBadge, Section } from "../components/ui";
import { LOCATION_KIND, QUEST_CATEGORY } from "../labels";
import { Guides } from "./Monsters";
import { usePageTitle } from "../usePageTitle";

export function LocationList() {
  const { data, error, loading } = useApi<any[]>("/locations");
  return (
    <div>
      <h1 className="page-title">Mapas</h1>
      <p className="lead small">
        Cada mapa se organiza por áreas numeradas (las del mapa del juego) y sus campamentos. Usa el enlace externo para
        ver el mapa con los números de área.
      </p>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <div className="cards">
        {(data ?? []).map((l) => (
          <Link key={l.id} to={`/mapas/${l.id}`} className="card card__link">
            <Name es={l.name_es} en={l.name_en} />
            <span className="card__badges">
              <span className="badge">{LOCATION_KIND[l.kind] ?? l.kind}</span>
              {l.expansion === "iceborne" && <span className="badge badge--mr">Iceborne</span>}
            </span>
            <span className="muted small">
              {l.zone_count ? `${l.zone_count} áreas · ` : ""}
              {l.camps} campamentos · {l.gather_items} recolectables · {l.monsters} monstruos
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function LocationPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const { data: l, error, loading } = useApi<any>(`/locations/${id}`);
  const [rank, setRank] = useState<string>("all");
  useEffect(() => {
    if (l && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [l, hash]);
  usePageTitle(l ? l.name_es || l.name_en : null);
  if (loading && !l) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!l) return null;
  const showItem = (it: any) => rank === "all" || it.rank === rank || (it.rank == null && rank !== "MR");

  return (
    <article>
      <header className="ehead">
        <Name as="h1" es={l.name_es} en={l.name_en} />
        <div className="ehead__meta">
          <span className="badge">{LOCATION_KIND[l.kind] ?? l.kind}</span>
          {l.zone_count && <span className="badge">{l.zone_count} áreas</span>}
          {l.external_map_url && (
            <a className="btn" href={safeHref(l.external_map_url)} target="_blank" rel="noreferrer noopener">
              Ver mapa con áreas ↗
            </a>
          )}
        </div>
      </header>
      {l.notes_es && <p className="lead">{l.notes_es}</p>}

      {l.camps.length > 0 && (
        <Section title="Campamentos">
          <ul className="rows">
            {l.camps.map((c: any) => (
              <li key={c.id}>
                <a href={`#area-${c.area}`} className="badge">
                  Área {c.area ?? "?"}
                </a>
                <Name es={c.name_es} en={c.name_en} />
                {c.unlock_es && <span className="muted small">{c.unlock_es}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Áreas"
        aside={
          <div className="chips">
            {[
              ["all", "Todo"],
              ["LR", "RB"],
              ["HR", "RA"],
              ["MR", "RM"],
            ].map(([k, lbl]) => (
              <button key={k} className={rank === k ? "chip chip--on" : "chip"} onClick={() => setRank(k)}>
                {lbl}
              </button>
            ))}
          </div>
        }
      >
        <div className="areas">
          {l.areas.map((a: any) => {
            const items = a.items.filter(showItem);
            return (
              <div key={a.area} id={`area-${a.area}`} className="area">
                <h3 className="area__title">
                  Área {a.area}
                  {a.camps.map((c: any) => (
                    <span key={c.id} className="badge badge--camp">
                      ⛺ {c.name_es || c.name_en}
                    </span>
                  ))}
                </h3>
                {a.monsters.length > 0 && (
                  <p className="small">
                    {a.monsters.map((m: any, i: number) => (
                      <span key={m.id}>
                        {i > 0 && ", "}
                        <Link to={`/monstruos/${m.id}`}>{m.name_es || m.name_en}</Link>
                        {m.rest && " 💤"}
                      </span>
                    ))}
                  </p>
                )}
                {items.length > 0 ? (
                  <ul className="area__items">
                    {items.map((it: any, i: number) => (
                      <li key={i}>
                        <ELink type="item" id={it.item_id} es={it.name_es} en={it.name_en} />
                        <span className="rewards__nums">
                          <RankBadge rank={it.rank} />
                          <Pct value={it.percentage} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Sin recolección registrada para este filtro.</p>
                )}
              </div>
            );
          })}
        </div>
        {l.unplaced_items.length > 0 && (
          <>
            <h3 className="sub">Recolección sin área fija</h3>
            <ul className="inline-list">
              {l.unplaced_items.filter(showItem).map((it: any, i: number) => (
                <li key={i}>
                  <ELink type="item" id={it.item_id} es={it.name_es} en={it.name_en} /> <RankBadge rank={it.rank} />
                  {it.notes_es && <span className="muted small"> · {it.notes_es}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {l.monsters.length > 0 && (
        <Section title="Monstruos de la zona">
          <ul className="inline-list">
            {l.monsters.map((m: any) => (
              <li key={m.id}>
                <ELink type="monster" id={m.monster_id} es={m.name_es} en={m.name_en} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {l.quests.length > 0 && (
        <Section title={`Misiones aquí (${l.quests.length})`}>
          <ul className="rows">
            {l.quests.map((q: any) => (
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
      <Guides guides={l.guides} />
    </article>
  );
}
