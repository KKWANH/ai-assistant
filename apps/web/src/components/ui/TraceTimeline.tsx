import { useState } from "react";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { TraceEvent } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import type { TranslationKey } from "../../lib/i18n/en";

const PHASE_KEYS: Record<string, TranslationKey> = {
  scan: "trace.phase.scan",
  manifest: "trace.phase.manifest",
  candidate_select: "trace.phase.candidateSelect",
  context_approved: "trace.phase.contextApproved",
  focused_read: "trace.phase.focusedRead",
  brief: "trace.phase.brief",
  claims: "trace.phase.claims",
  evidence: "trace.phase.evidence",
  unsupported: "trace.phase.unsupported",
  diff: "trace.phase.diff",
  artifacts: "trace.phase.artifacts",
};

function StatusIcon({ status, t }: { status: TraceEvent["status"]; t: (key: TranslationKey) => string }) {
  if (status === "ok")
    return <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" aria-label={t("trace.status.completed")} />;
  if (status === "failed")
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label={t("trace.status.failed")} />;
  return <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" aria-label={t("trace.status.running")} />;
}

export interface TraceTimelineProps {
  events: TraceEvent[];
  className?: string;
}

export function TraceTimeline({ events, className = "" }: TraceTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { t } = useT();
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("trace.noEvents")}
      </p>
    );
  }

  return (
    <ol
      className={["space-y-0", className].join(" ")}
      aria-label={t("trace.ariaLabel")}
    >
      {events.map((ev, i) => {
        const isExpanded = expanded.has(i);
        const phaseKey = PHASE_KEYS[ev.phase];
        const label = phaseKey ? t(phaseKey) : ev.label;
        const ts = new Date(ev.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <li key={i} className="relative flex gap-3">
            {/* Connector line */}
            {i < events.length - 1 && (
              <span
                className="absolute left-[6px] top-5 bottom-0 w-px bg-border"
                aria-hidden="true"
              />
            )}
            <div className="mt-1 shrink-0">
              <StatusIcon status={ev.status} t={t} />
            </div>
            <div className="flex-1 pb-3 min-w-0">
              <button
                onClick={() => ev.details && toggle(i)}
                className={[
                  "w-full text-left flex items-center gap-2",
                  ev.details ? "cursor-pointer" : "cursor-default",
                ].join(" ")}
                aria-expanded={ev.details ? isExpanded : undefined}
              >
                <span className="text-xs font-medium text-foreground flex-1 truncate">
                  {label}
                </span>
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {ts}
                </span>
                {ev.details &&
                  (isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  ))}
              </button>
              {isExpanded && ev.details && (
                <pre className="mt-1.5 text-xs font-mono text-muted-foreground bg-surface-2 rounded-md px-3 py-2 overflow-x-auto border border-border whitespace-pre-wrap">
                  {ev.details}
                </pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
