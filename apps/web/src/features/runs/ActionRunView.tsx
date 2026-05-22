/**
 * ActionRunView — renders a kind="action" Run: a block-pipeline execution.
 *
 * Shows the final output (last successful block) and a per-block timeline.
 * RunDetailView delegates here when run.kind === "action"; it already polls
 * `useRun` while the run is active, so this stays purely presentational.
 */
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import type { Run, Workspace, BlockResult } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";

function BlockCard({
  result,
  index,
  label,
}: {
  result: BlockResult;
  index: number;
  label: string;
}) {
  const icon =
    result.status === "ok" ? (
      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
    ) : result.status === "failed" ? (
      <XCircle className="h-4 w-4 text-destructive shrink-0" />
    ) : (
      <Loader2 className="h-4 w-4 text-accent animate-spin shrink-0" />
    );

  return (
    <Card className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-foreground">
          {(index + 1).toString()}. {label}
        </span>
      </div>
      {result.error && <p className="text-xs text-destructive">{result.error}</p>}
      {result.output && (
        <pre className="text-xs text-foreground/90 whitespace-pre-wrap break-words bg-surface-2 rounded-md p-3 max-h-72 overflow-y-auto">
          {result.output}
        </pre>
      )}
    </Card>
  );
}

export function ActionRunView({
  run,
  workspace,
}: {
  run: Run;
  workspace: Workspace | null;
}) {
  const navigate = useNavigate();
  const { t } = useT();

  const blockLabels: Record<string, string> = {
    ask_ai: t("actionRun.block.askAi"),
    web_analysis: t("actionRun.block.webAnalysis"),
    run_script: t("actionRun.block.runScript"),
    read_file: t("actionRun.block.readFile"),
  };
  const statusLabels: Record<string, string> = {
    created: t("badge.status.created"),
    scanning: t("badge.status.scanning"),
    context_pick: t("badge.status.contextPick"),
    generating: t("badge.status.generating"),
    completed: t("badge.status.completed"),
    failed: t("badge.status.failed"),
  };

  const isActive = run.status === "generating" || run.status === "created";
  const finalOutput =
    [...run.blockResults].reverse().find((b) => b.status === "ok")?.output ?? "";
  const duration =
    run.completedAt && run.startedAt
      ? Math.round(
          (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
        )
      : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
        <button
          onClick={() =>
            navigate(run.workspaceId ? `/workspaces/${run.workspaceId}` : "/workspaces")
          }
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {workspace?.name ?? t("nav.workspaces")}
        </button>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="h-4 w-4 text-accent shrink-0" />
            <h1 className="text-base font-semibold text-foreground truncate">
              {run.templateName}
            </h1>
          </div>
          <Badge variant={run.status} dot>
            {statusLabels[run.status] ?? run.status}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
          {run.model && <span className="font-mono">{run.model}</span>}
          {duration !== null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration.toString()}s
            </span>
          )}
        </div>
        {isActive && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
            {t("actionRun.running")}
          </div>
        )}
        {run.status === "failed" && run.error && (
          <div className="mt-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/5">
            <p className="text-xs text-destructive">{run.error}</p>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-5">
          {run.status === "completed" && finalOutput && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {t("actionRun.result")}
              </h2>
              <Card className="px-4 py-3">
                <pre className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {finalOutput}
                </pre>
              </Card>
            </section>
          )}

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("actionRun.steps")}
            </h2>
            {run.blockResults.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {t("actionRun.starting")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {run.blockResults.map((b, i) => (
                  <BlockCard
                    key={`${b.blockId}-${i.toString()}`}
                    result={b}
                    index={i}
                    label={blockLabels[b.type] ?? b.type}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
