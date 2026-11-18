/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { sendJson, useApi } from "../api";
import { Icon } from "../components/Icon";
import { GoalBuild } from "../components/GoalBuild";
import { Rules } from "../components/Rules";
import { Stars } from "../components/book";
import { Check, ErrorBox, Loading, Section, Tabs } from "../components/ui";
import "../builder.css";
import "../canteen.css";

type Ing = {
  id: string;
  name_en: string;
  name_es: string;
  category: string;
  category_es?: string;
  skill_type: string | null;
  skill_type_es: string | null;
  unlock_es?: string;
  item_id: number | null;
  icon_url: string | null;
  done: boolean;
  needs_review: boolean;
};
type Skill = {
  id: string;
  name_es: string;
  name_en: string;
  effect_es: string;
  skill_type_es: string | null;
  tier: number | null;
  ingredients_required: number | null;
  hunter_effect: boolean;
  palico_effect: boolean;
  note_es?: string | null;
  pool_note?: string | null;
  numeric_details?: { text_es: string }[] | null;
  needs_review: boolean;
};
type Canteen = {
  ingredients: Ing[];
  skills: { ingredient: Skill[]; daily: Skill[] };
  skill_types: { skill_type: string; skill_type_es: string; categories: string[] }[];
  rules: { id: string; title_es: string; text_es: string; needs_review: boolean }[];
  meta: { categories: { id: string; name_es: string }[]; simulate: { max_ingredients: number } };
};

type Pick = { id: string; fresh: boolean };
type Voucher = "none" | "voucher" | "gourmet";
type Saved = { id: string; name: string; updated: number; slots: number; voucher: Voucher; picks: Pick[]; daily: string[] };

const KEY = "mhw.canteen.combos";
function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeSaved(l: Saved[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
    return true;
  } catch {
    return false;
  }
}

function IngIcon({ ing, size = "md" }: { ing: Ing; size?: "sm" | "md" }) {
  if (ing.icon_url) return <Icon kind="ingredient" id={ing.id} size={size} />;
  return (
    <span className={`cn-mark cn-mark--${ing.category}`} aria-hidden title="Sin icono">
      {(ing.name_es || ing.name_en).charAt(0)}
    </span>
  );
}

function FreshBox() {
  return (
    <details className="cn-fresh" open>
      <summary>Cómo reconocer un ingrediente fresco</summary>
      <ul>
        <li>
          En la cantina, un ingrediente fresco lo delatan unos <b>destellos verdes</b> y un <b>pequeño icono verde</b> junto a él.
        </li>
        <li>
          Cada ingrediente fresco añade <b>+10 de vida máxima al cazador</b>, <b>+4 al camarada</b> y <b>media estrella</b> de activación de habilidades (con 6 frescos, 3 estrellas).
        </li>
        <li>Un Vale pone la activación al máximo y el Vale Gourmet vuelve frescos todos los ingredientes.</li>
      </ul>
      <p className="review">
        Dato pendiente de verificación (needs_review): los efectos de la frescura salen de wikis que no coinciden del todo. Compruébalo en el juego.
      </p>
    </details>
  );
}

