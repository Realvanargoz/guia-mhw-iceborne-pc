/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { EntityIcon } from "../components/Icon";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../api";
import { ELink, ErrorBox, Loading, Name, Pct, Rarity, RankBadge, Section } from "../components/ui";
import { usePageTitle } from "../usePageTitle";
import { ARMOR_TYPE, ELEMENT_ES, WEAPON_TYPE } from "../labels";

export function WeaponList() {
  const [type, setType] = useState("great-sword");
  const { data, error, loading } = useApi<any[]>(`/weapons?weapon_type=${type}`);
  return (
    <div>
      <h1 className="page-title">Armas</h1>
      <div className="chips">
        {Object.entries(WEAPON_TYPE).map(([k, l]) => (
          <button key={k} className={k === type ? "chip chip--on" : "chip"} onClick={() => setType(k)}>
            {l}
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      <ul className="grid-list">
        {(data ?? []).map((w) => (
          <li key={w.id}>
            <Link to={`/armas/${w.id}`} className="grid-list__a">
              <EntityIcon type="weapon" sub={w.weapon_type} rarity={w.rarity} size="md" />
              <Rarity value={w.rarity} />
              <Name es={w.name_es} en={w.name_en} />
              <span className="muted small">
                {w.attack}
                {w.element1 ? ` · ${ELEMENT_ES[w.element1] ?? w.element1} ${w.element1_attack}` : ""}
                {w.category ? ` · ${w.category}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeaponPage() {
  const { id } = useParams();
  const { data: w, error, loading } = useApi<any>(`/weapons/${id}`);
  usePageTitle(w ? w.name_es || w.name_en : null);
  if (loading && !w) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!w) return null;
  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <EntityIcon type="weapon" sub={w.weapon_type} rarity={w.rarity} size="xl" />
          <Name as="h1" es={w.name_es} en={w.name_en} />
        </div>
        <div className="ehead__meta">
          <span className="badge">{WEAPON_TYPE[w.weapon_type]}</span>
          <Rarity value={w.rarity} />
          <span className="badge">Ataque {w.attack}</span>
          {w.affinity ? <span className="badge">Afinidad {w.affinity}%</span> : null}
          {w.element1 && (
            <span className="badge">
              {w.element_hidden ? "(oculto) " : ""}
              {ELEMENT_ES[w.element1] ?? w.element1} {w.element1_attack}
            </span>
          )}
          {w.category && <span className="badge">{w.category === "Kulve" ? "Kulve Taroth" : "Safi'jiiva"}</span>}
        </div>
      </header>
      {w.category && (
        <p className="lead small">
          {w.category === "Kulve"
            ? "Arma de Kulve Taroth: se obtiene como recompensa aleatoria del asedio, no se fabrica."
            : "Arma de Safi'jiiva: se forja/despierta con materiales del asedio de Safi'jiiva."}
        </p>
      )}
      <Section title="Materiales">
        {w.recipe.length ? (
          <ul className="recipe">
            {w.recipe.map((r: any, i: number) => (
              <li key={i}>
                <span className="badge">{r.type === "Create" ? "Fabricar" : "Mejorar"}</span>
                <ELink type="item" id={r.item_id} es={r.name_es} en={r.name_en} />
                <span className="muted">×{r.quantity}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sin receta en la base de datos.</p>
        )}
      </Section>
      <Section title="Árbol de mejora">
        <ol className="tree">
          {w.tree.map((t: any) => (
            <li key={t.id} className={t.id === w.id ? "tree__on" : ""}>
              <ELink type="weapon" id={t.id} es={t.name_es} en={t.name_en} sub={w.weapon_type} rarity={t.rarity} /> <Rarity value={t.rarity} />
            </li>
          ))}
        </ol>
        {w.upgrades.length > 0 && (
          <>
            <h3 className="sub">Se mejora a</h3>
            <ul className="inline-list">
              {w.upgrades.map((u: any) => (
                <li key={u.id}>
                  <ELink type="weapon" id={u.id} es={u.name_es} en={u.name_en} sub={w.weapon_type} rarity={u.rarity} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </article>
  );
}

export function SkillPage() {
  const { id } = useParams();
  const { data: s, error, loading } = useApi<any>(`/skills/${id}`);
  usePageTitle(s ? s.name_es || s.name_en : null);
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!s) return null;
  return (
    <article>
      <header className="ehead">
        <Name as="h1" es={s.name_es} en={s.name_en} />
        <div className="ehead__meta">{s.max_level && <span className="badge">Nivel máx. {s.max_level}</span>}</div>
      </header>
      {(s.description_es || s.description_en) && <p className="lead">{s.description_es || s.description_en}</p>}
      <Section title="Niveles">
        <ul className="rows">
          {s.levels.map((l: any) => (
            <li key={l.level}>
              <span className="badge">Nv{l.level}</span>
              <span>{l.description_es || l.description_en}</span>
            </li>
          ))}
        </ul>
      </Section>
      {s.decorations.length > 0 && (
        <Section title="Adornos">
          <ul className="inline-list">
            {s.decorations.map((d: any) => (
              <li key={d.id}>
                <ELink type="decoration" id={d.id} es={d.name_es} en={d.name_en} /> <Rarity value={d.rarity} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.charms.length > 0 && (
        <Section title="Amuletos">
          <ul className="inline-list">
            {s.charms.map((c: any) => (
              <li key={c.id}>
                <ELink type="charm" id={c.id} es={c.name_es} en={c.name_en} rarity={c.rarity} /> <span className="muted">Nv{c.level}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.set_bonuses.length > 0 && (
        <Section title="Bonus de set">
          <ul className="inline-list">
            {s.set_bonuses.map((b: any) => (
              <li key={b.id}>
                <Name es={b.name_es} en={b.name_en} /> <span className="muted">({b.required} piezas)</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.armor.length > 0 && (
        <Section title="Armaduras con esta habilidad">
          <ul className="inline-list">
            {s.armor.map((a: any) => (
              <li key={a.id}>
                <ELink type="armor" id={a.id} es={a.name_es} en={a.name_en} sub={a.type} rarity={a.rarity} />{" "}
                <span className="muted small">
                  {ARMOR_TYPE[a.type]} · Nv{a.level}
                </span>{" "}
                <RankBadge rank={a.rank} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

export function DecorationPage() {
  const { id } = useParams();
  const { data: d, error, loading } = useApi<any>(`/decorations/${id}`);
  usePageTitle(d ? d.name_es || d.name_en : null);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!d) return null;
  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <EntityIcon type="decoration" id={d.id} size="xl" alt={d.name_es || d.name_en} />
          <Name as="h1" es={d.name_es} en={d.name_en} />
        </div>
        <div className="ehead__meta">
          <span className="badge">Ranura {d.slot}</span>
          <Rarity value={d.rarity} />
        </div>
      </header>
      <Section title="Habilidades">
        {d.skills.map((s: any) => (
          <div key={s.skill_id}>
            <ELink type="skill" id={s.skill_id} es={s.name_es} en={s.name_en} /> <span className="muted">Nv{s.level}</span>
          </div>
        ))}
      </Section>
      <Section title="Cómo conseguirlo">
        <p>
          Los adornos son recompensas aleatorias: salen de misiones e investigaciones, de las Feystones (que se tasan en la
          Herrería) y, en Iceborne, se pueden fundir en el Melding Pot. Consulta la guía de adornos para ver las mejores
          misiones.
        </p>
        {d.droprates.length > 0 && (
          <>
            <h3 className="sub">Probabilidad por tipo de Feystone (rareza {d.rarity})</h3>
            <ul className="rows">
              {d.droprates.map((r: any) => (
                <li key={r.feystone}>
                  <span style={{ textTransform: "capitalize" }}>{r.feystone}</span>
                  <Pct value={r.percentage} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </article>
  );
}

export function CharmPage() {
  const { id } = useParams();
  const { data: c, error, loading } = useApi<any>(`/charms/${id}`);
  usePageTitle(c ? c.name_es || c.name_en : null);
  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!c) return null;
  return (
    <article>
      <header className="ehead">
        <div className="iconrow iconrow--h1">
          <EntityIcon type="charm" rarity={c.rarity} size="xl" />
          <Name as="h1" es={c.name_es} en={c.name_en} />
        </div>
        <div className="ehead__meta">
          <Rarity value={c.rarity} />
          {c.previous && <ELink type="charm" id={c.previous.id} es={c.previous.name_es} en={c.previous.name_en} />}
        </div>
      </header>
      <Section title="Habilidades">
        {c.skills.map((s: any) => (
          <div key={s.skill_id}>
            <ELink type="skill" id={s.skill_id} es={s.name_es} en={s.name_en} /> <span className="muted">Nv{s.level}</span>
          </div>
        ))}
      </Section>
      <Section title="Materiales">
        <ul className="recipe">
          {c.recipe.map((r: any, i: number) => (
            <li key={i}>
              <span className="badge">{r.type === "Create" ? "Fabricar" : "Mejorar"}</span>
              <ELink type="item" id={r.item_id} es={r.name_es} en={r.name_en} />
              <span className="muted">×{r.quantity}</span>
            </li>
          ))}
        </ul>
      </Section>
    </article>
  );
}
