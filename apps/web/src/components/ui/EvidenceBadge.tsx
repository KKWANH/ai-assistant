import type { ClaimStatus } from "@ariadne/shared";

const config: Record<
  ClaimStatus,
  { dot: string; label: string; bg: string; text: string }
> = {
  supported: {
    dot: "bg-success",
    label: "Supported",
    bg: "bg-success/10",
    text: "text-success",
  },
  partially_supported: {
    dot: "bg-warning",
    label: "Partial",
    bg: "bg-warning/10",
    text: "text-warning",
  },
  inferred: {
    dot: "bg-info",
    label: "Inferred",
    bg: "bg-info/10",
    text: "text-info",
  },
  unsupported: {
    dot: "bg-destructive",
    label: "Unsupported",
    bg: "bg-destructive/10",
    text: "text-destructive",
  },
};

export interface EvidenceBadgeProps {
  status: ClaimStatus;
  showLabel?: boolean;
  className?: string;
}

export function EvidenceBadge({
  status,
  showLabel = true,
  className = "",
}: EvidenceBadgeProps) {
  const c = config[status];
  return (
    <span
      role="img"
      aria-label={c.label}
      className={[
        "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium",
        c.bg,
        c.text,
        "border border-current/20",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={["h-1.5 w-1.5 rounded-full shrink-0", c.dot].join(" ")}
        aria-hidden="true"
      />
      {showLabel && c.label}
    </span>
  );
}
