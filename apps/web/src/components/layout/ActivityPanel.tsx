/**
 * Activity tab — live background tasks (template / action runs). Content-only;
 * the docking shell + tab bar live in SidePanel. Polls the runs list so
 * in-progress work stays visible alongside chat. Active runs sort to the top.
 */
import { useNavigate } from "react-router-dom";
import { Activity as ActivityIcon, Loader2 } from "lucide-react";
import type { Run, RunStatus } from "@ariadne/shared";
import { useRuns } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Badge } from "../ui/Badge";

const ACTIVE_STATUSES: RunStatus[] = ["created", "scanning", "context_pick", "generating"];
const isActive = (r: Run): boolean => ACTIVE_STATUSES.includes(r.status);

/** Short status labels for the pills (technical; kept terse rather than i18n'd). */
const STATUS_LABEL: Record<RunStatus, string> = {
  created: "queued",
  scanning: "scanning",
  context_pick: "awaiting",
  generating: "running",
  completed: "done",
  failed: "failed",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s.toString()}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m.toString()}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h.toString()}h`;
  return `${Math.round(h / 24).toString()}d`;
}

export function ActivityPanel() {
  const { t } = useT();
  const navigate = useNavigate();
  // Poll while mounted so in-progress runs update live.
  const { data: runs } = useRuns(undefined, { refetchInterval: 3000 });

  const sorted = [...(runs ?? [])]
    .sort((a, b) => {
      const byActive = (isActive(a) ? 0 : 1) - (isActive(b) ? 0 : 1);
      if (byActive !== 0) return byActive;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 30);
  const activeCount = (runs ?? []).filter(isActive).length;

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <ActivityIcon className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{t("activity.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {activeCount > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 text-2xs text-muted-foreground border-b border-inspector-border">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("activity.running", { n: activeCount })}
        </div>
      )}
      {sorted.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => navigate(`/runs/${r.id}`)}
          className="flex flex-col gap-1.5 px-3 py-2.5 border-b border-inspector-border text-left hover:bg-foreground/5 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground truncate">{r.templateName}</span>
            <span className="text-2xs text-muted-foreground shrink-0">{relTime(r.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={r.status} dot>{STATUS_LABEL[r.status]}</Badge>
            <span className="text-2xs text-muted-foreground">{r.kind}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
