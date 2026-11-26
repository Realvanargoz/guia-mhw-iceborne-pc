import { Icon, IconSize } from "../../components/Icon";
import type { Ing } from "./types";

export const ingIconSrc = (id: string) => `/icons/ingredients/${id}.webp`;

export function IngIcon({ ing, size = "md" }: { ing: Pick<Ing, "id" | "category" | "name_es" | "name_en" | "icon_url">; size?: IconSize }) {
  if (ing.icon_url) return <Icon kind="ingredient" id={ing.id} size={size} />;
  return (
    <span className={`cn-mark cn-mark--${ing.category}`} aria-hidden title="Sin icono">
      {(ing.name_es || ing.name_en).charAt(0)}
    </span>
  );
}
