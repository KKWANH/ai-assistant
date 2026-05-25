import type { HTMLAttributes } from "react";
import type { ClaimStatus, RunStatus } from "@ariadne/shared";
import styles from "./Badge.module.css";
import { useT } from "../../lib/i18n";
import type { TranslationKey } from "../../lib/i18n/en";

export type BadgeVariant =
  | ClaimStatus
  | RunStatus
  | "sensitive"
  | "large-file"
  | "estimated"
  | "default";

const variantClass: Record<BadgeVariant, string> = {
  supported:           styles["supported"]!,
  partially_supported: styles["partially_supported"]!,
  inferred:            styles["inferred"]!,
  unsupported:         styles["unsupported"]!,
  created:             styles["created"]!,
  scanning:            styles["scanning"]!,
  context_pick:        styles["context_pick"]!,
  generating:          styles["generating"]!,
  completed:           styles["completed"]!,
  failed:              styles["failed"]!,
  sensitive:           styles["sensitive"]!,
  // CSS identifiers cannot contain hyphens, so "large-file" maps to .large_file
  "large-file":        styles["large_file"]!,
  estimated:           styles["estimated"]!,
  default:             styles["default"]!,
};

// variant → i18n key. The values must exist in en.ts (and ko.ts).
// "default" intentionally omitted — callers using default variant
// always pass their own `children` text.
const variantKey: Partial<Record<BadgeVariant, TranslationKey>> = {
  supported:           "badge.status.supported",
  partially_supported: "badge.status.partial",
  inferred:            "badge.status.inferred",
  unsupported:         "badge.status.unsupported",
  created:             "badge.status.created",
  scanning:            "badge.status.scanning",
  context_pick:        "badge.status.contextPick",
  generating:          "badge.status.generating",
  completed:           "badge.status.completed",
  failed:              "badge.status.failed",
  sensitive:           "badge.status.sensitive",
  "large-file":        "badge.status.largeFile",
  estimated:           "badge.status.estimated",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export function Badge({
  variant = "default",
  dot = false,
  className = "",
  children,
  ...props
}: BadgeProps) {
  const { t } = useT();
  const key = variantKey[variant];
  const label = children ?? (key ? t(key) : variant);
  return (
    <span
      className={[
        styles["badge"]!,
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {dot && (
        <span
          className={styles["dot"]!}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
