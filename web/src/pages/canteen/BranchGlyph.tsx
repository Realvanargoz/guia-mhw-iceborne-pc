import type { CSSProperties } from "react";
import { brKey } from "./types";

/**
 * A branch glyph (/ui/canteen/branch-<id>.svg) drawn as a CSS mask filled with currentColor, so the SVG's internal mask
 * ids never collide in the DOM. Decorative: the branch name is always printed next to it.
 */
export function BranchGlyph({ branch, size = 18, className = "" }: { branch: string | null | undefined; size?: number; className?: string }) {
  const style = { "--gs": `${size}px` } as CSSProperties;
  return <span className={`cs-glyph ${className}`.trim()} data-br={brKey(branch)} style={style} aria-hidden />;
}
