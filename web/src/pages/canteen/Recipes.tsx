import { CSSProperties, Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gem } from "../../components/book";
import { BranchGlyph } from "./BranchGlyph";
import type { BranchId, CanteenEngine, Category, EBranch, ERecipe, PlatePick, SimResult, SuggestResult } from "./engine";
import { STAT_ORDER } from "./engine";
import { IngIcon } from "./IngIcon";
import { LockSvg } from "./Plate";
import { Seg } from "./Seg";
import type { Canteen, Ing } from "./types";
import { ROMAN, brKey } from "./types";

type Seg6 = { count: number; category: Category; branch: BranchId };

const LEVEL_WORD: Record<string, string> = { P: "pequeño", M: "mediano", G: "grande" };

/** Hint shown while the player has not marked anything beyond the base ingredients. */
export function OwnedHint() {
  return (
    <p className="rc-hint small">
      Marca tus ingredientes en la pestaña <Link to="?tab=ingredientes">Ingredientes</Link> o pulsa «Actualizar perfil» en{" "}
      <Link to="/">Inicio</Link>. Mientras tanto, las recetas solo cuentan los ingredientes básicos.
    </p>
  );
}

/**
 * Six pips split in runs by branch, each run labelled "4 Carne · Artillería". Drink pips are drawn round so the
 * difference survives without colour.
 */
