import { ReactNode } from "react";
import { Icon } from "./Icon";
import { Defense, ELEMENTS, SkillRow, difficultyTone } from "../build";
import { BOOK_ELEMENT_ES } from "../labels";
import "../builder.css";

export function OwnedBadge({ title = "La tienes en tu cofre" }: { title?: string }) {
  return (
    <span className="bv-own" title={title} role="img" aria-label={title}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
        <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Barra de nivel de habilidad: segmentos hasta el máximo (como el juego). */
export function LevelBar({ level, max }: { level: number; max: number }) {
  const over = level > max;
  return (
    <span className={`bv-lv${over ? " bv-lv--over" : ""}`} role="img" aria-label={`Nivel ${level} de ${max}`}>
      {Array.from({ length: Math.max(max, 1) }, (_, i) => (
        <i key={i} className={i < level ? "on" : ""} />
      ))}
    </span>
  );
}

export function SkillList({ skills, relevant, empty = "Sin habilidades." }: { skills: SkillRow[]; relevant?: Set<number>; empty?: string }) {
  if (!skills.length) return <p className="bv-hint">{empty}</p>;
  const sorted = [...skills].sort((a, b) => Number(relevant?.has(b.skill_id) ?? 0) - Number(relevant?.has(a.skill_id) ?? 0));
  return (
    <ul className="bv-skills">
      {sorted.map((s) => {
        const rel = relevant?.has(s.skill_id);
        return (
          <li key={s.skill_id} className={rel ? "bv-skill bv-skill--rel" : "bv-skill"}>
            <span className="bv-skill__n">
              {s.name_es || s.name_en}
              {rel && <em title="Este monstruo hace que esta habilidad importe">clave</em>}
            </span>
            <LevelBar level={Math.min(s.level, s.max)} max={s.max} />
            <b className="bv-skill__v">
              {s.level}
              <small>/{s.max}</small>
            </b>
          </li>
        );
      })}
    </ul>
  );
}

export function Resistances({ res }: { res: Record<string, number> }) {
  return (
    <ul className="bv-res">
      {ELEMENTS.map((k) => {
        const v = res[k] ?? 0;
        return (
          <li key={k} className={v < 0 ? "neg" : v >= 20 ? "high" : ""} title={`Resistencia a ${BOOK_ELEMENT_ES[k].toLowerCase()}`}>
            <Icon kind="ui" name={`element-${k}`} size="md" alt={BOOK_ELEMENT_ES[k]} />
            <b>{v > 0 ? `+${v}` : v}</b>
          </li>
        );
      })}
    </ul>
  );
}

export function DefenseBox({ d }: { d: Defense }) {
  return (
    <div className="bv-def">
      <div className="bv-def__cell">
        <span>Defensa base</span>
        <b>{d.base}</b>
      </div>
      <div className="bv-def__cell">
        <span>Mejorada</span>
        <b>{d.max}</b>
      </div>
      <div className="bv-def__cell">
        <span>Con aumentos</span>
        <b>{d.augment_max}</b>
      </div>
      {d.note_es && <p className="bv-hint bv-def__note">{d.note_es}</p>}
    </div>
  );
}

export function DecoChip({
  id,
  name,
  size,
  difficulty,
  owned,
  onClick,
  title,
}: {
  id: number;
  name: string;
  size?: number;
  difficulty?: string;
  owned?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const tone = difficultyTone(difficulty);
  const inner = (
    <>
      <Icon kind="decoration" id={id} size="sm" />
      <span className="bv-deco__n">{name}</span>
      {tone !== "normal" && <span className={`bv-diff bv-diff--${tone}`}>{tone === "rare" ? "Rara" : "Difícil"}</span>}
      {owned && <OwnedBadge title="La tienes en tu cofre" />}
    </>
  );
  const cls = `bv-deco${size ? ` bv-deco--s${size}` : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>
      {inner}
    </button>
  ) : (
    <span className={cls} title={title}>
      {inner}
    </span>
  );
}

/** Ranura vacía o rellena: gema del tamaño + contenido. */
export function SlotRow({ size, children }: { size: number; children?: ReactNode }) {
  return (
    <div className="bv-slot">
      <span className={`bv-gem bv-gem--${size}`} title={`Ranura de tamaño ${size}`}>
        {size}
      </span>
      <div className="bv-slot__c">{children ?? <span className="bv-hint">Libre</span>}</div>
    </div>
  );
}
