/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import { Crown } from "../components/book";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading, ProgressBar, Section, Tabs } from "../components/ui";
import { QUEST_CATEGORY, RANK_LABEL, WEAPON_TYPE } from "../labels";
import { ArmorProfile, NOT_READ, QuestsProfile, ReadHint, fixText, normName } from "../profileData";
import "../stats.css";

const nf = new Intl.NumberFormat("es-ES");
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : "—";
const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES", { dateStyle: "long" }) : "—");
const hours = (s?: number | null) => (s == null ? "—" : `${nf.format(Math.floor(s / 3600))} h ${Math.floor((s % 3600) / 60)} min`);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

const GADGET: Record<string, string> = {
  vigorwasp_spray: "Vigorwasp Spray",
  flashfly_cage: "Flashfly Cage",
  shieldspire: "Shieldspire",
  coral_orchestra: "Coral Orchestra",
  plunderblade: "Plunderblade",
  meowlotov_cocktail: "Meowlotov Cocktail",
};
const SLOTS: [string, string][] = [
  ["weapon", "Arma"],
  ["head", "Cabeza"],
  ["chest", "Torso"],
  ["arms", "Brazos"],
  ["waist", "Cintura"],
  ["legs", "Piernas"],
  ["charm", "Amuleto"],
];
const QCOUNT: Record<string, string> = {
  low_rank: "RB",
  high_rank: "RA",
  master_rank: "RM",
  arena: "arena",
  investigations: "investigaciones",
  guiding_lands: "Tierras Guía",
};
const wtype = (t?: string | null) => (t ?? "").replace(/_/g, "-");
const refPath = (k: string, id: number | string) => (k === "weapon" ? `/armas/${id}` : k === "charm" ? `/amuletos/${id}` : `/armaduras/piezas/${id}`);

