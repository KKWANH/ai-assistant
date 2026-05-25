import type { ClaimStatus } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import type { TranslationKey } from "../../lib/i18n/en";

// Style + label-key per claim status. Labels are now i18n-driven via
// the same badge.status.* keys Badge.tsx uses — keeps "Supported /
// 근거 있음" consistent across both surfaces.
const config: Record<
  ClaimStatus,
  { dot: string; labelKey: TranslationKey; bg: string; text: string }
> = {
  supported: {
    dot: "bg-success",
    labelKey: "badge.status.supported",
    bg: "bg-success/10",
    text: "text-success",
  },
  partially_supported: {
    dot: "bg-warning",
    labelKey: "badge.status.partial",
    bg: "bg-warning/10",
    text: "text-warning",
  },
  inferred: {
    dot: "bg-info",
    labelKey: "badge.status.inferred",
    bg: "bg-info/10",
    text: "text-info",
  },
  unsupported: {
    dot: "bg-destructive",
    labelKey: "badge.status.unsupported",
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
  const { t } = useT();
  const c = config[status];
  const label = t(c.labelKey);
  return (
    <span
      role="img"
      aria-label={label}
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
      {showLabel && label}
    </span>
  );
}
