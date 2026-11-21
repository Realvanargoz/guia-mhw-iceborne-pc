import { useMemo, useState } from "react";
import { ErrorBox } from "../../../components/ui";
import { OptList, Opt, PickerModal, SearchBox } from "../editor/pickers";
import { LevelBar } from "../../../components/BuildView";
import { BonusRow, SkillCat, loadSetBonuses, useCatalog } from "../planApi";
import { MAX_TARGETS, SetBonusSel, Target } from "../planState";
import { StepProps, norm, skillLabel } from "./common";

const bonusName = (list: BonusRow[] | undefined, id: number): string | null => {
  const b = list?.find((x) => x.id === id);
  return b ? b.name || b.name_es || b.name_en || null : null;
};

const ORIGIN_ES: Record<string, string> = { monster: "Monstruo", goal: "Objetivo", archetype: "Arquetipo", manual: "Manual" };
export const originChips = (origin?: string): string[] =>
  !origin
    ? ["Manual"]
    : origin.split("+").map((o) => (o.startsWith("style:") ? `Estilo: ${o.slice(6)}` : ORIGIN_ES[o] ?? o));

/** Bonos de set que dejarían este objetivo en su nivel (null = ya cumple). */
export const unlockLabel = (u: { name_es: string | null; required: number; via?: string }): string =>
  u.via === "inheritance" ? `Herencia (${u.name_es || "Fatalis Legend"}, ${u.required} piezas)` : `${u.name_es || "Bono de set"} (${u.required} piezas)`;

