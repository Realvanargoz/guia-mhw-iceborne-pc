import { KeyboardEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getJson, useApi } from "../api";
import { Book, BookTabs, Crown, Page, RankSelector, ResearchBar, Stars, TabPanel } from "../components/book";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading, Name, OrnateHeader } from "../components/ui";
import { CONDITION_ES, DAMAGE_ES, BOOK_ELEMENT_ES, RANK_LABEL, REWARD_SECTION_ES, BOOK_STATUS_ES, ecologyEs, partEs } from "../labels";
import BestiaryGear from "./BestiaryGear";
import "../bestiary.css";

/* ---------------------------------------------------------------- types */
type ListRow = { id: number; name_es: string | null; name_en: string; ecology_en: string | null; has_ranks: string[] };
type RItem = { item_id: number; name_es: string | null; name_en: string; stack: number; percentage: number; stars: number };
type RGroup = { condition_es: string | null; condition_en: string; kind: string; section: string; items: RItem[] };
type Detail = {
  id: number;
  name_es: string | null;
  name_en: string;
  ecology: {
    class_en: string | null;
    description_es: string | null;
    habitats: { location_id: number; name_es: string | null; name_en: string; move_area?: string | null; rest_area?: string | null }[];
  };
  physiology: {
    weak_points: { damage: string; value: number; stars: number; part_en: string }[];
    breakable_parts: { part_en: string; flinch: number | null; wound: number | null; sever: number | null; extract: string | null }[];
    elements: Record<string, number>;
    statuses: Record<string, number>;
  };
  rewards: Record<string, RGroup[]>;
};
type Stat = {
  hunted: number;
  captured: number;
  research_level: number;
  largest_size: number | null;
  smallest_size: number | null;
  crown?: { gold?: boolean; silver?: boolean; mini?: boolean } | null;
};
type ProfileBulk = { data?: { slots?: { monsters?: (Stat & { name_en: string })[] }[] } };

const TABS = [
  { id: "ecologia", label: "Ecología" },
  { id: "fisiologia", label: "Fisiología" },
  { id: "recompensas", label: "Recompensas" },
  { id: "equipo", label: "Equipo" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const RANK_ORDER = ["LR", "HR", "MR"];

/* ---------------------------------------------------------------- bits */
/** Icon slot at game proportions: /icons/monsters/{id}.webp, else a tidy paw/letter placeholder. */
export function MonsterIcon({ id, name, size = 56 }: { id: number; name: string; size?: number }) {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    setOk(true);
  }, [id]);
  return (
    <span className="micon" style={{ width: size, height: size }} aria-hidden>
      {ok ? (
        <img src={`/icons/monsters/${id}.webp`} alt="" loading="lazy" onError={() => setOk(false)} />
      ) : (
        <span className="micon__ph">
          <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5}>
            <ellipse cx="12" cy="16" rx="5" ry="4.2" />
            <ellipse cx="5.5" cy="11" rx="2" ry="2.6" />
            <ellipse cx="9.5" cy="6.8" rx="2" ry="2.8" />
            <ellipse cx="14.5" cy="6.8" rx="2" ry="2.8" />
            <ellipse cx="18.5" cy="11" rx="2" ry="2.6" />
          </svg>
          <b>{name.charAt(0)}</b>
        </span>
      )}
    </span>
  );
}

/** Game weak-point badges are per damage type; show the weapon family icon. */
const DAMAGE_ICON: Record<string, string> = { cut: "weapon-great-sword", impact: "weapon-hammer", shot: "weapon-light-bowgun" };

const EXTRACT_ES: Record<string, string> = { red: "rojo", orange: "naranja", white: "blanco", green: "verde" };

const fmt = (n?: number | null) => (n == null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bst__stat">
      <span className="bst__statl">{label}</span>
      <span className="bst__statv">{children}</span>
    </div>
  );
}

