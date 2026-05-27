/**
 * EmptyState — consistent "no data" placeholder.
 *
 * Pre-AV every empty case used a different inline format
 * ("No conversations" muted text, an icon + label combo, etc.). This
 * gives the user a clear visual: icon → title → hint → optional action.
 *
 * Keep copy short. The hint is a one-liner pointing the user toward
 * the next step.
 */
import { type ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  /** Compact variant — used in sidebars / narrow panes. */
  compact?: boolean;
}

export function EmptyState({ icon, title, hint, action, compact }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center text-center animate-fade-in ${
        compact ? "py-4 gap-1.5" : "py-10 gap-2 px-4"
      }`}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-surface-2 text-muted-foreground ${
          compact ? "w-8 h-8" : "w-12 h-12"
        }`}
      >
        {icon}
      </div>
      <div className={`text-foreground font-medium ${compact ? "text-xs" : "text-sm"}`}>
        {title}
      </div>
      {hint && (
        <div className={`text-muted-foreground ${compact ? "text-2xs" : "text-xs"}`}>
          {hint}
        </div>
      )}
      {action && <div className={compact ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  );
}
