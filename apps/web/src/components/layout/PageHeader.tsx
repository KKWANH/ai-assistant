/**
 * PageHeader — shared header for non-chat screens.
 * Title + one-line description + optional primary action button.
 */
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Optional icon placed before the title */
  icon?: ReactNode;
  /** Optional breadcrumb path shown above the title */
  breadcrumb?: ReactNode;
}

export function PageHeader({
  title,
  description,
  action,
  icon,
  breadcrumb,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b border-border mb-5">
      <div className="flex flex-col gap-0.5 min-w-0">
        {breadcrumb && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
            {breadcrumb}
          </div>
        )}
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2 min-w-0">
          {icon && (
            <span className="shrink-0 text-muted-foreground">{icon}</span>
          )}
          {/* String titles get plain truncation; ReactNode titles handle their own
              layout (e.g. an inline rename pencil that must stay visible). */}
          {typeof title === "string" ? (
            <span className="truncate">{title}</span>
          ) : (
            <span className="min-w-0 flex items-center">{title}</span>
          )}
        </h1>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="shrink-0 flex items-center gap-2">{action}</div>
      )}
    </div>
  );
}
