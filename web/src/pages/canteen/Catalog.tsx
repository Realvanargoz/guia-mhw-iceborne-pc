import { useState } from "react";
import { Check, Section } from "../../components/ui";
import { BranchGlyph } from "./BranchGlyph";
import type { CanteenEngine } from "./engine";
import { IngIcon } from "./IngIcon";
import type { Canteen, Ing } from "./types";
import { brKey } from "./types";

/* ---------- Catálogo de ingredientes ---------- */
/** The "Conseguido" state lives in CanteenPage so the simulator, the matrix and the Recetario see every change. */
export function Catalog({
  data,
  engine,
  isDone,
  onToggle,
}: {
  data: Canteen;
  engine: CanteenEngine;
  isDone: (i: Ing) => boolean;
  onToggle: (id: string, v: boolean) => void;
}) {
  const [onlyPending, setOnlyPending] = useState(false);
  const nDone = data.ingredients.filter(isDone).length;
  return (
    <div className="ct">
      <div className="cn-cathead">
        <label className="cs-switch">
          <input type="checkbox" role="switch" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          <span className="cs-switch__track" aria-hidden />
          Mostrar solo pendientes
        </label>
        <span className="ct-total small">
          {nDone}/{data.ingredients.length} conseguidos
        </span>
      </div>
      <p className="muted small ct-intro">
        Los ingredientes básicos y los que se desbloquean con misiones completadas se marcan solos al pulsar «Actualizar
        perfil» (se deducen de tus misiones; el juego guarda la lista real, pero aún no sabemos leerla). Los de
        recolección, entrega y recompensa de investigación se marcan a mano.
      </p>
      {data.meta.categories.map((c) => {
        const all = data.ingredients.filter((i) => i.category === c.id);
        const got = all.filter(isDone).length;
        const rows = all.filter((i) => !onlyPending || !isDone(i));
        const pct = all.length ? Math.round((got / all.length) * 100) : 0;
        const aside = (
          <span className="ct-prog">
            <span className="ct-prog__bar" aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </span>
            <span>
              {got}/{all.length}
              <span className="sr-only"> conseguidos</span>
            </span>
          </span>
        );
        return (
          <Section key={c.id} title={c.name_es} aside={aside}>
            {!rows.length && <p className="ct-done small">Todo conseguido en esta categoría.</p>}
            {engine.branches.map((b) => {
              const list = rows.filter((i) => i.skill_type === b.id);
              if (!list.length) return null;
              return (
                <div key={b.id} className="ct-group" data-br={brKey(b.id)}>
                  <h4 className="ct-br">
                    <span className="ct-br__chip">
                      <BranchGlyph branch={b.id} size={15} />
                      {b.name_es}
                    </span>
                    {b.color_name_es && <span className="ct-br__col">{b.color_name_es}</span>}
                  </h4>
                  <ul className="cn-cat ct-list">
                    {list.map((i) => (
                      <li key={i.id}>
                        {i.doc_id && <span className="ct-doc">{i.doc_id}</span>}
                        <IngIcon ing={i} />
                        <div className="cn-cat__t">
                          <b>
                            {i.name_es} <span className="muted small" lang="en">{i.name_en}</span>
                          </b>
                          <span className="small ct-unlock">
                            {i.unlock_es}
                            {i.needs_review && <span className="badge badge--warn"> Revisar</span>}
                          </span>
                        </div>
                        <Check type="ingredient" id={i.id} done={isDone(i)} label="Conseguido" onChange={(v) => onToggle(i.id, v)} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Section>
        );
      })}
    </div>
  );
}
