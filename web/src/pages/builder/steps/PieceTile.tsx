/* Base compartida del asistente: pieza con el aspecto de «Probar» (placa oscura, ranuras, chips de habilidad). */
import { ReactNode } from "react";
import { OwnedBadge, SlotRow } from "../../../components/BuildView";
import { EntityIcon, Icon } from "../../../components/Icon";

export type PieceTileSkill = { name: string; level: number; hit?: boolean };
export type PieceTileProps = {
  /** head | chest | arms | waist | legs | charm | weapon … */
  slot: string;
  rarity?: number | null;
  name?: string | null;
  /** Etiqueta de la parte (p. ej. «Yelmo»). */
  part?: string;
  /** Línea secundaria: conjunto · rango · defensa máx. */
  meta?: ReactNode;
  slots?: number[];
  /** Contenido por ranura (misma posición que `slots`); si falta, la ranura se muestra libre. */
  jewels?: ReactNode[];
  skills?: PieceTileSkill[];
  role?: "aporta" | "activa" | null;
  roleText?: string;
  owned?: boolean | null;
  actions?: ReactNode;
  selected?: boolean;
};

const ROLE_TXT = { aporta: "Aporta a tus objetivos", activa: "Solo activa el bono" } as const;

export default function PieceTile({ slot, rarity, name, part, meta, slots = [], jewels: jewelsProp, skills = [], role = null, roleText, owned, actions, selected }: PieceTileProps) {
  const empty = !name;
  // Sin `jewels` (p. ej. al elegir bono de set) solo se muestra el tamaño de la ranura, sin el texto «Libre».
  const jewels = jewelsProp ?? [];
  const noJewelInfo = jewelsProp === undefined;
  return (
    <div className={`pl-ptile${selected ? " pl-ptile--sel" : ""}`}>
      <div className="pl-ptile__head">
        <span className="pl-ptile__ico" aria-hidden>
          {empty ? <Icon kind="ui" name={`armor-${slot}`} tile size="lg" alt="" /> : <EntityIcon type="armor" sub={slot} rarity={rarity} size="lg" alt="" />}
        </span>
        <div className="pl-ptile__t">
          {part && <span className="pl-ptile__part">{part}</span>}
          <b className="pl-ptile__n" title={name ?? undefined}>
            {name ?? "Sin elegir"}
          </b>
          {meta != null && <span className="pl-ptile__meta">{meta}</span>}
        </div>
        {owned === true && <OwnedBadge />}
        {owned === false && <span className="pl-tag">No la tienes</span>}
      </div>
      {slots.length > 0 && (
        <div className="pl-ptile__slots">
          {slots.map((sz, i) => (
            <SlotRow key={i} size={sz}>
              {noJewelInfo ? <></> : jewels[i]}
            </SlotRow>
          ))}
        </div>
      )}
      {skills.length > 0 && (
        <ul className="pl-ptile__sk" aria-label="Habilidades que aporta">
          {skills.map((k) => (
            <li key={k.name} className={`pl-ptile__chip${k.hit ? " pl-ptile__chip--hit" : ""}`}>
              {k.hit && <span aria-hidden>✓</span>}
              {k.name} <b>+{k.level}</b>
            </li>
          ))}
        </ul>
      )}
      {role && (
        <p className={`pl-ptile__role pl-ptile__role--${role}`}>
          <span aria-hidden>{role === "aporta" ? "✓" : "◆"}</span>
          {roleText ?? ROLE_TXT[role]}
        </p>
      )}
      {actions && <div className="pl-ptile__act">{actions}</div>}
    </div>
  );
}
