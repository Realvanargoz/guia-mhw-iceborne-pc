import { Crown } from "../../../components/book";
import { Tier, TIER_NAME } from "../planState";
import { StepProps, skillLabel } from "./common";

const TIER_HELP: Record<Tier, string> = {
  1: "Primarias: no se negocian. El constructor no las sacrifica, ni siquiera si hay que renunciar a otras.",
  2: "Secundarias: se intentan cumplir, pero pueden bajar de nivel o quedarse fuera si faltan ranuras.",
  3: "Terciarias: solo si sobra ranura después de cubrir las demás.",
};
const TIERS: Tier[] = [1, 2, 3];
const CROWN: Record<Tier, "gold" | "silver" | "mini"> = { 1: "gold", 2: "silver", 3: "mini" };

export default function Prioridades({ state, dispatch, skills, go }: StepProps) {
  return (
    <div className="pl-stack">
      <p className="pl-lead">
        Clasifica cada habilidad según el método: lo que no se puede perder, lo que se prefiere y lo que solo cabe si sobra sitio. El orden dentro de
        cada lista también cuenta.
      </p>
      {state.targets.length === 0 && <p className="pl-empty">No hay habilidades que clasificar. Añádelas en el paso Habilidades.</p>}
      {TIERS.map((tier) => {
        const items = state.targets.filter((t) => t.tier === tier);
        const hid = `pl-tier-${tier}`;
        return (
          <section key={tier} className={`pl-card pl-tier pl-tier--${tier}`} aria-labelledby={hid}>
            <h3 id={hid} className="pl-h3 pl-tier__h">
              <Crown kind={CROWN[tier]} size={24} />
              {TIER_NAME[tier]}s <span className="pl-count">{items.length}</span>
            </h3>
            <p className="pl-muted">{TIER_HELP[tier]}</p>
            {items.length === 0 ? (
              <p className="pl-empty pl-empty--s">Vacía.</p>
            ) : (
              <ol className="pl-list">
                {items.map((t, i) => {
                  const name = skillLabel(skills, t.skill_id);
                  return (
                    <li key={t.skill_id} className="pl-row-item">
                      <span className="pl-row-item__main">
                        <b className="pl-row-item__n">
                          {name} <span className="pl-lv">nivel {t.level}</span>
                        </b>
                      </span>
                      <label className="pl-tiersel">
                        <span className="pl-sr">Prioridad de {name}</span>
                        <select value={t.tier} onChange={(e) => dispatch({ type: "setTier", skill_id: t.skill_id, tier: Number(e.target.value) as Tier })}>
                          {TIERS.map((n) => (
                            <option key={n} value={n}>
                              {TIER_NAME[n]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="pl-moves">
                        <button type="button" aria-label={`Subir ${name} en la lista de ${TIER_NAME[tier].toLowerCase()}s`} disabled={i === 0} onClick={() => dispatch({ type: "moveTarget", skill_id: t.skill_id, dir: -1 })}>
                          ↑
                        </button>
                        <button type="button" aria-label={`Bajar ${name} en la lista de ${TIER_NAME[tier].toLowerCase()}s`} disabled={i === items.length - 1} onClick={() => dispatch({ type: "moveTarget", skill_id: t.skill_id, dir: 1 })}>
                          ↓
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
      <p className="pl-skip">
        <button type="button" className="pl-linkbtn" onClick={() => go("armadura")}>
          Siguiente: armadura
        </button>
      </p>
    </div>
  );
}