function PipBar({ segs, engine, compact = false }: { segs: readonly Seg6[]; engine: CanteenEngine; compact?: boolean }) {
  const label = segs.map((s) => `${s.count} ${engine.categoryLabel_es[s.category].toLowerCase()} de ${engine.branch(s.branch)?.name_es ?? s.branch}`).join(", ");
  let k = 0;
  return (
    <div className={`rc-pipbar${compact ? " rc-pipbar--compact" : ""}`} role="img" aria-label={label} style={{ gridTemplateColumns: segs.map((s) => `${s.count}fr`).join(" ") }}>
      {segs.map((s, i) => (
        <div key={i} className="rc-run" data-br={brKey(s.branch)} data-cat={s.category}>
          <span className="rc-run__pips" aria-hidden>
            {Array.from({ length: s.count }, (_, j) => (
              <span key={j} className="rc-pip" style={{ "--i": k++ } as CSSProperties} />
            ))}
          </span>
          {!compact && (
            <span className="rc-run__lab" aria-hidden>
              <BranchGlyph branch={s.branch} size={14} />
              <span>
                {s.count} {engine.categoryLabel_es[s.category]} · {engine.branch(s.branch)?.name_es ?? s.branch}
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Stat levels and active skills of a simulated plate, as the engine computed them. */
function Outcome({ res, engine }: { res: SimResult; engine: CanteenEngine }) {
  const stats = STAT_ORDER.map((k) => ({ k, row: res.stats[k] })).filter((s) => s.row.level > 0);
  return (
    <div className="rc-out">
      <p className="rc-stats">
        {stats.length ? (
          stats.map(({ k, row }) => (
            <span key={k} className="rc-stat">
              {engine.statLabel_es[k]}{" "}
              <abbr className="rc-lv" title={`Bonificación ${LEVEL_WORD[row.label_es] ?? ""}`}>
                {row.label_es}
              </abbr>
            </span>
          ))
        ) : (
          <span className="rc-stat rc-stat--none">Sin estadística</span>
        )}
      </p>
      <ul className="rc-sks" aria-label="Habilidades que da">
        {res.activeSkillIds.map((id) => {
          const t = engine.skillTier(id);
          const sk = engine.skill(id);
          return (
            <li key={id} className="rc-sk" data-br={brKey(t?.branch)}>
              {t && <BranchGlyph branch={t.branch} size={13} />}
              <span className="rc-sk__n">{sk?.name_es ?? id}</span>
              {t && (
                <span className="rc-sk__t" title={`Nivel ${ROMAN[t.tier]}`}>
                  <Gem size={11} active />
                  {ROMAN[t.tier]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- patrones de mezcla ---------- */
const PATTERNS: { title: string; outcome: string; segs: Seg6[] }[] = [
  { title: "6 de una rama", outcome: "habilidad de nivel III", segs: [{ count: 6, category: "meat", branch: "Artillery" }] },
  {
    title: "4 + 2",
    outcome: "nivel II + nivel I",
    segs: [
      { count: 4, category: "meat", branch: "Artillery" },
      { count: 2, category: "meat", branch: "Courage" },
    ],
  },
  {
    title: "2 + 2 + 2",
    outcome: "tres habilidades de nivel I",
    segs: [
      { count: 2, category: "meat", branch: "Courage" },
      { count: 2, category: "meat", branch: "Vigor" },
      { count: 2, category: "meat", branch: "Artillery" },
    ],
  },
  {
    title: "Con bebidas",
    outcome: "la estadística baja un nivel por cada par",
    segs: [
      { count: 4, category: "meat", branch: "Artillery" },
      { count: 2, category: "drink", branch: "Fortune" },
    ],
  },
];

function Patterns({ engine }: { engine: CanteenEngine }) {
  const examples = useMemo(
    () =>
      PATTERNS.map((p) => {
        const picks: PlatePick[] = p.segs.flatMap((s) => engine.ingredientsBy(s.category, s.branch).slice(0, s.count).map((i) => ({ id: i.id, fresh: false })));
        return picks.length === 6 ? engine.simulate(picks, { slots: 6, voucher: "none", daily: [] }).summary_es : null;
      }),
    [engine],
  );
  return (
    <section className="rc-band" aria-labelledby="rc-pat-h">
      <h2 className="rc-h" id="rc-pat-h">
        Patrones de mezcla
      </h2>
      <p className="rc-sub">Cada par de ingredientes de la misma rama sube un nivel. Así se reparten los seis huecos:</p>
      <ol className="rc-pats">
        {PATTERNS.map((p, i) => (
          <li key={p.title} className="rc-pat">
            <PipBar segs={p.segs} engine={engine} compact />
            <p className="rc-pat__t">
              <b>{p.title}</b> <span aria-hidden>→</span>
              <span className="sr-only">da</span> {p.outcome}
            </p>
            {examples[i] && (
              <p className="rc-pat__ex small">
                <span className="rc-pat__exl">Ejemplo</span> {examples[i]}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- leyenda de ramas ---------- */
function Legend({ engine }: { engine: CanteenEngine }) {
  return (
    <section className="rc-band" aria-labelledby="rc-leg-h">
      <h2 className="rc-h" id="rc-leg-h">
        Colores de las ramas
      </h2>
      <p className="rc-sub">Cada rama tiene tres habilidades: con 2, 4 o 6 ingredientes sale la de nivel I, II o III.</p>
      <ul className="rc-legend">
        {engine.branches.map((b) => {
          const chosen = b.group === "drink" && (b as EBranch & { needs_review?: boolean }).needs_review === true;
          return (
            <li key={b.id} className="rc-lg" data-br={brKey(b.id)}>
              <span className="rc-lg__head">
                <span className="rc-lg__sw" aria-hidden>
                  <BranchGlyph branch={b.id} size={18} />
                </span>
                <span className="rc-lg__n">
                  <b>{b.name_es}</b>
                  <span className="small">
                    {b.color_name_es ?? ""}
                    {b.group === "drink" ? " · bebidas" : ""}
                  </span>
                </span>
              </span>
              {chosen && (
                <span className="rc-lg__note small" title="El juego no da nombre a este color: lo eligió la guía y está pendiente de revisar.">
                  Color elegido por la guía
                </span>
              )}
              <ol className="rc-lg__ladder">
                {engine.branchSkills(b.id).map((s, t) => (
                  <li key={s.id}>
                    <span className="rc-lg__tier" aria-hidden>
                      {ROMAN[t + 1]}
                    </span>
                    <span className="sr-only">Nivel {t + 1}:</span> {s.name_es}
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- tarjeta de receta ---------- */
function RecipeCard({ recipe, plate, engine, ingById, owned }: { recipe: ERecipe; plate: SuggestResult; engine: CanteenEngine; ingById: Map<string, Ing>; owned: ReadonlySet<string> }) {
  const navigate = useNavigate();
  const picks = [...plate.picks].sort((a, b) => Number(engine.isOwned(b.id, owned)) - Number(engine.isOwned(a.id, owned)));
  const daily = recipe.needs_daily ? engine.skill(recipe.needs_daily)?.name_es ?? recipe.needs_daily : null;
  const variant = typeof recipe.variants_es === "string" && recipe.variants_es.trim() ? recipe.variants_es : null;
  const notes = plate.notes_es.filter((n) => !n.startsWith("Además necesita") && !n.startsWith("Aún no tienes") && !n.startsWith("Este plato también"));
  const load = () => navigate({ search: `?tab=simulador&plato=${plate.picks.map((p) => encodeURIComponent(p.id)).join(",")}` });
  const hid = `rc-${recipe.id}`;
  return (
    <li className="rc-card" aria-labelledby={hid}>
      <header className="rc-card__head">
        <h3 className="rc-card__n" id={hid}>
          {recipe.name_es}
        </h3>
        {recipe.plate_type_es && <span className="rc-type">{recipe.plate_type_es}</span>}
      </header>
      <PipBar segs={recipe.composition} engine={engine} />
      {picks.length > 0 && (
        <ul className="rc-ings" aria-label="Ingredientes propuestos">
          {picks.map((p) => {
            const ing = ingById.get(p.id);
            const have = engine.isOwned(p.id, owned);
            return (
              <li key={p.id} className="rc-ing" data-missing={have ? undefined : "1"} title={`${ing?.name_es ?? p.id}${have ? "" : " (no lo tienes)"}`}>
                {ing ? <IngIcon ing={ing} size={32} /> : null}
                <span className="sr-only">
                  {ing?.name_es ?? p.id}
                  {have ? "" : ", no lo tienes"}
                </span>
                {!have && (
                  <span className="rc-ing__lock" aria-hidden>
                    <LockSvg size={11} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {plate.result && <Outcome res={plate.result} engine={engine} />}
      {!plate.ok && plate.reason_es && <p className="rc-warn small">{plate.reason_es}</p>}
      <dl className="rc-meta small">
        {recipe.use_es && (
          <>
            <dt>Para</dt>
            <dd>{recipe.use_es}</dd>
          </>
        )}
        {recipe.voucher_es && (
          <>
            <dt>Vale</dt>
            <dd>{recipe.voucher_es}</dd>
          </>
        )}
        {variant && (
          <>
            <dt>Variante</dt>
            <dd>{variant}</dd>
          </>
        )}
      </dl>
      {daily && (
        <p className="rc-daily small">
          Necesita <b>{daily}</b> en las diarias de hoy
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className="rc-note small">
          {n}
        </p>
      ))}
      {plate.missing.length > 0 && (
        <p className="rc-miss small">
          <b>Te faltan:</b>{" "}
          {plate.missing.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 && "; "}
              {m.name_es}
              {m.unlock_es && <span className="rc-miss__u"> ({m.unlock_es})</span>}
            </Fragment>
          ))}
        </p>
      )}
      <button type="button" className="rc-load" onClick={load} disabled={!plate.picks.length}>
        Cargar en el plato
      </button>
    </li>
  );
}

/* ---------- Recetario ---------- */
export function Recipes({ data, engine, owned, anyMarked }: { data: Canteen; engine: CanteenEngine; owned: ReadonlySet<string>; anyMarked: boolean }) {
  const [type, setType] = useState("all");
  const [mine, setMine] = useState(false);
  const recipes = useMemo(() => data.recipes ?? [], [data]);
  const ingById = useMemo(() => new Map(data.ingredients.map((i) => [i.id, i])), [data]);

  const plates = useMemo(
    () =>
      recipes.map((r) => {
        const pref = engine.recipePlate(r, { preferOwned: true, ownedOnly: false, owned });
        const only = engine.recipePlate(r, { preferOwned: true, ownedOnly: true, owned });
        return { r, pref, only, canMake: only.ok && only.missing.length === 0 && only.picks.length > 0 };
      }),
    [recipes, engine, owned],
  );
  const types = useMemo(() => [...new Set(recipes.map((r) => r.plate_type_es).filter((t): t is string => !!t))], [recipes]);
  const shown = plates.filter((p) => (type === "all" || p.r.plate_type_es === type) && (!mine || p.canMake));
  const nMake = plates.filter((p) => p.canMake).length;

  return (
    <div className="rc">
      <Patterns engine={engine} />
      <Legend engine={engine} />
      <section className="rc-band rc-band--list" aria-labelledby="rc-list-h">
        <h2 className="rc-h" id="rc-list-h">
          Recetas
        </h2>
        <div className="rc-tools">
          <Seg label="Tipo de plato" value={type} onChange={setType} options={[{ id: "all", label: "Todas" }, ...types.map((t) => ({ id: t, label: t }))]} />
          <label className="cs-switch">
            <input type="checkbox" role="switch" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            <span className="cs-switch__track" aria-hidden />
            Solo las que puedo hacer
          </label>
          <p className="rc-count small" role="status">
            {shown.length === 1 ? "1 receta" : `${shown.length} recetas`}
            <span className="muted"> · puedes hacer {nMake} de {plates.length}</span>
          </p>
        </div>
        {!anyMarked && <OwnedHint />}
        {shown.length ? (
          <ul className="rc-grid">
            {shown.map((p) => (
              <RecipeCard key={p.r.id} recipe={p.r} plate={mine ? p.only : p.pref} engine={engine} ingById={ingById} owned={owned} />
            ))}
          </ul>
        ) : (
          <p className="rc-empty">
            {mine
              ? "Con lo que tienes no sale ninguna receta de este tipo. Desactiva «Solo las que puedo hacer» para ver qué te falta."
              : "No hay recetas de este tipo."}
          </p>
        )}
      </section>
    </div>
  );
}