function ItemRows({ items }: { items: RItem[] }) {
  return (
    <ul className="bst__items">
      {items.map((it, i) => (
        <li key={`${it.item_id}-${i}`}>
          <Link to={`/objetos/${it.item_id}`} className="bst__item">
            <Icon kind="item" id={it.item_id} size="sm" />
            <Name es={it.name_es} en={it.name_en} />
            {it.stack > 1 && <span className="bst__stack">×{it.stack}</span>}
          </Link>
          <span className="bst__freq" title={`${it.percentage}%`}>
            <Stars n={it.stars} max={5} size={13} label={`Frecuencia ${it.stars} de 5 (${it.percentage}%)`} />
            <span className="bst__pct" aria-hidden>{it.percentage}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ title, items }: { title: string; items: RItem[] }) {
  return (
    <div className="bst__callout">
      <OrnateHeader as="h3" className="ohead--sm">
        {title}
      </OrnateHeader>
      <ItemRows items={items} />
    </div>
  );
}

function FreqTable({ title, items }: { title: string; items: RItem[] }) {
  return (
    <div className="bst__table">
      <div className="bst__thead">
        <span>{title}</span>
        <span>Frecuencia</span>
      </div>
      <ItemRows items={items} />
    </div>
  );
}

/* ---------------------------------------------------------------- tabs */
function Ecology({ d, stat, noProfile }: { d: Detail; stat?: Stat | null; noProfile: boolean }) {
  const cr = stat?.crown;
  const maxCrown = cr?.gold ? "gold" : cr?.silver ? "silver" : null;
  return (
    <Book>
      <Page className="bst__left">
        <div className="bst__title">
          <span className="bst__class">{ecologyEs(d.ecology.class_en)}</span>
          <h2>{d.name_es || d.name_en}</h2>
          {d.name_es && d.name_es !== d.name_en && <em>{d.name_en}</em>}
        </div>
        <div className="bst__art">
          <MonsterIcon id={d.id} name={d.name_es || d.name_en} size={256} />
        </div>
        <div className="bst__stats">
          <Row label="Cazados (Capturados)">{stat ? `${stat.hunted} (${stat.captured})` : "—"}</Row>
          <div className="bst__sizes">
            <Row label="Tamaño mín.">
              {cr?.mini && <Crown kind="mini" size={20} />} <span className="bst__size bst__size--min">{fmt(stat?.smallest_size)}</span>
            </Row>
            <Row label="Tamaño máx.">
              {maxCrown && <Crown kind={maxCrown} size={20} />} <span className="bst__size bst__size--max">{fmt(stat?.largest_size)}</span>
            </Row>
          </div>
          {noProfile && <p className="bst__hint">Sin datos de partida: actualiza el perfil desde el inicio para ver tus cifras.</p>}
        </div>
        <OrnateHeader as="h3" className="ohead--sm">
          Características
        </OrnateHeader>
        <p className="bst__desc">{d.ecology.description_es || "Sin descripción."}</p>
      </Page>
      <Page className="bst__right">
        <OrnateHeader as="h3" className="ohead--sm">
          Hábitats
        </OrnateHeader>
        <ul className="bst__habs">
          {d.ecology.habitats.length === 0 && <li className="muted">Sin hábitats registrados.</li>}
          {d.ecology.habitats.map((h) => (
            <li key={h.location_id}>
              <Link to={`/mapas/${h.location_id}`}>{h.name_es || h.name_en}</Link>
              {h.rest_area && <small>Descanso: zona {h.rest_area}</small>}
            </li>
          ))}
        </ul>
        <OrnateHeader as="h3" className="ohead--sm">
          Notas
        </OrnateHeader>
        <p className="bst__desc">
          Zonas de golpe detalladas, roturas y misiones en la{" "}
          <Link to={`/monstruos/${d.id}`} className="bst__more">
            ficha completa
          </Link>
          .
        </p>
      </Page>
    </Book>
  );
}

function Physiology({ d }: { d: Detail }) {
  const { weak_points: wp, breakable_parts: bp, elements, statuses } = d.physiology;
  return (
    <Book>
      <Page className="bst__left">
        <div className="bst__title">
          <span className="bst__class">{ecologyEs(d.ecology.class_en)}</span>
          <h2>{d.name_es || d.name_en}</h2>
        </div>
        <OrnateHeader as="h3" className="ohead--sm">
          Punto débil
        </OrnateHeader>
        {wp.length > 0 ? (
          <div className="bst__weak">
            {wp.map((w) => (
              <div key={w.damage} className="bst__badge">
                <span className="bst__badgeic" data-k={w.damage}>
                  <Icon kind="ui" name={DAMAGE_ICON[w.damage]} size="sm" />
                  {DAMAGE_ES[w.damage] ?? w.damage}
                </span>
                <Stars n={w.stars} size={18} />
                <span className="bst__badgepart">{partEs(w.part_en)}</span>
                <small>{w.value}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="bst__hint">Sin zonas de golpe registradas.</p>
        )}
        <OrnateHeader as="h3" className="ohead--sm">
          Rompible
        </OrnateHeader>
        {bp.length === 0 ? (
          <p className="bst__hint">Sin partes rompibles registradas.</p>
        ) : (
          <ul className="bst__breaks">
            {bp.map((b, i) => (
              <li key={i}>
                <b>{partEs(b.part_en)}</b>
                <span>
                  {b.flinch != null && <>Retroceso {b.flinch} </>}
                  {b.wound != null && <>· Herida {b.wound} </>}
                  {b.sever != null && <>· Corte {b.sever}</>}
                </span>
                {b.extract ? (
                  <i className={`bst__ext bst__ext--${b.extract}`} role="img" title={`Extracto ${EXTRACT_ES[b.extract] ?? b.extract}`} aria-label={`Extracto ${EXTRACT_ES[b.extract] ?? b.extract}`} />
                ) : (
                  <i />
                )}
              </li>
            ))}
          </ul>
        )}
      </Page>
      <Page className="bst__right">
        <OrnateHeader as="h3" className="ohead--sm">
          Elementos
        </OrnateHeader>
        <table className="bst__tab">
          <tbody>
            {Object.keys(BOOK_ELEMENT_ES).map((k) => (
              <tr key={k}>
                <th>
                  <span className="bst__lbl">
                    <Icon kind="ui" name={`element-${k}`} size="md" />
                    {BOOK_ELEMENT_ES[k]}
                  </span>
                </th>
                <td>
                  <Stars n={elements[k] ?? 0} max={3} size={18} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <OrnateHeader as="h3" className="ohead--sm">
          Estados alterados
        </OrnateHeader>
        <table className="bst__tab">
          <tbody>
            {Object.keys(BOOK_STATUS_ES).map((k) => (
              <tr key={k}>
                <th>
                  <span className="bst__lbl">
                    <Icon kind="ui" name={`status-${k}`} size="md" />
                    {BOOK_STATUS_ES[k]}
                  </span>
                </th>
                <td>
                  <Stars n={statuses[k] ?? 0} max={3} size={18} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Page>
    </Book>
  );
}

function groupLabel(g: RGroup) {
  return CONDITION_ES[g.condition_en] ?? g.condition_es ?? REWARD_SECTION_ES[g.section] ?? g.condition_en;
}
function brokenTitle(g: RGroup) {
  const m = g.condition_en.match(/^(?:Wound|Break)\s+(.+)$/);
  if (!m) return g.condition_es ?? g.condition_en;
  return `${partEs(m[1])} (${g.condition_en.startsWith("Break") ? "partido" : "roto"})`;
}

function Rewards({ d, ranks }: { d: Detail; ranks: string[] }) {
  const [sp, setSp] = useSearchParams();
  const wanted = sp.get("rank");
  const rank = wanted && ranks.includes(wanted) ? wanted : ranks[ranks.length - 1];
  const groups = d.rewards[rank] ?? [];
  const bySection = (s: string) => groups.filter((g) => g.section === s);
  const carved = bySection("carved").filter((g) => g.condition_en !== "Tail Carve");
  const tail = bySection("carved").filter((g) => g.condition_en === "Tail Carve");
  const dropped = bySection("dropped");
  const broken = bySection("broken");
  const rewards = bySection("rewards");
  const other = bySection("other");
  const setRank = (r: string) => {
    const n = new URLSearchParams(sp);
    n.set("rank", r);
    setSp(n, { replace: true });
  };
  const carvedItems = carved.flatMap((g) => g.items);
  return (
    <Book>
      <Page className="bst__left">
        <div className="bst__title">
          <h2>{d.name_es || d.name_en}</h2>
        </div>
        {dropped.map((g, i) => (
          <Callout key={`d${i}`} title="Material caído" items={g.items} />
        ))}
        {broken.length === 0 && dropped.length === 0 && tail.length === 0 && (
          <p className="bst__hint">Sin partes rompibles con recompensa en este rango.</p>
        )}
        <div className="bst__callouts">
          {broken.map((g, i) => (
            <Callout key={`b${i}`} title={brokenTitle(g)} items={g.items} />
          ))}
          {tail.map((g, i) => (
            <Callout key={`t${i}`} title="Cola: cortable" items={g.items} />
          ))}
        </div>
      </Page>
      <Page className="bst__right">
        <div className="bst__rank">
          <RankSelector
            ranks={ranks.map((r) => ({ id: r, label: RANK_LABEL[r] ?? r }))}
            value={rank}
            onChange={setRank}
          />
        </div>
        {carvedItems.length > 0 && <FreqTable title="Cortados" items={carvedItems} />}
        {rewards.map((g, i) => (
          <FreqTable key={i} title={rewards.length > 1 ? groupLabel(g) : "Recompensas"} items={g.items} />
        ))}
        {other.length > 0 && (
          <details className="bst__other">
            <summary>Otras fuentes ({other.length})</summary>
            {other.map((g, i) => (
              <FreqTable key={i} title={groupLabel(g)} items={g.items} />
            ))}
          </details>
        )}
        {carvedItems.length === 0 && rewards.length === 0 && <p className="bst__hint">Sin recompensas registradas en este rango.</p>}
      </Page>
    </Book>
  );
}

/* ---------------------------------------------------------------- page */
export default function Bestiary() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const list = useApi<ListRow[]>("/bestiary");
  const bulk = useApi<ProfileBulk>("/profile");
  const selId = id ? Number(id) : undefined;
  const detail = useApi<Detail>(selId ? `/bestiary/${selId}` : null);
  const [stat, setStat] = useState<Stat | null>(null);
  const [statLoaded, setStatLoaded] = useState(false);

  const tabParam = sp.get("tab");
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "ecologia";
  const setTab = (t: TabId) => {
    const n = new URLSearchParams(sp);
    n.set("tab", t);
    setSp(n, { replace: true });
  };

  // default selection
  useEffect(() => {
    if (!id && list.data?.length) nav(`/bestiario/${list.data[0].id}${sp.toString() ? `?${sp}` : ""}`, { replace: true });
  }, [id, list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // per-monster stats (404 -> no data)
  useEffect(() => {
    if (!selId) return;
    const ctrl = new AbortController();
    setStatLoaded(false);
    getJson<Stat | null>(`/profile/monster/${selId}`, ctrl.signal)
      .then((s) => setStat(s && typeof s === "object" ? s : null))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setStat(null);
      })
      .finally(() => setStatLoaded(true));
    return () => ctrl.abort();
  }, [selId]);

  const levels = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of bulk.data?.data?.slots?.[0]?.monsters ?? []) if (x.research_level != null) m.set(x.name_en, x.research_level);
    return m;
  }, [bulk.data]);

  const rows = list.data ?? [];
  const shown = rows.filter((r) => {
    const t = q.trim().toLowerCase();
    return !t || (r.name_es ?? "").toLowerCase().includes(t) || r.name_en.toLowerCase().includes(t);
  });
  const qs = sp.toString() ? `?${sp}` : "";
  const go = (rid: number) => nav(`/bestiario/${rid}${qs}`);

  // Up/Down move the selection only while focus is inside the monster list (never hijacks page scrolling)
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const el = e.target as HTMLElement;
    if (el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
    if (!shown.length) return;
    const i = shown.findIndex((r) => r.id === selId);
    const n = e.key === "ArrowDown" ? Math.min(shown.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    e.preventDefault();
    if (shown[n].id !== selId) {
      go(shown[n].id);
      if (el.tagName === "A") document.getElementById(`bst-row-${shown[n].id}`)?.focus();
    }
  };

  const selRef = useRef<HTMLLIElement | null>(null);
  const uid = useId();
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [selId, list.data]);

  const d = detail.data && detail.data.id === selId ? detail.data : undefined;
  const ranks = d ? RANK_ORDER.filter((r) => (d.rewards[r]?.length ?? 0) > 0) : [];
  const noProfile = statLoaded && !stat;

  return (
    <div className="bstwrap">
      <div className="bst">
        <aside className="bst__list" onKeyDown={onListKey}>
          <OrnateHeader as="h1" className="ohead--red">
            Bestiario monstr. grandes
          </OrnateHeader>
          <input
            className="bst__filter"
            type="search"
            placeholder="Filtrar monstruos…"
            aria-label="Filtrar monstruos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="bst__select" aria-label="Monstruo" value={selId ?? ""} onChange={(e) => go(Number(e.target.value))}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name_es || r.name_en}
              </option>
            ))}
          </select>
          {list.loading && !list.data && <Loading />}
          {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
          <nav aria-label="Monstruos" className="bst__nav">
            <ul className="bst__rows">
              {shown.map((r) => {
                const on = r.id === selId;
                const lv = levels.get(r.name_en);
                return (
                  <li key={r.id} ref={on ? selRef : undefined} className={on ? "bst__row bst__row--on" : "bst__row"}>
                    <Link id={`bst-row-${r.id}`} to={`/bestiario/${r.id}${qs}`} aria-current={on ? "page" : undefined}>
                      <MonsterIcon id={r.id} name={r.name_es || r.name_en} size={44} />
                      <span className="bst__rowt">
                        <span className="bst__rown">{r.name_es || r.name_en}</span>
                        {lv != null && <ResearchBar level={lv} label="Nv. invest." />}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {list.data && shown.length === 0 && <li className="muted bst__none">Ningún monstruo coincide.</li>}
            </ul>
          </nav>
        </aside>
        <section className="bst__main">
          <BookTabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={setTab} idPrefix={uid} />
          {detail.error && <ErrorBox error={detail.error} onRetry={detail.reload} />}
          {!d && !detail.error && <Loading />}
          {d && (
            <TabPanel prefix={uid} id={tab}>
              {tab === "ecologia" && <Ecology d={d} stat={stat} noProfile={noProfile} />}
              {tab === "fisiologia" && <Physiology d={d} />}
              {tab === "equipo" && <BestiaryGear monsterId={d.id} monsterName={d.name_es || d.name_en} ranks={ranks.length ? ranks : ["HR"]} />}
              {tab === "recompensas" && (ranks.length ? <Rewards d={d} ranks={ranks} /> : <p className="empty">Sin recompensas registradas.</p>)}
            </TabPanel>
          )}
        </section>
      </div>
    </div>
  );
}
