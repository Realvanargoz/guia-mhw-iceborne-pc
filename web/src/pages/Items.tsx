/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { ELink, Empty, ErrorBox, Loading, Name, Pct, Rarity, RankBadge, Section, Tabs } from "../components/ui";
import { ARMOR_TYPE, ITEM_CATEGORY, LAYERED_CATEGORY, QUEST_CATEGORY, RANK_LABEL, WEAPON_TYPE } from "../labels";
import { Guides } from "./Monsters";
import { usePageTitle } from "../usePageTitle";

export function ItemList() {
  const [category, setCategory] = useState("material");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useApi<any[]>(
    `/items?category=${category}&limit=1500${query ? `&q=${encodeURIComponent(query)}` : ""}`,
  );
  return (
    <div>
      <h1 className="page-title">Materiales y objetos</h1>
      <div className="toolbar">
        <Tabs
          tabs={["material", "item", "misc", "ammo"].map((c) => ({ id: c, label: ITEM_CATEGORY[c] }))}
          value={category}
          onChange={setCategory}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input
            className="filter"
            placeholder="Filtrar por nombre…"
            aria-label="Filtrar por nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <ul className="grid-list">
        {(data ?? []).map((it) => (
          <li key={it.id}>
            <Link to={`/objetos/${it.id}`} className="grid-list__a">
              <Icon kind="item" id={it.id} size="md" />
              <Rarity value={it.rarity} />
              <Name es={it.name_es} en={it.name_en} />
            </Link>
          </li>
        ))}
      </ul>
      {!loading && data && !data.length && query && <Empty>Sin resultados para «{query}»</Empty>}
    </div>
  );
}

type Tab = "monsters" | "gathering" | "quests" | "combinations";

