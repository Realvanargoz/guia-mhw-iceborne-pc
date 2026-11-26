import { Gem, Parchment } from "../../components/book";
import { GoalBuild } from "../../components/GoalBuild";
import { Rules } from "../../components/Rules";
import { Section } from "../../components/ui";
import { BranchGlyph } from "./BranchGlyph";
import type { CanteenEngine, EBranch } from "./engine";
import type { Canteen, Skill } from "./types";
import { ROMAN, brKey } from "./types";

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

/** One branch ladder: glyph + colour band, then the three skills by tier with their effect and best use. */
function Ladder({ b, skills }: { b: EBranch; skills: Skill[] }) {
  return (
    <li className="sk-br" data-br={brKey(b.id)}>
      <h3 className="sk-br__head">
        <span className="sk-br__chip">
          <BranchGlyph branch={b.id} size={18} />
          {b.name_es}
        </span>
        <span className="sk-br__col small">
          {b.color_name_es}
          {b.group === "drink" ? " · solo bebidas" : ""}
        </span>
      </h3>
      <ol className="sk-rungs">
        {skills.map((s) => (
          <li key={s.id} className="sk-rung">
            <span className="sk-rung__tier" aria-hidden>
              <Gem size={14} active />
              {ROMAN[s.tier ?? 0]}
            </span>
            <div className="sk-rung__t">
              <b>
                <span className="sr-only">Nivel {s.tier}: </span>
                {s.name_es} <span className="muted small" lang="en">{s.name_en}</span>
              </b>
              <span className="sk-rung__tags small">
                {s.ingredients_required && <span>{s.ingredients_required} ingredientes</span>}
                {s.hunter_effect && <span className="badge">Cazador</span>}
                {s.palico_effect && <span className="badge">Camarada</span>}
                {s.needs_review && <span className="badge badge--warn">Revisar</span>}
              </span>
              <span className="small">{s.effect_es}</span>
              {s.synergy_es && (
                <span className="small sk-use">
                  <b>Uso:</b> {s.synergy_es}
                </span>
              )}
              {s.numeric_details?.map((n, i) => (
                <span key={i} className="small muted">
                  {n.text_es}
                </span>
              ))}
              {s.note_es && <span className="small muted">{s.note_es}</span>}
            </div>
          </li>
        ))}
      </ol>
    </li>
  );
}

export function Skills({ data, engine }: { data: Canteen; engine: CanteenEngine }) {
  const byId = new Map(data.skills.ingredient.map((s) => [s.id, s]));
  return (
    <div>
      <Section title="Habilidades de ingrediente (2 / 4 / 6 ingredientes de la misma rama)">
        <Parchment className="sk-rule">
          <p>
            <b>Cada rama da solo su nivel más alto:</b> con 6 de Artillería sale Piro Felyne, no Bombardero ni Puntería.
          </p>
          <p className="small">Para tener dos o tres habilidades, reparte el plato entre ramas (4 + 2 o 2 + 2 + 2).</p>
        </Parchment>
        <ul className="sk-ladders">
          {engine.branches.map((b) => (
            <Ladder
              key={b.id}
              b={b}
              skills={engine
                .branchSkills(b.id)
                .map((s) => byId.get(s.id))
                .filter((s): s is Skill => !!s)}
            />
          ))}
        </ul>
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
