/**
 * Skeleton placeholder — for content-shaped loading.
 *
 * Prefer over a generic spinner when the consumer has a known layout
 * (KPI card, table row, chart). The shimmer animation is defined in
 * globals.css `.skeleton`; reduced-motion disables the sweep but keeps
 * a faded fill so screens still feel "something here".
 */
import { type CSSProperties, type ReactNode } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  rounded?: "sm" | "md" | "lg" | "full";
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width,
  height = 12,
  rounded = "md",
  className = "",
  style,
}: SkeletonProps) {
  const radius =
    rounded === "full" ? 9999 : rounded === "lg" ? 10 : rounded === "sm" ? 4 : 6;
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width ?? "100%",
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

/** Generic "lines of text" skeleton — handy for paragraph areas. */
export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ["100%", "92%", "78%", "85%", "70%"];
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} height={10} />
      ))}
    </div>
  );
}

/** Card-shaped skeleton — title row + content lines + optional footer. */
export function SkeletonCard({
  title = true,
  lines = 3,
  footer = false,
  children,
}: {
  title?: boolean;
  lines?: number;
  footer?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="p-3 border border-border rounded-lg bg-card flex flex-col gap-2">
      {title && <Skeleton width="55%" height={14} />}
      {children ?? <SkeletonLines lines={lines} />}
      {footer && <Skeleton width="40%" height={10} />}
    </div>
  );
}