export function ItemPage() {
  const { id } = useParams();
  const { data: it, error, loading } = useApi<any>(`/items/${id}`);
  const [tab, setTab] = useState<Tab | null>(null);
  usePageTitle(it ? it.name_es || it.name_en : null);
  if (loading && !it) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!it) return null;

  const src = it.sources;
  const counts: Record<Tab, number> = {
    monsters: src.monsters.length,
    gathering: src.gathering.length,
    quests: src.quests.length,
    combinations: src.combinations.length,
  };
  const firstTab = (Object.keys(counts) as Tab[]).find((k) => counts[k] > 0) ?? "monsters";
  const active = tab ?? firstTab;
  const nothing = Object.values(counts).every((n) => n === 0);
  const used = it.used_in;

  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <Icon kind="item" id={it.id} size="xl" alt={it.name_es || it.name_en} />
          <Name as="h1" es={it.name_es} en={it.name_en} />
        </div>
        <div className="ehead__meta">
          <Rarity value={it.rarity} />
          {it.category && <span className="badge">{ITEM_CATEGORY[it.category] ?? it.category}</span>}
          {it.subcategory && <span className="badge">{ITEM_CATEGORY[it.subcategory] ?? it.subcategory}</span>}
          {it.carry_limit && <span className="badge">Máx. {it.carry_limit}</span>}
          {it.sell_price && <span className="badge">Venta {it.sell_price} z</span>}
        </div>
      </header>
      {(it.description_es || it.description_en) && <p className="lead">{it.description_es || it.description_en}</p>}

      <BestSources item={it} />

      <Section
        title="Dónde conseguirlo"
        aside={
          !nothing && (
            <Tabs
              tabs={[
                { id: "monsters" as Tab, label: "Monstruos", count: counts.monsters },
                { id: "gathering" as Tab, label: "Recolección", count: counts.gathering },
                { id: "quests" as Tab, label: "Misiones", count: counts.quests },
                { id: "combinations" as Tab, label: "Combinar", count: counts.combinations },
              ].filter((t) => t.count > 0)}
              value={active}
              onChange={setTab}
            />
          )
        }
      >
        {nothing && (
          <Empty>
            No hay fuentes en la base de datos estructurada. Mira las guías relacionadas abajo o búscalo en las armaduras
            superpuestas y eventos.
          </Empty>
        )}
        {active === "monsters" && counts.monsters > 0 && (
          <div className="sources-monsters">
            {src.monsters.map((m: any) => (
              <div key={m.monster_id} className="src-card">
                <div className="src-card__head">
                  <ELink type="monster" id={m.monster_id} es={m.monster_es} en={m.monster_en} />
                  <span className="muted small">
                    Mejor: {RANK_LABEL[m.best.rank]} · {m.best.condition_es} <Pct value={m.best.percentage} />
                  </span>
                </div>
                {Object.entries(m.ranks).map(([rank, rows]: [string, any]) => (
                  <div key={rank} className="src-card__rank">
                    <RankBadge rank={rank} />
                    <ul>
                      {rows.map((r: any, i: number) => (
                        <li key={i}>
                          <span>{r.condition_es}</span>
                          <span className="rewards__nums">
                            {r.stack > 1 && <span className="muted">×{r.stack}</span>}
                            <Pct value={r.percentage} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {active === "gathering" && counts.gathering > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mapa</th>
                  <th>Área</th>
                  <th>Rango</th>
                  <th>Prob.</th>
                  <th>Puntos</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {src.gathering.map((g: any, i: number) => (
                  <tr key={i}>
                    <td>
                      <ELink type="location" id={g.location_id} es={g.location_es} en={g.location_en} />
                    </td>
                    <td>
                      <Link to={`/mapas/${g.location_id}#area-${g.area}`}>Área {g.area ?? "?"}</Link>
                      {g.camp_here && <span className="muted small"> · campamento {g.camp_here}</span>}
                    </td>
                    <td>
                      <RankBadge rank={g.rank} />
                    </td>
                    <td>
                      <Pct value={g.percentage} />
                    </td>
                    <td>{g.nodes ?? "—"}</td>
                    <td className="small">{g.notes_es ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {active === "quests" && counts.quests > 0 && (
          <ul className="rows">
            {src.quests.map((q: any, i: number) => (
              <li key={i}>
                <ELink type="quest" id={q.quest_id} es={q.name_es} en={q.name_en} />
                <span className="muted small">
                  {QUEST_CATEGORY[q.category] ?? q.category} · {q.stars}★
                </span>
                <RankBadge rank={q.rank} />
                <Pct value={q.percentage} />
              </li>
            ))}
          </ul>
        )}
        {active === "combinations" && counts.combinations > 0 && (
          <ul className="rows">
            {src.combinations.map((c: any, i: number) => (
              <li key={i}>
                {c.a_id && <ELink type="item" id={c.a_id} es={c.a_es} en={c.a_en} />}
                {c.b_id && (
                  <>
                    <span className="muted">+</span>
                    <ELink type="item" id={c.b_id} es={c.b_es} en={c.b_en} />
                  </>
                )}
                <span className="muted">→ ×{c.quantity ?? 1}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(used.armor.length || used.weapons.length || used.charms.length || used.layered.length || used.combinations.length) >
        0 && (
        <Section title="Se usa para">
          {used.layered.length > 0 && (
            <>
              <h3 className="sub">Armaduras superpuestas</h3>
              <ul className="inline-list">
                {used.layered.map((l: any) => (
                  <li key={l.slug}>
                    <ELink type="layered" id={l.slug} es={l.name_es} en={l.name_en} />{" "}
                    <span className="muted small">
                      {LAYERED_CATEGORY[l.category]} · ×{l.qty}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {used.armor.length > 0 && (
            <>
              <h3 className="sub">Armaduras ({used.armor.length})</h3>
              <ul className="inline-list">
                {used.armor.map((a: any) => (
                  <li key={a.id}>
                    <ELink type="armor" id={a.id} es={a.name_es} en={a.name_en} sub={a.type} rarity={a.rarity} />{" "}
                    <span className="muted small">
                      {ARMOR_TYPE[a.type]} · ×{a.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {used.weapons.length > 0 && (
            <>
              <h3 className="sub">Armas ({used.weapons.length})</h3>
              <ul className="inline-list">
                {used.weapons.map((w: any, i: number) => (
                  <li key={i}>
                    <ELink type="weapon" id={w.id} es={w.name_es} en={w.name_en} sub={w.weapon_type} rarity={w.rarity} />{" "}
                    <span className="muted small">
                      {WEAPON_TYPE[w.weapon_type]} · {w.recipe_type === "Create" ? "fabricar" : "mejorar"} · ×{w.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {used.charms.length > 0 && (
            <>
              <h3 className="sub">Amuletos</h3>
              <ul className="inline-list">
                {used.charms.map((c: any, i: number) => (
                  <li key={i}>
                    <ELink type="charm" id={c.id} es={c.name_es} en={c.name_en} rarity={c.rarity} />{" "}
                    <span className="muted small">×{c.quantity}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {used.combinations.length > 0 && (
            <>
              <h3 className="sub">Combinaciones</h3>
              <ul className="inline-list">
                {used.combinations.map((c: any, i: number) => (
                  <li key={i}>
                    <ELink type="item" id={c.result_id} es={c.result_es} en={c.result_en} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
      <Guides guides={it.guides} />
    </article>
  );
}

function BestSources({ item }: { item: any }) {
  const picks: { label: string; detail: string; pct?: number; to: string }[] = [];
  for (const m of item.sources.monsters.slice(0, 3)) {
    picks.push({
      label: m.monster_es || m.monster_en,
      detail: `${RANK_LABEL[m.best.rank] ?? ""} · ${m.best.condition_es}`,
      pct: m.best.percentage,
      to: `/monstruos/${m.monster_id}`,
    });
  }
  const g = [...item.sources.gathering].sort((a: any, b: any) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
  if (g) {
    picks.push({
      label: `${g.location_es || g.location_en}, área ${g.area ?? "?"}`,
      detail: `Recolección${g.rank ? ` · ${RANK_LABEL[g.rank]}` : ""}`,
      pct: g.percentage,
      to: `/mapas/${g.location_id}#area-${g.area}`,
    });
  }
  if (!picks.length) return null;
  return (
    <div className="best">
      <h2 className="best__title">Lo más rápido</h2>
      <div className="best__row">
        {picks.map((p, i) => (
          <Link key={i} to={p.to} className="best__card">
            <span className="best__label">{p.label}</span>
            <span className="muted small">{p.detail}</span>
            <Pct value={p.pct} />
          </Link>
        ))}
      </div>
    </div>
  );
}
