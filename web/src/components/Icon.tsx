import { memo, useState } from "react";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | number;
export const ICON_PX: Record<string, number> = { xs: 16, sm: 24, md: 32, lg: 48, xl: 64 };

export type IconKind = "monster" | "item" | "decoration" | "equip" | "ui" | "ingredient";

/** Failed URLs are remembered so a broken icon is never requested twice (module-wide). */
const failed = new Set<string>();

export function iconUrl(p: { kind: IconKind; id?: string | number | null; type?: string | null; rarity?: number | null; name?: string | null }): string | null {
  const { kind, id, type, rarity, name } = p;
  switch (kind) {
    case "monster":
      return id != null ? `/icons/monsters/${id}.webp` : null;
    case "item":
      return id != null ? `/icons/items/${id}.webp` : null;
    case "ingredient":
      return id != null ? `/icons/ingredients/${id}.webp` : null;
    case "decoration":
      return id != null ? `/icons/decorations/${id}.webp` : null;
    case "equip": {
      if (!type) return null;
      const r = Math.max(1, Math.min(12, Math.round(rarity ?? 1)));
      return `/icons/equip/${type}-${r}.webp`;
    }
    case "ui":
      return name ? `/icons/ui-named/${name}.webp` : null;
  }
}

export type IconProps = {
  kind: IconKind;
  /** monster / item / decoration id */
  id?: string | number | null;
  /** equip: weapon_type or armor type (head, chest, arms, waist, legs, charm, armorset) */
  type?: string | null;
  /** equip: rarity 1-12 */
  rarity?: number | null;
  /** ui: ui-named file name (element-fire, weapon-bow, crown-gold, ...) */
  name?: string | null;
  size?: IconSize;
  /** Real alt text. Omit for decorative icons (alt=""). */
  alt?: string;
  /** Put the icon on a small dark rounded tile (for white/light glyphs). */
  tile?: boolean;
  className?: string;
  title?: string;
};

function IconBase({ size = "sm", alt, tile, className = "", title, ...p }: IconProps) {
  const px = typeof size === "number" ? size : ICON_PX[size] ?? 24;
  const url = iconUrl(p);
  const [bad, setBad] = useState(() => (url ? failed.has(url) : true));
  const cls = `icon icon--${p.kind}${tile ? " icon--tile" : ""}${className ? " " + className : ""}`;
  const style = { width: px, height: px };
  if (!url || bad) {
    return <span className={`${cls} icon--missing`} style={style} role={alt ? "img" : undefined} aria-label={alt} aria-hidden={alt ? undefined : true} title={title} />;
  }
  return (
    <img
      className={cls}
      src={url}
      width={px}
      height={px}
      style={style}
      alt={alt ?? ""}
      title={title}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        failed.add(url);
        setBad(true);
      }}
    />
  );
}

export const Icon = memo(IconBase);

/** Derive an icon for an entity link/row from the `type`+`id` used by entityPath. `sub` = armor/weapon type, `rarity` for equip. */
export function EntityIcon({
  type,
  id,
  sub,
  rarity,
  size = "sm",
  alt,
}: {
  type: string;
  id?: string | number | null;
  sub?: string | null;
  rarity?: number | null;
  size?: IconSize;
  alt?: string;
}) {
  switch (type) {
    case "monster":
      return <Icon kind="monster" id={id} size={size} alt={alt} />;
    case "item":
      return <Icon kind="item" id={id} size={size} alt={alt} />;
    case "decoration":
      return <Icon kind="decoration" id={id} size={size} alt={alt} />;
    case "weapon":
    case "armor":
      return sub ? <Icon kind="equip" type={sub} rarity={rarity} size={size} alt={alt} /> : null;
    case "armor_set":
      return rarity != null ? <Icon kind="equip" type="armorset" rarity={rarity} size={size} alt={alt} /> : <Icon kind="ui" name="armor-armorset" tile size={size} alt={alt} />;
    case "charm":
      return rarity != null ? <Icon kind="equip" type="charm" rarity={rarity} size={size} alt={alt} /> : <Icon kind="ui" name="armor-charm" tile size={size} alt={alt} />;
    default:
      return null;
  }
}
