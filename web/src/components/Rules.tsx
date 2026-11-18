/* eslint-disable @typescript-eslint/no-explicit-any */
import { safeHref } from "../safeUrl";
import { useApi } from "../api";
import { ErrorBox, Loading, Source } from "./ui";

const SECTION_ES: Record<string, string> = {
  skills: "Habilidades",
  tools: "Herramientas especializadas",
  palico: "Camarada",
  palico_and_meals: "Camarada y comidas",
  combos: "Combinaciones",
  tips: "Consejos",
};
const ORDER = ["skills", "tools", "palico", "palico_and_meals", "combos", "tips"];

function Item({ it }: { it: any }) {
  const title = it.name_es || it.name_en || it.title_es;
  const body = it.text_es || it.effect_es;
  const srcs: Source[] = it.sources ?? [];
  return (
    <li className="rl">
      {title && (
        <h4 className="rl__t">
          {title}
          {it.name_en && it.name_es && it.name_en !== it.name_es && <span className="muted small"> · {it.name_en}</span>}
          {it.max_level ? <span className="badge"> nivel máx. {it.max_level}</span> : null}
          {it.type && <span className="badge">{it.type}</span>}
          {it.needs_review && <span className="badge badge--warn">Revisar</span>}
        </h4>
      )}
      {!title && it.needs_review && <span className="badge badge--warn">Revisar</span>}
      {body && <p>{body}</p>}
      {it.affects && <p className="small muted">Afecta a: {it.affects}</p>}
      {it.notes_es && <p className="small">{it.notes_es}</p>}
      {Array.isArray(it.mechanics) && it.mechanics.length > 0 && (
        <ul className="rl__ul">
          {it.mechanics.map((m: string, i: number) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {Array.isArray(it.tiers) && it.tiers.length > 0 && (
        <ul className="rl__ul">
          {it.tiers.map((t: any, i: number) => (
            <li key={i}>
              <b>{t.name}</b>: {t.effect_es}
            </li>
          ))}
        </ul>
      )}
      {it.how_to_get_es && (
        <p className="small">
          <b>Cómo conseguirlo:</b> {it.how_to_get_es}
        </p>
      )}
      {(it.duration_s || it.recharge_s) && (
        <p className="small muted">
          {it.duration_s ? `Dura ${it.duration_s} s` : ""}
          {it.duration_s && it.recharge_s ? " · " : ""}
          {it.recharge_s ? `recarga ${it.recharge_s} s` : ""}
        </p>
      )}
      {Array.isArray(it.trade_in_values) && it.trade_in_values.length > 0 && (
        <details className="small">
          <summary>Objetos de intercambio y su valor</summary>
          <ul className="rl__ul">
            {it.trade_in_values.map((r: any[], i: number) => (
              <li key={i}>
                {r[1] || r[0]}: {Number(r[2]).toLocaleString("es-ES")} z
              </li>
            ))}
          </ul>
        </details>
      )}
      {Array.isArray(it.granted_by) && it.granted_by.length > 0 && (
        <p className="small muted">
          Bonificaciones de set: {it.granted_by.map((g: any) => `${g.set_bonus_en} (${g.pieces} piezas)`).join(", ")}
        </p>
      )}
      {it.granted_by_charms && <p className="small muted">Amuletos: {it.granted_by_charms.join(", ")}</p>}
      {(it.granted_by_decorations || it.decorations) && <p className="small muted">Joyas: {(it.granted_by_decorations || it.decorations).join(", ")}</p>}
      {it.numbers && <p className="small muted">Cifras: {typeof it.numbers === "string" ? it.numbers : JSON.stringify(it.numbers)}</p>}
      {it.needs_review && (it.review_note || it.gadget_levels_note) && <p className="rl__rev small">{it.review_note || it.gadget_levels_note}</p>}
      {srcs.length > 0 && (
        <details className="small">
          <summary>Fuentes ({srcs.length})</summary>
          <ul className="rl__ul">
            {srcs.map((s, i) => (
              <li key={i}>
                <a href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** Reglas legibles de /api/loot-rules o /api/gathering-rules. */
export function Rules({ path }: { path: "/loot-rules" | "/gathering-rules" }) {
  const { data, error, loading } = useApi<{ sections: Record<string, any[]>; note_es?: string }>(path);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const keys = [...ORDER.filter((k) => data.sections[k]?.length), ...Object.keys(data.sections).filter((k) => !ORDER.includes(k) && data.sections[k]?.length)];
  return (
    <div className="rules">
      {data.note_es && <p className="review">{data.note_es}</p>}
      {keys.map((k) => (
        <div key={k} className="rules__sec">
          <h3 className="rules__h">{SECTION_ES[k] ?? k}</h3>
          <ul className="rl-list">
            {data.sections[k].map((it, i) => (
              <Item key={it.id ?? i} it={it} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
