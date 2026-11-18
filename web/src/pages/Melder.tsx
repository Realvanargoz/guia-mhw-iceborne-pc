/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeHref } from "../safeUrl";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../api";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading, Name, Section, Tabs } from "../components/ui";
import "../melder.css";

type Acc = { name_en: string; name_es: string; mp: number };
type MItem = {
  name_en: string;
  name_es: string;
  rp: number;
  mp: number;
  url: string;
  category: string;
  item_id: number | null;
  decoration_id: number | null;
  icon_url: string | null;
  rarity: number | null;
  accepted: Acc[];
  accepted_known: boolean;
  needs_review: boolean;
};
type MIng = { name_en: string; name_es: string; mp: number; item_id: number | null; icon_url: string | null; uses: number };
type Melder = {
  items: MItem[];
  ingredients: MIng[];
  categories: { id: string; name_es: string }[];
  notes_es: string[];
  review_es: string[];
  sources: { title: string; url: string }[];
  retrieved_at: string;
};

const TABS = [
  { id: "objetos", label: "Qué se puede fusionar" },
  { id: "materia", label: "Materia prima (puntos)" },
  { id: "como", label: "Cómo funciona" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Ico({ it }: { it: { item_id: number | null; decoration_id?: number | null } }) {
  if (it.item_id != null) return <Icon kind="item" id={it.item_id} size="md" />;
  if (it.decoration_id != null) return <Icon kind="decoration" id={it.decoration_id} size="md" />;
  return <span className="ml-noicon" aria-hidden />;
}

function Items({ data }: { data: Melder }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"mp" | "rp" | "name">("mp");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const nq = norm(q.trim());
    const r = data.items.filter(
      (i) => (cat === "all" || i.category === cat) && (!nq || norm(i.name_es).includes(nq) || norm(i.name_en).includes(nq)),
    );
    return [...r].sort((a, b) =>
      sort === "name" ? a.name_es.localeCompare(b.name_es, "es") : sort === "rp" ? b.rp - a.rp || b.mp - a.mp : b.mp - a.mp || b.rp - a.rp,
    );
  }, [data, q, cat, sort]);
  return (
    <div>
      <div className="ml-filters">
        <input type="search" placeholder="Buscar objeto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar objeto" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="all">Todas las categorías ({data.items.length})</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_es} ({data.items.filter((i) => i.category === c.id).length})
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenar">
          <option value="mp">Más puntos de fusión primero</option>
          <option value="rp">Más puntos de investigación primero</option>
          <option value="name">Nombre</option>
        </select>
      </div>
      <p className="muted small">
        {rows.length} objetos. «RP» = puntos de investigación que gastas; «MP» = puntos de fusión que reúnes con materia prima. En el
        juego solo ves los que ya tengas desbloqueados.
      </p>
      <ul className="ml-list">
        {rows.map((i) => {
          const isOpen = open === i.name_en;
          const rare = i.category === "gl" || i.category === "tempered";
          return (
            <li key={i.name_en} className="ml-item">
              <button type="button" className="ml-item__head" onClick={() => setOpen(isOpen ? null : i.name_en)} aria-expanded={isOpen}>
                <Ico it={i} />
                <span className="ml-item__name">
                  <Name es={i.name_es} en={i.name_en} />
                  {i.rarity != null && <small className="muted"> · rareza {i.rarity}</small>}
                </span>
                <span className="ml-pts" title="Puntos de investigación">
                  <b>{i.rp}</b> RP
                </span>
                <span className="ml-pts ml-pts--mp" title="Puntos de fusión necesarios">
                  <b>{i.mp}</b> MP
                </span>
              </button>
              {isOpen && (
                <div className="ml-item__body">
                  {i.item_id != null && (
                    <p>
                      <Link to={`/objetos/${i.item_id}`}>Ver ficha del objeto (dónde conseguirlo, usos)</Link>
                    </p>
                  )}
                  {i.accepted_known ? (
                    <>
                      <h4>Materia prima que acepta (puntos que aporta cada una)</h4>
                      <ul className="ml-acc">
                        {i.accepted.slice(0, 80).map((a) => (
                          <li key={a.name_en}>
                            <span>{a.name_es}</span> <small className="muted">{a.name_en}</small> <b>{a.mp} pts</b>
                          </li>
                        ))}
                      </ul>
                      {i.accepted.length > 80 && <p className="muted small">…y {i.accepted.length - 80} más (ver la pestaña «Materia prima»).</p>}
                    </>
                  ) : (
                    <p className="ml-warn">
                      {rare
                        ? "Las fuentes no publican qué materia prima acepta este objeto. En el juego, el Maxifusionador te enseña los materiales raros y Tempered que tengas en el cofre con su valor en puntos. "
                        : "Las fuentes no listan la materia prima de este objeto; el juego te enseña la que tengas en el cofre. "}
                      Necesitas reunir al menos <b>{i.mp} MP</b> y gastar <b>{i.rp} RP</b>.
                    </p>
                  )}
                  <p className="muted small">
                    Fuente:{" "}
                    <a href={safeHref(i.url)} target="_blank" rel="noreferrer noopener">
                      Kiranico
                    </a>
                    {i.needs_review && " · dato por revisar"}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Ingredients({ data }: { data: Melder }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const nq = norm(q.trim());
    const m = new Map<number, MIng[]>();
    for (const i of data.ingredients) {
      if (nq && !norm(i.name_es).includes(nq) && !norm(i.name_en).includes(nq)) continue;
      m.set(i.mp, [...(m.get(i.mp) ?? []), i]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [data, q]);
  return (
    <div>
      <div className="ml-filters">
        <input type="search" placeholder="Buscar materia prima…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar materia prima" />
      </div>
      <p className="muted small">Cuántos puntos de fusión aporta cada objeto que metes en el Maxifusionador.</p>
      {groups.map(([mp, list]) => (
        <Section key={mp} title={`${mp} pts (${list.length})`}>
          <ul className="ml-ings">
            {list.map((i) => (
              <li key={i.name_en}>
                <Ico it={i} />
                <span>
                  <Name es={i.name_es} en={i.name_en} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function How({ data }: { data: Melder }) {
  return (
    <div>
      <Section title="Cómo funciona">
        <ul>
          {data.notes_es.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Section>
      <Section title="Pendiente de confirmar">
        <ul>
          {data.review_es.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Section>
      <p className="muted small">
        Fuentes:{" "}
        {data.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && " · "}
            <a href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>
          </span>
        ))}
        . Datos obtenidos el {data.retrieved_at}.
      </p>
    </div>
  );
}

export default function MelderPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "objetos") as TabId;
  const { data, error, loading } = useApi<Melder>("/melder");
  return (
    <div>
      <h1 className="page-title">Maxifusionador</h1>
      <p className="lead">
        Materiales que se consiguen fusionando: cuánto cuestan en puntos de investigación y de fusión, y cuánta materia prima aporta
        cada objeto. No depende de lo que tengas en el cofre.
      </p>
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={(v) => setSp({ tab: v }, { replace: true })} />
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && tab === "objetos" && <Items data={data} />}
      {data && tab === "materia" && <Ingredients data={data} />}
      {data && tab === "como" && <How data={data} />}
    </div>
  );
}
