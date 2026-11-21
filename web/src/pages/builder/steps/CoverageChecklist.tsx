/* Lista de cobertura: una fila por objetivo con barra segmentada por origen + texto (el color nunca es la única señal). */
import { CovRow, TIER_NAME } from "../planState";

const STATUS: Record<CovRow["status"], { icon: string; text: string }> = {
  ok: { icon: "✓", text: "Completa" },
  parcial: { icon: "◐", text: "Parcial" },
  falta: { icon: "✕", text: "Falta" },
};
export const REASON_ES: Record<NonNullable<CovRow["reason"]>, string> = {
  cap_locked: "Supera el tope de la habilidad y necesita un bono de set.",
  no_jewel: "No hay joyas de esta habilidad en este rango.",
  jewel_not_owned: "No tienes joyas suficientes de esta habilidad.",
  no_slot: "No queda ranura libre del tamaño necesario.",
};

type Seg = { key: "armor" | "charm" | "deco" | "bonus"; n: number; label: string };

/** Reparte los niveles logrados entre orígenes (armadura, amuleto, joya, bono) sin pasar del objetivo. */
export function segments(c: CovRow): { segs: Seg[]; extra: number; label: string } {
  let left = c.target;
  const take = (n: number) => {
    const k = Math.max(0, Math.min(left, n));
    left -= k;
    return k;
  };
  const a = take(c.from.armadura);
  const ch = take(c.from.amuleto);
  const d = take(c.from.joya);
  const got = Math.min(c.achieved, c.target);
  const b = c.bonus ? take(Math.max(0, got - (a + ch + d))) : 0;
  const segs: Seg[] = [
    { key: "armor", n: a, label: "armadura" },
    { key: "charm", n: ch, label: "amuleto" },
    { key: "deco", n: d, label: "joya" },
    { key: "bonus", n: b, label: "bono" },
  ];
  const parts: string[] = [];
  for (const s of segs) if (s.n > 0 || (s.key === "bonus" && c.bonus)) parts.push(s.key === "bonus" ? "bono" : `${s.label} ${s.n}`);
  const extra = Math.max(0, c.achieved - c.target);
  return { segs, extra, label: parts.length ? parts.join(" · ") : "sin aportes" };
}

export function CoverageBar({ c }: { c: CovRow }) {
  const { segs, label } = segments(c);
  const filled = segs.reduce((n, s) => n + s.n, 0);
  const empty = Math.max(0, c.target - filled);
  return (
    <>
      <span className="pl-bar" role="img" aria-label={`${c.name_es}: ${Math.min(c.achieved, c.target)} de ${c.target} niveles (${label})`}>
        {segs.map((s) =>
          Array.from({ length: s.n }, (_, i) => <i key={`${s.key}${i}`} className={`pl-bar__c pl-bar__c--${s.key}`} />),
        )}
        {Array.from({ length: empty }, (_, i) => (
          <i key={`e${i}`} className="pl-bar__c pl-bar__c--empty" />
        ))}
      </span>
      <span className="pl-bar__lbl">{label}</span>
    </>
  );
}

export default function CoverageChecklist({ rows }: { rows: CovRow[] }) {
  if (!rows.length) return <p className="pl-empty pl-empty--s">Este plan no tiene objetivos que comprobar.</p>;
  return (
    <>
      <ul className="pl-cov">
        {rows.map((c) => {
          const st = STATUS[c.status];
          const { extra } = segments(c);
          return (
            <li key={c.skill_id} className={`pl-covrow pl-covrow--${c.status}`}>
              <div className="pl-covrow__h">
                <b className="pl-covrow__n">{c.name_es}</b>
                <span className="pl-tag">{TIER_NAME[c.tier]}</span>
                <span className={`pl-st pl-st--${c.status}`}>
                  <span aria-hidden>{st.icon}</span> {st.text} {c.achieved}/{c.target}
                </span>
              </div>
              <div className="pl-covrow__b">
                <CoverageBar c={c} />
                {extra > 0 && <small className="pl-muted">(+{extra} de sobra)</small>}
              </div>
              {c.cap_unlocked_by && <p className="pl-covrow__note">Tope ampliado hasta {c.cap} por «{c.cap_unlocked_by}».</p>}
              {c.status !== "ok" && c.reason && <p className="pl-covrow__note">{REASON_ES[c.reason]}</p>}
            </li>
          );
        })}
      </ul>
      <p className="pl-legend" aria-label="Leyenda de colores">
        <span><i className="pl-bar__c pl-bar__c--armor" /> armadura</span>
        <span><i className="pl-bar__c pl-bar__c--charm" /> amuleto</span>
        <span><i className="pl-bar__c pl-bar__c--deco" /> joya</span>
        <span><i className="pl-bar__c pl-bar__c--bonus" /> bono</span>
        <span><i className="pl-bar__c pl-bar__c--empty" /> sin cubrir</span>
      </p>
    </>
  );
}
