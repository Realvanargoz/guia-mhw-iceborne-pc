import { ReactNode, useId } from "react";
import { useRovingKeys } from "../../components/ui";

/** Segmented single choice (radiogroup, roving focus with the arrow keys). */
export function Seg<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = "",
  hideLabel = false,
}: {
  label: string;
  options: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  hideLabel?: boolean;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const lid = useId();
  const onKeyDown = useRovingKeys(options.length, idx, (i) => onChange(options[i].id), true);
  return (
    <div className={`cs-segf ${className}`.trim()}>
      <span className={hideLabel ? "sr-only" : "cs-segf__label"} id={lid}>
        {label}
      </span>
      <div className="cs-seg" role="radiogroup" aria-labelledby={lid} onKeyDown={onKeyDown}>
        {options.map((o, i) => (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            tabIndex={i === idx ? 0 : -1}
            className={o.id === value ? "on" : undefined}
            title={o.title}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
