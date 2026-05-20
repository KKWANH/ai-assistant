import type { HTMLAttributes } from "react";
import type { ClaimStatus, RunStatus } from "@ariadne/shared";
import styles from "./Badge.module.css";

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

const variantLabels: Partial<Record<BadgeVariant, string>> = {
  supported: "Supported",
  partially_supported: "Partial",
  inferred: "Inferred",
  unsupported: "Unsupported",
  created: "Created",
  scanning: "Scanning",
  context_pick: "Context Pick",
  generating: "Generating",
  completed: "Completed",
  failed: "Failed",
  sensitive: "Sensitive",
  "large-file": "Large File",
  estimated: "Estimated",
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
  const label = children ?? variantLabels[variant] ?? variant;
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