type Stats = {
  empty?: boolean;
  snapshot?: { id: number; taken_at: string; source: string };
  hunter?: Record<string, any> | null;
  guild_card?: Record<string, any> | null;
  progress?: { achievements_unlocked?: number[] | null; quest_counts?: Record<string, number> | null; quests_cleared_count?: number | null };
  combat?: {
    large_monsters?: {
      species_hunted: number;
      hunted: number;
      slayed: number;
      captured: number;
      research_maxed: number;
      crowns: { mini: number; silver: number; gold: number };
    };
    monster_log?: { index: number; name_en: string; captured: number; slain: number }[] | null;
    weapon_usage?: Record<string, Record<string, number>> | null;
  };
  investigations?: { count: number; with_tempered?: number; by_monster?: { index: number; name_en: string | null; count: number }[] } | null;
  guiding_lands?: { note?: string; regions?: { index: number; level: number; points: number }[]; max_level?: number } | null;
  palico?: { name?: string; xp?: number; gadget_xp?: Record<string, number> } | null;
  collection?: { decorations_distinct: number; decorations_total: number; charms: number; armor_pieces: number; weapons: number };
  loadouts_count?: number;
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Bar({ label, value, max, icon, num }: { label: ReactNode; value: number; max: number; icon?: ReactNode; num?: string }) {
  return (
    <li className="st-bar">
      <span className="st-bar__label">
        {icon}
        {label}
      </span>
      <span className="st-bar__track" aria-hidden>
        <span className="st-bar__fill" style={{ width: `${pct(value, max)}%` }} />
      </span>
      <span className="st-bar__num">{num ?? nf.format(value)}</span>
    </li>
  );
}

export default function StatsPage() {
  const stats = useApi<Stats>("/profile/stats");
  const armor = useApi<ArmorProfile>("/profile/armor");
  const quests = useApi<QuestsProfile>("/profile/quests");
  const equip = useApi<any>("/profile/equipment");
  const monsters = useApi<any[]>("/monsters");
  const site = useApi<{ counts: Record<string, number> }>("/stats");
  const [wTab, setWTab] = useState("total");
  const [loOpen, setLoOpen] = useState(false);

  const d = stats.data;
  const mById = useMemo(() => {
    const m = new Map<string, any>();
    for (const x of monsters.data ?? []) m.set(normName(x.name_en), x);
    return m;
  }, [monsters.data]);

  const rarityOf = useMemo(() => {
    const m = new Map<string, number>();
    const lists: [string, any[] | undefined][] = [
      ["armor", equip.data?.armor],
      ["weapon", equip.data?.weapons],
      ["charm", equip.data?.charms],
    ];
    for (const [cat, list] of lists) for (const it of list ?? []) m.set(`${cat}:${it.id}`, it.rarity);
    return m;
  }, [equip.data]);

  if (stats.loading && !d) return <Loading />;
  if (stats.error) return <ErrorBox error={stats.error} />;
  if (!d) return null;

  if (d.empty) {
    return (
      <div className="stats">
        <h1 className="page-title">Estadísticas del cazador</h1>
        <div className="st-empty">
          <p>{NOT_READ}</p>
          <Link className="btn" to="/#perfil">
            Ir al perfil del cazador
          </Link>
        </div>
      </div>
    );
  }

  const h = d.hunter ?? {};
  const gc = d.guild_card;
  const lm = d.combat?.large_monsters;
  const wu = d.combat?.weapon_usage;
  const ach = d.progress?.achievements_unlocked;
  const achTotal = site.data?.counts?.achievements ?? 100;
  const q = quests.data;
  const a = armor.data && armor.data.available !== false && !armor.data.empty ? armor.data : null;
  const inv = d.investigations;
  const gl = d.guiding_lands;
  const pal = d.palico;
  const col = d.collection;

  const log = (d.combat?.monster_log ?? [])
    .map((m) => ({ ...m, hit: mById.get(normName(m.name_en)), total: m.slain + m.captured }))
    .filter((m) => m.hit && m.total > 0)
    .sort((x, y) => y.total - x.total)
    .slice(0, 10);

  const wuKeys: [string, string][] = [
    ["total", "Total"],
    ["low_rank", "RB"],
    ["high_rank", "RA"],
    ["master_rank", "RM"],
    ["investigations", "Investig."],
    ["guiding_lands", "T. Guía"],
  ];
  const wRows = Object.entries(wu?.[wTab] ?? {})
    .map(([k, v]) => [wtype(k), v] as [string, number])
    .sort((x, y) => y[1] - x[1]);
  const wMax = Math.max(1, ...wRows.map((r) => r[1]));

  const cur = equip.data?.available ? equip.data.current ?? {} : null;
  const slotItem = (ref: any, key: string) => {
    if (!ref) return <span className="muted">Vacío</span>;
    const name = fixText(ref.name_es || ref.name_en);
    const r = rarityOf.get(`${ref.category}:${ref.id}`);
    const icon =
      key === "weapon" ? (
        r != null ? <Icon kind="equip" type={wtype(ref.type)} rarity={r} size="md" /> : <Icon kind="ui" name={`weapon-${wtype(ref.type)}`} tile size="md" />
      ) : r != null ? (
        <Icon kind="equip" type={key} rarity={r} size="md" />
      ) : (
        <Icon kind="ui" name={`armor-${key}`} tile size="md" />
      );
    return ref.id != null ? (
      <Link to={refPath(key, ref.id)} className="st-slot__item">
        {icon}
        <span>{name}</span>
      </Link>
    ) : (
      <span className="st-slot__item">
        {icon}
        <span>{name}</span>
      </span>
    );
  };

  return (
    <div className="stats">
      <h1 className="page-title">Estadísticas del cazador</h1>
      <p className="muted small">
        Todo lo que se ha leído de tu partida{d.snapshot ? ` (última lectura: ${fmtDate(d.snapshot.taken_at)})` : ""}. Se actualiza solo cuando tú pulsas
        «Actualizar perfil» en <Link to="/#perfil">Inicio</Link>; esta página nunca lee la partida por su cuenta.
      </p>

      <Section title="Cazador">
        <dl className="st-facts">
          <Fact label="Nombre">{h.name || "—"}</Fact>
          <Fact label="Rango de cazador">RC {h.hr ?? "—"}</Fact>
          <Fact label="Rango maestro">RM {h.mr ?? "—"}</Fact>
          <Fact label="Zenis">{h.zenny != null ? `${nf.format(h.zenny)} z` : "—"}</Fact>
          <Fact label="Puntos de investigación">{h.research_points != null ? nf.format(h.research_points) : "—"}</Fact>
          <Fact label="Tiempo de juego">{hours(h.playtime_seconds)}</Fact>
          {h.hr_xp != null && <Fact label="XP de RC">{nf.format(h.hr_xp)}</Fact>}
          {h.mr_xp != null && <Fact label="XP de RM">{nf.format(h.mr_xp)}</Fact>}
        </dl>
        {gc ? (
          <div className="st-card">
            <h3>Tarjeta del gremio</h3>
            <dl className="st-facts st-facts--tight">
              <Fact label="Título">{gc.title || "—"}</Fact>
              <Fact label="Escuadrón">{gc.squad || "—"}</Fact>
              <Fact label="Creada">{fmtDay(gc.created_at)}</Fact>
            </dl>
            {gc.greeting && <blockquote className="st-quote">«{gc.greeting}»</blockquote>}
          </div>
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Progreso">
        <div className="st-grid">
          <div className="st-card">
            <h3>Logros de Steam</h3>
            {ach ? (
              <>
                <ProgressBar done={ach.length} total={achTotal} label="Desbloqueados" />
                <p className="small">
                  <Link to="/logros">Ver la lista de logros</Link>
                </p>
              </>
            ) : (
              <ReadHint />
            )}
          </div>
          <div className="st-card">
            <h3>Misiones completadas</h3>
            {q?.per_quest_available ? (
              <>
                <ProgressBar done={q.cleared_count} total={q.catalog_total} label="Catálogo de la guía" />
                <ul className="st-bars">
                  {Object.entries(q.by_category).map(([k, b]) => (
                    <Bar key={k} label={QUEST_CATEGORY[k] ?? k} value={b.cleared} max={b.total} num={`${b.cleared}/${b.total} · ${pct(b.cleared, b.total)}%`} />
                  ))}
                </ul>
                <p className="muted small">
                  Eventos y desafíos no se pueden deducir bien de la partida y el catálogo solo los lista en parte: esos porcentajes son orientativos.{" "}
                  <Link to="/misiones">Ver misiones</Link>
                </p>
              </>
            ) : q ? (
              <>
                {q.total_cleared != null && (
                  <p>
                    Total registrado en la partida: <b>{nf.format(q.total_cleared)}</b>
                  </p>
                )}
                <ReadHint text="El detalle por misión no está leído aún. Pulsa Actualizar perfil para leer este dato." />
              </>
            ) : (
              <Loading />
            )}
            {d.progress?.quest_counts && (
              <p className="muted small st-counts">
                Según el contador del juego:{" "}
                {Object.entries(d.progress.quest_counts)
                  .map(([k, v]) => `${QCOUNT[k] ?? k} ${v}`)
                  .join(" · ")}
              </p>
            )}
          </div>
          <div className="st-card">
            <h3>Armaduras</h3>
            {a ? (
              <>
                <ProgressBar done={a.pieces_owned} total={a.pieces_total} label="Piezas en el cofre" />
                <ProgressBar done={a.sets_complete} total={a.sets_total} label="Sets completos" />
                <ul className="st-bars">
                  {["LR", "HR", "MR"].map((r) => {
                    const b = a.by_rank[r];
                    return b ? <Bar key={r} label={RANK_LABEL[r]} value={b.pieces_owned} max={b.pieces_total} num={`${b.pieces_owned}/${b.pieces_total} · ${b.percent}%`} /> : null;
                  })}
                </ul>
                <p className="muted small">
                  Cuenta las piezas que hay ahora en tu cofre de equipo (las vendidas o fundidas no cuentan). <Link to="/armaduras">Ver sets</Link>
                </p>
              </>
            ) : armor.loading ? (
              <Loading />
            ) : (
              <ReadHint />
            )}
          </div>
          <div className="st-card">
            <h3>Monstruos y coronas</h3>
            {lm ? (
              <>
                <p>
                  <b>{lm.species_hunted}</b> especies grandes cazadas · <b>{lm.research_maxed}</b> con investigación al máximo
                </p>
                <div className="st-crowns">
                  {(["mini", "silver", "gold"] as const).map((k) => (
                    <span key={k} className="st-crown">
                      <Crown kind={k} size={32} />
                      <b>{lm.crowns[k]}</b>
                      <span className="muted small">{{ mini: "mini", silver: "plata", gold: "oro" }[k]}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <ReadHint />
            )}
          </div>
        </div>
      </Section>

      <Section title="Combate">
        {lm ? (
          <>
            <dl className="st-facts">
              <Fact label="Cazas totales">{nf.format(lm.hunted)}</Fact>
              <Fact label="Abatidos">{nf.format(lm.slayed)}</Fact>
              <Fact label="Capturados">{nf.format(lm.captured)}</Fact>
              <Fact label="Especies cazadas">{lm.species_hunted}</Fact>
            </dl>
            <ul className="st-bars" aria-label="Abatidos frente a capturas">
              <Bar label="Abatidos" value={lm.slayed} max={lm.hunted} num={`${nf.format(lm.slayed)} · ${pct(lm.slayed, lm.hunted)}%`} />
              <Bar label="Capturados" value={lm.captured} max={lm.hunted} num={`${nf.format(lm.captured)} · ${pct(lm.captured, lm.hunted)}%`} />
            </ul>
          </>
        ) : (
          <ReadHint />
        )}
        <h3 className="st-h3">Uso de armas</h3>
        {wu ? (
          <>
            <Tabs tabs={wuKeys.filter(([k]) => wu[k]).map(([id, label]) => ({ id, label }))} value={wTab} onChange={setWTab} />
            <ul className="st-bars">
              {wRows.map(([k, v]) => (
                <Bar key={k} label={WEAPON_TYPE[k] ?? k} icon={<Icon kind="ui" name={`weapon-${k}`} tile size="sm" />} value={v} max={wMax} num={nf.format(v)} />
              ))}
            </ul>
            <p className="muted small">Cuenta las misiones completadas con cada arma.</p>
          </>
        ) : (
          <ReadHint />
        )}
        <h3 className="st-h3">Monstruos más cazados</h3>
        {log.length ? (
          <ol className="st-top">
            {log.map((m) => (
              <li key={m.index}>
                <Link to={`/monstruos/${m.hit.id}`} className="st-top__a">
                  <Icon kind="monster" id={m.hit.id} size="md" />
                  <span className="st-top__n">{m.hit.name_es || m.hit.name_en}</span>
                  <span className="muted small">
                    {m.total} · {m.slain} abatidos, {m.captured} capturas
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Investigaciones">
        {inv ? (
          <>
            <dl className="st-facts">
              <Fact label="Guardadas">{inv.count} / 400</Fact>
              {inv.with_tempered != null && <Fact label="Templadas">{inv.with_tempered}</Fact>}
            </dl>
            {inv.by_monster && inv.by_monster.length > 0 && (
              <>
                <h3 className="st-h3">Más repetidas</h3>
                <ul className="st-bars">
                  {inv.by_monster.slice(0, 8).map((m) => {
                    const hit = m.name_en ? mById.get(normName(m.name_en)) : undefined;
                    return (
                      <Bar
                        key={m.index}
                        label={hit ? hit.name_es || hit.name_en : m.name_en ?? `Monstruo ${m.index}`}
                        icon={hit ? <Icon kind="monster" id={hit.id} size="sm" /> : undefined}
                        value={m.count}
                        max={inv.by_monster![0].count}
                      />
                    );
                  })}
                </ul>
              </>
            )}
          </>
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Tierras Guía">
        {gl?.regions?.length ? (
          <>
            <ul className="st-regions">
              {gl.regions.map((r) => (
                <li key={r.index} className="st-card st-region">
                  <b>Región {r.index + 1}</b>
                  <span>
                    Nivel {r.level}
                    {gl.max_level ? ` / ${gl.max_level}` : ""}
                  </span>
                  <span className="muted small">{nf.format(r.points)} puntos</span>
                </li>
              ))}
            </ul>
            <p className="muted small">El guardado no dice qué región es cada una, así que se numeran por su posición en el archivo.</p>
          </>
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Camarada">
        {pal ? (
          <>
            <dl className="st-facts">
              <Fact label="Nombre">{pal.name || "—"}</Fact>
              <Fact label="XP">{pal.xp != null ? nf.format(pal.xp) : "—"}</Fact>
            </dl>
            {pal.gadget_xp && (
              <ul className="st-bars">
                {Object.entries(pal.gadget_xp).map(([k, v]) => (
                  <Bar key={k} label={GADGET[k] ?? k} value={v} max={Math.max(1, ...Object.values(pal.gadget_xp!))} num={`${nf.format(v)} XP`} />
                ))}
              </ul>
            )}
            <p className="muted small">Experiencia acumulada de cada artilugio.</p>
          </>
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Colección">
        {col ? (
          <dl className="st-facts">
            <Fact label="Piezas de armadura">{col.armor_pieces}</Fact>
            <Fact label="Armas (con copias)">{col.weapons}</Fact>
            <Fact label="Amuletos">{col.charms}</Fact>
            <Fact label="Adornos distintos">{col.decorations_distinct}</Fact>
            <Fact label="Adornos en total">{nf.format(col.decorations_total)}</Fact>
          </dl>
        ) : (
          <ReadHint />
        )}
        <p className="muted small">Es lo que hay ahora en tu cofre de equipo, no lo que has fabricado alguna vez.</p>
      </Section>

      <Section title="Equipo actual">
        {cur ? (
          Object.keys(cur).length ? (
            <ul className="st-slots">
              {SLOTS.map(([k, label]) => (
                <li key={k} className="st-slot">
                  <span className="st-slot__k">{label}</span>
                  {slotItem(cur[k], k)}
                </li>
              ))}
            </ul>
          ) : (
            <ReadHint />
          )
        ) : equip.loading ? (
          <Loading />
        ) : (
          <ReadHint />
        )}
      </Section>

      <Section title="Sets guardados" aside={d.loadouts_count ? <span className="muted small">{d.loadouts_count}</span> : undefined}>
        {equip.data?.loadouts?.length ? (
          <>
            <button className="btn st-toggle" aria-expanded={loOpen} onClick={() => setLoOpen((o) => !o)}>
              {loOpen ? "Ocultar" : "Mostrar"} los {equip.data.loadouts.length} sets guardados
            </button>
            {loOpen && (
              <ul className="st-loadouts">
                {equip.data.loadouts.map((l: any, i: number) => (
                  <li key={i} className="st-loadout">
                    <b>{fixText(l.name) || `Set ${l.slot + 1}`}</b>
                    <span className="st-loadout__items">
                      {SLOTS.map(([k]) => {
                        const ref = l[k];
                        if (!ref) return null;
                        const n = fixText(ref.name_es || ref.name_en);
                        return ref.id != null ? (
                          <Link key={k} to={refPath(k, ref.id)}>
                            {n}
                          </Link>
                        ) : (
                          <span key={k}>{n}</span>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : equip.loading ? (
          <Loading />
        ) : (
          <ReadHint text="No hay sets guardados leídos todavía. Pulsa Actualizar perfil para leer este dato." />
        )}
      </Section>
    </div>
  );
}