/* ---------- Constructor ---------- */
function Builder({ data }: { data: Canteen }) {
  const byId = useMemo(() => new Map(data.ingredients.map((i) => [i.id, i])), [data]);
  const [slots, setSlots] = useState(4);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [voucher, setVoucher] = useState<Voucher>("none");
  const [daily, setDaily] = useState<string[]>([]);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [sim, setSim] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved[]>(readSaved);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPicks((p) => (p.length > slots ? p.slice(0, slots) : p));
  }, [slots]);

  useEffect(() => {
    if (!picks.length) {
      setSim(null);
      setErr(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      sendJson("POST", "/canteen/simulate", { ingredients: picks, slots, voucher, daily_skill_ids: daily })
        .then((r) => {
          if (!live) return;
          setSim(r);
          setErr(null);
        })
        .catch((e: Error) => live && setErr(e.message))
        .finally(() => live && setBusy(false));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [picks, slots, voucher, daily]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.ingredients.filter((i) => (cat === "all" || i.category === cat) && (!s || `${i.name_es} ${i.name_en}`.toLowerCase().includes(s)));
  }, [data, cat, q]);

  const full = picks.length >= slots;
  const add = (id: string) => !full && setPicks((p) => [...p, { id, fresh: false }]);
  const toggleDaily = (id: string) => setDaily((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= 3 ? d : [...d, id]));

  const save = () => {
    const nm = name.trim() || `Combinación ${saved.length + 1}`;
    const next = [{ id: String(Date.now()), name: nm, updated: Date.now(), slots, voucher, picks, daily }, ...saved];
    if (writeSaved(next)) {
      setSaved(next);
      setName("");
      setMsg(`Guardada «${nm}».`);
    } else setMsg("No se pudo guardar: el navegador bloquea el almacenamiento local.");
  };
  const load = (s: Saved) => {
    setSlots(s.slots);
    setVoucher(s.voucher);
    setDaily(s.daily ?? []);
    setPicks(s.picks.filter((p) => byId.has(p.id)));
    setMsg(`Cargada «${s.name}».`);
  };
  const del = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    writeSaved(next);
    setSaved(next);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ kind: "mhw-canteen-combos", version: 1, combos: saved }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cantina-combinaciones.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const arr: any[] = Array.isArray(j) ? j : j.combos;
      const ok: Saved[] = (arr ?? [])
        .filter((c) => c && Array.isArray(c.picks) && c.picks.every((p: any) => typeof p?.id === "string"))
        .map((c, i) => ({
          id: `${Date.now()}-${i}`,
          name: String(c.name ?? `Importada ${i + 1}`).slice(0, 60),
          updated: Date.now(),
          slots: Math.min(6, Math.max(2, Number(c.slots) || 4)),
          voucher: ["none", "voucher", "gourmet"].includes(c.voucher) ? c.voucher : "none",
          picks: c.picks.map((p: any) => ({ id: p.id, fresh: !!p.fresh })),
          daily: Array.isArray(c.daily) ? c.daily.filter((d: any) => typeof d === "string") : [],
        }));
      if (!ok.length) throw new Error("vacío");
      const next = [...ok, ...saved];
      writeSaved(next);
      setSaved(next);
      setMsg(`Importadas ${ok.length} combinaciones.`);
    } catch {
      setMsg("El archivo no tiene un formato válido de combinaciones.");
    }
  };

  return (
    <div className="cn-build">
      <FreshBox />
      <div className="cn-opts">
        <label>
          Huecos de ingredientes
          <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vale
          <select value={voucher} onChange={(e) => setVoucher(e.target.value as Voucher)}>
            <option value="none">Ninguno</option>
            <option value="voucher">Vale</option>
            <option value="gourmet">Vale Gourmet</option>
          </select>
        </label>
      </div>

      <div className="cn-cols">
        <div className="cn-pick">
          <h3 className="cn-h">Elegir ingredientes</h3>
          <div className="cn-filter">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ingrediente…" aria-label="Buscar ingrediente" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
              <option value="all">Todas</option>
              {data.meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_es}
                </option>
              ))}
            </select>
          </div>
          <ul className="cn-grid">
            {list.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => add(i.id)} disabled={full} title={i.unlock_es}>
                  <IngIcon ing={i} size="sm" />
                  <span>
                    {i.name_es}
                    <small>{i.skill_type_es ?? i.category_es}</small>
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="empty">Sin resultados.</li>}
          </ul>
        </div>

        <div className="cn-res">
          <h3 className="cn-h">
            Tu plato ({picks.length}/{slots}){" "}
            {picks.length > 0 && (
              <button type="button" className="cn-link" onClick={() => setPicks([])}>
                vaciar
              </button>
            )}
          </h3>
          {!picks.length && <p className="muted">Pulsa ingredientes de la lista para añadirlos al plato.</p>}
          <ol className="cn-slots">
            {picks.map((p, idx) => {
              const i = byId.get(p.id);
              return (
                <li key={idx}>
                  {i && <IngIcon ing={i} size="sm" />}
                  <span className="cn-slots__n">{i?.name_es ?? p.id}</span>
                  <label className="cn-fresh-tog">
                    <input type="checkbox" checked={p.fresh} onChange={(e) => setPicks((a) => a.map((x, k) => (k === idx ? { ...x, fresh: e.target.checked } : x)))} />
                    fresco
                  </label>
                  <button type="button" className="cn-x" aria-label={`Quitar ${i?.name_es ?? p.id}`} onClick={() => setPicks((a) => a.filter((_, k) => k !== idx))}>
                    ×
                  </button>
                </li>
              );
            })}
          </ol>

          <details className="cn-daily">
            <summary>Habilidades diarias de tu cantina ({daily.length}/3)</summary>
            <p className="small muted">Marca las 3 que muestre tu cantina hoy; llenan los huecos que dejan libres las de ingrediente.</p>
            <ul>
              {data.skills.daily.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={daily.includes(s.id)} disabled={!daily.includes(s.id) && daily.length >= 3} onChange={() => toggleDaily(s.id)} />
                    {s.name_es}
                  </label>
                </li>
              ))}
            </ul>
          </details>

          {err && <div className="error">{err}</div>}
          {sim && <SimResult sim={sim} busy={busy} />}

          <div className="cn-save">
            <h3 className="cn-h">Combinaciones guardadas</h3>
            <div className="cn-save__row">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la combinación" aria-label="Nombre de la combinación" maxLength={60} />
              <button type="button" className="bg-btn" onClick={save} disabled={!picks.length}>
                Guardar
              </button>
            </div>
            <div className="cn-save__row">
              <button type="button" className="cn-btn2" onClick={exportJson} disabled={!saved.length}>
                Exportar JSON
              </button>
              <button type="button" className="cn-btn2" onClick={() => importRef.current?.click()}>
                Importar JSON
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
            </div>
            {msg && (
              <p className="small" role="status">
                {msg}
              </p>
            )}
            <ul className="cn-saved">
              {saved.map((s) => (
                <li key={s.id}>
                  <button type="button" className="cn-link" onClick={() => load(s)}>
                    {s.name}
                  </button>
                  <span className="muted small">
                    {s.picks.length} ingr. · {s.picks.filter((p) => p.fresh).length} frescos
                  </span>
                  <button type="button" className="cn-x" aria-label={`Borrar ${s.name}`} onClick={() => del(s.id)}>
                    ×
                  </button>
                </li>
              ))}
              {!saved.length && <li className="muted small">Aún no hay combinaciones guardadas (se guardan solo en este navegador).</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimResult({ sim, busy }: { sim: any; busy: boolean }) {
  const stars: number = sim.activation?.stars ?? 0;
  const prov: any[] = sim.daily?.provided ?? [];
  const catEs = (c: string) => (c === "meat" ? "carne" : c === "fish" ? "pescado" : "verdura");
  return (
    <div className={`cn-sim${busy ? " cn-sim--busy" : ""}`} aria-live="polite">
      <h3 className="cn-h">Resultado</h3>
      <div className="cn-stars">
        <Stars n={Math.floor(stars)} label={`${stars} de 3 estrellas`} size={22} />
        <b>{stars} / 3</b>
        {stars % 1 !== 0 && <span className="muted small">(incluye media estrella)</span>}
      </div>
      <p className="small">{sim.activation?.text_es}</p>
      {sim.activation?.rule_es && <p className="small muted">{sim.activation.rule_es}</p>}
      <p className="cn-noprob" role="note">
        <b>Sin probabilidades publicadas.</b> {sim.probabilities?.text_es}
      </p>

      <h4 className="cn-h2">Habilidades de ingrediente</h4>
      {sim.by_type?.length ? (
        <ul className="cn-types">
          {sim.by_type.map((t: any) => (
            <li key={t.skill_type}>
              <b>{t.skill_type_es}</b> · {t.count} ingr.
              {t.next_tier_at && <span className="muted small"> (siguiente nivel con {t.next_tier_at})</span>}
              <ul>
                {t.skills.map((s: any) => (
                  <li key={s.id} className={s.unlocked ? "cn-on" : "cn-off"}>
                    <span className="cn-tier">{s.ingredients_required}</span> {s.name_es}
                    {s.unlocked ? " · activa" : " · bloqueada"}
                    {s.needs_review && <span className="badge badge--warn"> Revisar</span>}
                    <small>{s.effect_es}</small>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Ninguna todavía: hacen falta 2, 4 o 6 ingredientes del mismo tipo.</p>
      )}

      <h4 className="cn-h2">Habilidades diarias</h4>
      {prov.length > 0 && (
        <ul className="cn-types">
          {prov.map((s: any, i: number) => (
            <li key={s.id ?? i}>
              {s.name_es ?? s.id}
              {s.effect_es && <small>{s.effect_es}</small>}
            </li>
          ))}
        </ul>
      )}
      {sim.daily?.note_es && <p className="small muted">{sim.daily.note_es}</p>}

      <h4 className="cn-h2">Mejoras de estadísticas</h4>
      <ul className="cn-stats">
        {(sim.stat_buffs ?? []).map((b: any) => (
          <li key={b.stat}>
            <b>{b.name_es}</b> ({b.count} de {catEs(b.from_category)}): {b.level ? `nivel ${b.level}${b.value_fextralife ? ` · +${b.value_fextralife}` : ""}` : "sin mejora aún"}
            {b.needs_review && <span className="badge badge--warn"> Revisar</span>}
          </li>
        ))}
      </ul>

      <h4 className="cn-h2">Vida y aguante</h4>
      {sim.health && (
        <p className="small">
          Cazador: <b>+{sim.health.hunter_max_hp}</b> de vida máxima (tope +{sim.health.hunter_cap}) · Camarada: <b>+{sim.health.palico_max_hp}</b> (tope +{sim.health.palico_cap}) · Aguante hasta +{sim.health.stamina_up_to}.
        </p>
      )}
      {sim.health?.note_es && <p className="small muted">{sim.health.note_es}</p>}
      <h4 className="cn-h2">Camarada</h4>
      <p className="small">{sim.palico?.note_es}</p>
      {sim.notes_es?.length > 0 && (
        <ul className="cn-notes">
          {sim.notes_es.map((n: string, i: number) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {sim.needs_review && <p className="review">Algunas cifras de este resultado están pendientes de verificación (needs_review).</p>}
    </div>
  );
}

/* ---------- Catálogo de ingredientes ---------- */
function Catalog({ data }: { data: Canteen }) {
  const [onlyPending, setOnlyPending] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const isDone = (i: Ing) => done[i.id] ?? i.done;
  const nDone = data.ingredients.filter(isDone).length;
  return (
    <div>
      <div className="cn-cathead">
        <label className="cn-fresh-tog">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Mostrar solo pendientes
        </label>
        <span className="muted small">
          {nDone}/{data.ingredients.length} conseguidos
        </span>
      </div>
      <p className="muted small">
        Los ingredientes básicos y los que se desbloquean con misiones completadas se marcan solos al pulsar «Actualizar
        perfil» (se deducen de tus misiones; el juego guarda la lista real, pero aún no sabemos leerla). Los de
        recolección, entrega y recompensa de investigación se marcan a mano.
      </p>
      {data.meta.categories.map((c) => {
        const rows = data.ingredients.filter((i) => i.category === c.id && (!onlyPending || !isDone(i)));
        if (!rows.length) return null;
        return (
          <Section key={c.id} title={`${c.name_es} (${rows.length})`}>
            <ul className="cn-cat">
              {rows.map((i) => (
                <li key={i.id}>
                  <IngIcon ing={i} />
                  <div className="cn-cat__t">
                    <b>
                      {i.name_es} <span className="muted small">{i.name_en}</span>
                    </b>
                    <span className="small">
                      {i.skill_type_es && <span className="badge">{i.skill_type_es}</span>} {i.unlock_es}
                      {i.needs_review && <span className="badge badge--warn"> Revisar</span>}
                    </span>
                  </div>
                  <Check type="ingredient" id={i.id} done={isDone(i)} label="Conseguido" onChange={(v) => setDone((d) => ({ ...d, [i.id]: v }))} />
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}

/* ---------- Habilidades ---------- */
function SkillCard({ s }: { s: Skill }) {
  return (
    <li className="cn-skill">
      <b>
        {s.name_es} <span className="muted small">{s.name_en}</span>
      </b>
      {s.ingredients_required && <span className="badge">{s.ingredients_required} ingr.</span>}
      {s.hunter_effect && <span className="badge">Cazador</span>}
      {s.palico_effect && <span className="badge">Camarada</span>}
      {s.needs_review && <span className="badge badge--warn">Revisar</span>}
      <span className="small">{s.effect_es}</span>
      {s.numeric_details?.map((n, i) => (
        <span key={i} className="small muted">
          {n.text_es}
        </span>
      ))}
      {s.note_es && <span className="small muted">{s.note_es}</span>}
    </li>
  );
}
function Skills({ data }: { data: Canteen }) {
  const byType = (t: string) => data.skills.ingredient.filter((s) => s.skill_type_es === t).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
  return (
    <div>
      <Section title="Habilidades de ingrediente (2 / 4 / 6 ingredientes del mismo tipo)">
        {data.skill_types.map((t) => (
          <div key={t.skill_type} className="cn-stype">
            <h3 className="cn-h">
              {t.skill_type_es} <small className="muted">· {t.categories.map((c) => data.meta.categories.find((x) => x.id === c)?.name_es ?? c).join(", ")}</small>
            </h3>
            <ul className="cn-skills">
              {byType(t.skill_type_es).map((s) => (
                <SkillCard key={s.id} s={s} />
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section title="Habilidades diarias">
        <p className="muted small">{data.skills.daily[0]?.pool_note ?? "La cantina elige 3 al azar en cada ciclo."}</p>
        <ul className="cn-skills">
          {data.skills.daily.map((s) => (
            <SkillCard key={s.id} s={s} />
          ))}
        </ul>
      </Section>
      <Section title="Reglas de la cantina">
        <ul className="cn-rules">
          {data.rules.map((r) => (
            <li key={r.id}>
              <b>{r.title_es}</b>
              {r.needs_review && <span className="badge badge--warn"> Revisar</span>}
              <p>{r.text_es}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/* ---------- Recolección y botín ---------- */
export function GatherLoot() {
  return (
    <div>
      <Section title="Equipo recomendado para recolección">
        <GoalBuild goal="recoleccion" />
      </Section>
      <Section title="Reglas de recolección">
        <Rules path="/gathering-rules" />
      </Section>
      <Section title="Equipo recomendado para botín">
        <GoalBuild goal="botin" />
      </Section>
      <Section title="Reglas de botín y partes">
        <Rules path="/loot-rules" />
      </Section>
    </div>
  );
}

const TABS = [
  { id: "constructor", label: "Constructor de comida" },
  { id: "ingredientes", label: "Ingredientes" },
  { id: "habilidades", label: "Habilidades" },
  { id: "recoleccion", label: "Recolección y botín" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function CanteenPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "constructor") as TabId;
  const { data, error, loading } = useApi<Canteen>("/canteen");
  return (
    <div>
      <h1 className="page-title">Cantina</h1>
      <p className="lead">
        Ingredientes, habilidades felyne y un constructor de comida. Guías con vídeos: <Link to="/guias/cooking">Cantina</Link>, <Link to="/guias/gathering">Recolección</Link>, <Link to="/guias/loot">Botín</Link>.
      </p>
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} value={tab} onChange={(v) => setSp({ tab: v }, { replace: true })} />
      {tab === "recoleccion" ? (
        <GatherLoot />
      ) : (
        <>
          {loading && !data && <Loading />}
          {error && <ErrorBox error={error} />}
          {data && tab === "constructor" && <Builder data={data} />}
          {data && tab === "ingredientes" && <Catalog data={data} />}
          {data && tab === "habilidades" && <Skills data={data} />}
        </>
      )}
    </div>
  );
}
