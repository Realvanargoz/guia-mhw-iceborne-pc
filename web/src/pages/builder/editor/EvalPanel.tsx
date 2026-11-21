import { DefenseBox, Resistances, SkillList } from "../../../components/BuildView";
import { Empty, ErrorBox, OrnateHeader } from "../../../components/ui";
import { EvalResult, SLOT_ES } from "../../../build";

export default function EvalPanel({ ev, evErr, evBusy }: { ev: EvalResult | null; evErr: string | null; evBusy: boolean }) {
  return (
        <aside className="bd-res" aria-live="polite">
          <OrnateHeader as="h2" className="ohead--red" aside={evBusy ? <span className="bd-spin" aria-label="Calculando" /> : undefined}>
            Resultado
          </OrnateHeader>
          {!ev && !evErr && !evBusy && <Empty>Elige alguna pieza o carga una recomendación para ver las habilidades.</Empty>}
          {evErr && <ErrorBox error={evErr} />}
          {!ev && evBusy && (
            <div className="bg-skel">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="bg-skel__row bg-skel__row--s" />
              ))}
            </div>
          )}
          {ev && (
            <div className={evBusy ? "bd-res__in bd-res__in--busy" : "bd-res__in"}>
              <h3 className="bd-h">Habilidades</h3>
              <SkillList skills={ev.skills.map((s) => ({ ...s, name_es: s.name_es }))} empty="Sin habilidades activas." />
              {ev.set_bonuses.length > 0 && (
                <>
                  <h3 className="bd-h">Bonos de set</h3>
                  <ul className="bg-bonus">
                    {ev.set_bonuses.map((b, i) => (
                      <li key={i} className={b.active ? "on" : ""}>
                        <b>{b.name_es}</b> · {b.skill_es}{" "}
                        <small>
                          ({b.pieces}/{b.required} piezas{b.active ? ", activo" : ""})
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h3 className="bd-h">Defensa</h3>
              <DefenseBox d={ev.defense} />
              <h3 className="bd-h">Resistencias</h3>
              <Resistances res={ev.resistances} />
              <h3 className="bd-h">Ranuras</h3>
              <p className="bd-slotsum">
                {typeof ev.slots_used === "number" ? ev.slots_used : ev.slots_used.length} usadas de {ev.slots_total.length}.{" "}
                {ev.slots_free.length ? (
                  <>
                    Libres:{" "}
                    {ev.slots_free.map((s, i) => (
                      <i key={i} className={`bv-gem bv-gem--${s.size} bv-gem--sm`} title={SLOT_ES[s.piece]}>
                        {s.size}
                      </i>
                    ))}
                  </>
                ) : (
                  "Sin ranuras libres."
                )}
              </p>
              {ev.warnings.length > 0 && (
                <div className="bg-warn">
                  <b>Avisos</b>
                  <ul>
                    {ev.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>
  );
}
