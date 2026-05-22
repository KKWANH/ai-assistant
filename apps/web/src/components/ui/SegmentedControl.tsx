/**
 * SegmentedControl — a group of mutually-exclusive choices rendered as a
 * row of pill buttons (language picker, account mode, etc.).
 *
 * Use when you have 2–4 short string options and want them all visible at
 * once instead of hidden behind a select. Generic over the value type so
 * callers keep their string union; the selected option is highlighted with
 * the accent color.
 */
import { useId } from "react";

export interface SegmentedControlOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedControlOption<V>[];
  value: V;
  onChange: (next: V) => void;
  disabled?: boolean;
  /** Accessible name for the whole group (screen readers). */
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
}: SegmentedControlProps<V>) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={["flex gap-2", className].filter(Boolean).join(" ")}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={`${groupId}-${opt.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-accent text-accent-foreground border-accent"
                : "text-foreground border-border hover:border-border-strong hover:bg-surface-3",
              disabled ? "opacity-50 cursor-wait" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
