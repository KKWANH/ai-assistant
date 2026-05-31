/**
 * Spinner — single canonical loader used app-wide.
 *
 * Pre-AV the codebase had ~5 ad-hoc spinners with different sizes /
 * colours / aria semantics. This consolidates them. Sizes match the
 * existing pattern (sm / md / lg). The brand variant uses the accent
 * colour; muted uses the muted-foreground for low-emphasis spots like
 * inline list-row pending states.
 */
import { type CSSProperties } from "react";

export interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "brand" | "muted";
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const SIZE_PX: Record<NonNullable<SpinnerProps["size"]>, number> = {
  xs: 12,
  sm: 16,
  md: 24,
  lg: 36,
};

export function Spinner({
  size = "md",
  variant = "brand",
  label,
  className = "",
  style,
}: SpinnerProps) {
  const px = SIZE_PX[size];
  const ringColor = variant === "brand" ? "rgb(var(--accent))" : "rgb(var(--muted-foreground))";
  return (
    <span
      role={label ? "status" : "presentation"}
      aria-label={label}
      aria-live={label ? "polite" : undefined}
      className={`inline-block align-middle ${className}`}
      style={{ width: px, height: px, ...style }}
    >
      <svg
        viewBox="0 0 24 24"
        width={px}
        height={px}
        fill="none"
        style={{ animation: "ariadne-spin 0.9s linear infinite" }}
      >
        <circle cx="12" cy="12" r="10" stroke={ringColor} strokeOpacity={0.18} strokeWidth={3} />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke={ringColor}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Full-viewport centered spinner for page-level loading. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px]">
      <div className="flex flex-col items-center gap-2">
        <Spinner size="lg" label={label ?? "Loading"} />
        {label && <span className="text-xs text-muted-foreground animate-pulse-soft">{label}</span>}
      </div>
    </div>
  );
}
