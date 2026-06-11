/**
 * Dedicated workspace-history page — `/workspaces/:id/history`.
 *
 * The compact list on the workspace overview only shows the most recent
 * 12 commits without expansion. This view shows the full list, with each
 * row expandable into a side-by-side diff of every changed file using
 * the same FileRow renderer the staged-diff and attempt-diff views use.
 *
 * Apply commits get the Rewind button beside the timestamp; opening the
 * row lazy-loads the per-commit diff so a long history doesn't pay the
 * cost of N parallel git invocations up front.
 */
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronDown, ChevronRight, GitCommit, Undo2 } from "lucide-react";
import type { StagedFile } from "@ariadne/shared";
import {
  useWorkspace,
  useWorkspaceHistory,
  useCommitDetail,
  useRewindWorkspaceCommit,
} from "../../lib/queries";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useT } from "../../lib/i18n";
import { FileRow } from "../runs/diffRender";
import type { CommitFileChange } from "../../lib/api";

const FULL_HISTORY_LIMIT = 200;

export function HistoryView() {
  const { id: workspaceId = "" } = useParams<{ id: string }>();
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: commits } = useWorkspaceHistory(workspaceId, FULL_HISTORY_LIMIT);
  const rewind = useRewindWorkspaceCommit();
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggleRow = (sha: string) =>
    setExpanded((prev) => (prev === sha ? null : sha));

  const doRewind = async (sha: string) => {
    if (!(await confirm({ message: t("workspace.history.rewindConfirm"), danger: true }))) return;
    try {
      const result = await rewind.mutateAsync({ workspaceId, sha });
      toast({
        title: t("workspace.history.rewindSuccess", { n: result.restored.length }),
        variant: "success",
      });
    } catch (err) {
      toast({
        title: t("workspace.history.rewindFailed"),
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  return (
    <div className="px-5 py-5 max-w-5xl mx-auto flex flex-col gap-4">
      <PageHeader
        icon={<GitCommit className="h-5 w-5" />}
        title={t("workspace.history.pageTitle")}
        description={workspace?.name ?? ""}
        breadcrumb={
          <Link
            to={`/workspaces/${workspaceId}`}
            className="hover:text-foreground transition-colors"
          >
            ← {workspace?.name ?? t("nav.workspaces")}
          </Link>
        }
      />

      {!commits || commits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("workspace.history.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {commits.map((c) => (
            <CommitCard
              key={c.sha}
              workspaceId={workspaceId}
              sha={c.sha}
              shortSha={c.shortSha}
              message={c.message}
              timestamp={c.timestamp}
              filesChanged={c.filesChanged}
              applyRunId={c.applyRunId}
              isExpanded={expanded === c.sha}
              onToggle={() => toggleRow(c.sha)}
              onRewind={() => void doRewind(c.sha)}
              rewindBusy={rewind.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommitCard({
  workspaceId,
  sha,
  shortSha,
  message,
  timestamp,
  filesChanged,
  applyRunId,
  isExpanded,
  onToggle,
  onRewind,
  rewindBusy,
}: {
  workspaceId: string;
  sha: string;
  shortSha: string;
  message: string;
  timestamp: string;
  filesChanged: number;
  applyRunId: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  onRewind: () => void;
  rewindBusy: boolean;
}) {
  const { t } = useT();
  const { data: detail, isLoading } = useCommitDetail(
    workspaceId,
    isExpanded ? sha : null,
  );
  // Each expandable file gets its own open/close — but in the history
  // page the diff is read-only and we keep it minimal: clicking the
  // file row expands its diff. No checkboxes (no apply on past commits).
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-mono text-2xs text-muted-foreground shrink-0">
            {shortSha}
          </span>
          <span className="text-sm text-foreground truncate flex-1">{message}</span>
          <span className="text-2xs text-muted-foreground shrink-0">
            {filesChanged > 0
              ? t("workspace.history.filesChanged", { n: filesChanged })
              : ""}
          </span>
          <span className="text-2xs text-muted-foreground shrink-0">
            {new Date(timestamp).toLocaleString()}
          </span>
        </button>
        {applyRunId && (
          <button
            type="button"
            onClick={onRewind}
            disabled={rewindBusy}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            aria-label={t("workspace.history.rewind")}
            title={t("workspace.history.rewind")}
          >
            <Undo2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="border-t border-border bg-surface-2 px-3 py-2 flex flex-col gap-2">
          {isLoading && (
            <p className="text-xs text-muted-foreground py-2">{t("common.loading")}</p>
          )}
          {detail && detail.files.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              {t("workspace.history.noFiles")}
            </p>
          )}
          {detail?.files.map((f) => {
            const staged = commitChangeToStaged(f);
            const openKey = `${sha}:${f.path}`;
            return (
              <FileRow
                key={openKey}
                file={staged}
                // Past commits aren't selectable; the checkbox is just
                // visual + disabled.
                checked={false}
                disabled
                isExpanded={openFiles.has(openKey)}
                onToggle={() => { /* read-only */ }}
                onToggleExpand={() => {
                  setOpenFiles((prev) => {
                    const next = new Set(prev);
                    if (next.has(openKey)) next.delete(openKey);
                    else next.add(openKey);
                    return next;
                  });
                }}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Convert a CommitFileChange into the StagedFile shape FileRow expects. */
function commitChangeToStaged(f: CommitFileChange): StagedFile {
  return {
    path: f.path,
    action: f.action,
    before: f.before,
    after: f.after,
    diff: f.diff,
  };
}