export function unlockOptions(s: SkillCat | undefined, t: Target, bonus: SetBonusSel | null): { bonus_id: number; name_es: string | null; required: number; via?: string }[] | null {
  if (!s) return null;
  const need: { bonus_id: number; name_es: string | null; required: number; via?: string }[] = t.level > s.cap ? s.unlocked_by ?? [] : s.set_bonus_only ? s.set_bonuses ?? [] : [];
  if (!need.length) return null;
  if (bonus && need.some((u) => u.bonus_id === bonus.bonus_id && u.required <= bonus.required)) return null;
  const seen = new Set<string>();
  return need.filter((u) => {
    const k = `${u.via ?? ""}:${u.bonus_id}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export default function Habilidades({ state, dispatch, skills, go }: StepProps) {
  const [open, setOpen] = useState(false);
  const bonuses = useCatalog(() => loadSetBonuses(state.objective.rank), [state.objective.rank]).data;
  const full = state.targets.length >= MAX_TARGETS;
  return (
    <div className="pl-stack">
      <p className="pl-lead">
        Elige las habilidades que quieres y el nivel de cada una. Por encima del límite normal solo se llega con un bono de set (por ejemplo,
        Artillería 5 con Esencia Zorah Magdaros).
      </p>
      {state.hints?.discard.length ? (
        <p className="pl-callout" role="note">
          <b>Mejor descartar con esta arma:</b> {state.hints.discard.map((d) => `${d.name_es || "Habilidad"} (${d.why_es})`).join(" · ")}
        </p>
      ) : null}
      <div className="pl-row">
        <button type="button" className="bd-btn" onClick={() => setOpen(true)} disabled={full || !skills}>
          Añadir habilidad
        </button>
        <span className="pl-muted">
          {state.targets.length} de {MAX_TARGETS}
        </span>
      </div>
      {!skills && <p className="pl-muted" role="status">Cargando habilidades…</p>}
      {state.targets.length === 0 ? (
        <p className="pl-empty">Aún no hay habilidades. Añade alguna o aplica una plantilla en el paso Objetivo.</p>
      ) : (
        <ul className="pl-list">
          {state.targets.map((t) => {
            const s = skills?.get(t.skill_id);
            const max = s?.max_level ?? 7;
            const cap = s?.cap ?? max;
            const name = skillLabel(skills, t.skill_id);
            const fix = unlockOptions(s, t, state.set_bonus);
            const overCap = t.level > cap;
            const chosenName = state.set_bonus ? bonusName(bonuses, state.set_bonus.bonus_id) : null;
            return (
              <li key={t.skill_id} className="pl-skill">
                <div className="pl-skill__top">
                  <div className="pl-skill__id">
                    <b className="pl-skill__n" title={name}>{name}</b>
                    <span className="pl-tags pl-tags--quiet">
                      {originChips(t.origin).map((c) => (
                        <span key={c} className="pl-tag">{c}</span>
                      ))}
                      {s?.set_bonus_only && <span className="pl-tag pl-tag--bonus">Solo bono de set</span>}
                    </span>
                  </div>
                  <button type="button" className="pl-x" aria-label={`Quitar ${name}`} onClick={() => dispatch({ type: "removeTarget", skill_id: t.skill_id })}>
                    ×
                  </button>
                </div>
                {s?.description && <p className="pl-skill__d">{s.description}</p>}
                {t.why_es && <small className="pl-muted">{t.why_es}</small>}
                <div className="pl-skill__ctl" role="group" aria-label={`Nivel de ${name}`}>
                  <button type="button" className="pl-skill__btn" aria-label={`Bajar nivel de ${name}`} disabled={t.level <= 1} onClick={() => dispatch({ type: "setLevel", skill_id: t.skill_id, level: t.level - 1 })}>
                    −
                  </button>
                  <LevelBar level={t.level} max={max} cap={cap} />
                  <button type="button" className="pl-skill__btn" aria-label={`Subir nivel de ${name}`} disabled={t.level >= max} onClick={() => dispatch({ type: "setLevel", skill_id: t.skill_id, level: t.level + 1 })}>
                    +
                  </button>
                  <output className="pl-skill__v" aria-live="polite">
                    {t.level}
                    <small>/{max}</small>
                  </output>
                  {max > cap && (
                    <span className={overCap ? "pl-skill__cap pl-skill__cap--over" : "pl-skill__cap"}>
                      {overCap ? "necesita bono" : `normal hasta ${cap}`}
                    </span>
                  )}
                </div>
                {fix && (
                  <div className="pl-callout pl-callout--warn" role="status" aria-live="polite">
                    <span>
                      {overCap ? `${name} ${t.level} supera el límite normal (${cap}). Necesita un bono de set.` : `${name} solo sale de un bono de set.`}
                    </span>
                    <span className="pl-callout__act">
                      {fix.map((u) => {
                        const un = u.name_es || bonusName(bonuses, u.bonus_id) || "Bono de set";
                        return (
                          <button
                            key={`${u.via ?? ""}:${u.bonus_id}`}
                            type="button"
                            className="bd-btn bd-btn--s"
                            onClick={() => dispatch({ type: "setSetBonus", bonus: { bonus_id: u.bonus_id, required: u.required } })}
                          >
                            Usar «{u.via === "inheritance" ? `Herencia: ${un}` : un}» ({u.required} piezas)
                            {chosenName && state.set_bonus?.bonus_id !== u.bonus_id ? ` (sustituye a «${chosenName}»)` : ""}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="pl-skip">
        <button type="button" className="pl-linkbtn" onClick={() => go("bono")}>
          Siguiente: bono de set
        </button>
      </p>
      {open && skills && (
        <SkillPicker
          skills={skills}
          taken={new Set(state.targets.map((t) => t.skill_id))}
          onClose={() => setOpen(false)}
          onPick={(s) => {
            dispatch({ type: "addTarget", target: { skill_id: s.id, level: Math.max(1, s.cap || s.max_level), tier: 2 } });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SkillPicker({ skills, taken, onPick, onClose }: { skills: Map<number, SkillCat>; taken: Set<number>; onPick: (s: SkillCat) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [jewel, setJewel] = useState(false);
  const [bonusOnly, setBonusOnly] = useState(false);
  const opts = useMemo<Opt[]>(() => {
    const t = norm(q.trim());
    return [...skills.values()]
      .filter((s) => !taken.has(s.id))
      .filter((s) => !jewel || s.jewels.length > 0)
      .filter((s) => !bonusOnly || s.set_bonus_only)
      .filter((s) => !t || norm(`${s.name_es ?? ""} ${s.name_en}`).includes(t))
      .sort((a, b) => (a.name_es ?? a.name_en).localeCompare(b.name_es ?? b.name_en, "es"))
      .map((s) => ({
        key: s.id,
        icon: null,
        title: s.name_es || s.name_en,
        sub: `Nivel máximo ${s.max_level}${s.cap !== s.max_level ? ` (normal ${s.cap})` : ""}`,
        right: (
          <span className="pl-tags">
            {s.jewels.length > 0 && <span className="pl-tag">Con joya</span>}
            {s.set_bonus_only && <span className="pl-tag pl-tag--bonus">Solo bono</span>}
          </span>
        ),
      }));
  }, [skills, taken, q, jewel, bonusOnly]);
  return (
    <PickerModal title="Añadir habilidad" onClose={onClose}>
      <div className="bd-filters">
        <SearchBox placeholder="Buscar habilidad…" value={q} onChange={setQ} label="Buscar habilidad" />
        <label className="bd-chk">
          <input type="checkbox" checked={jewel} onChange={(e) => setJewel(e.target.checked)} /> Con joya
        </label>
        <label className="bd-chk">
          <input type="checkbox" checked={bonusOnly} onChange={(e) => setBonusOnly(e.target.checked)} /> Solo bono
        </label>
      </div>
      {skills.size === 0 && <ErrorBox error="El catálogo de habilidades está vacío." />}
      <OptList opts={opts} onPick={(k) => onPick(skills.get(Number(k))!)} />
    </PickerModal>
  );
}
