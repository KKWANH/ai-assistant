/**
 * GitPanel — the workspace's own git repo, in-app (P3 IDE #8). Branch + changed
 * files with status badges, a unified diff for the selected file, and a message
 * box to stage + commit the checked files. Reads use git/status + git/diff;
 * Commit posts git/commit. Workspaces that aren't a repo get an empty state.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, GitCommit, RefreshCw, FileText } from "lucide-react";
import { useGitStatus, useGitCommit } from "../../lib/queries";
import { getGitDiff, type GitFileStatus } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";

const KIND_STYLES: Record<GitFileStatus["kind"], { badge: string; cls: string }> = {
  modified: { badge: "M", cls: "text-warning" },
  added: { badge: "A", cls: "text-success" },
  deleted: { badge: "D", cls: "text-destructive" },
  untracked: { badge: "U", cls: "text-info" },
  renamed: { badge: "R", cls: "text-info" },
  conflicted: { badge: "!", cls: "text-destructive" },
};

/** Render a unified-diff string with +/-/@@ line coloring. */
function UnifiedDiff({ diff }: { diff: string }) {
  return (
    <pre className="text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
      {diff.split("\n").map((line, i) => {
        let cls = "text-foreground";
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index "))
          cls = "text-muted-foreground/60";
        else if (line.startsWith("@@")) cls = "text-info";
        else if (line.startsWith("+")) cls = "text-success bg-success/5";
        else if (line.startsWith("-")) cls = "text-destructive bg-destructive/5";
        else cls = "text-muted-foreground";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function GitPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const status = useGitStatus(workspaceId);
  const commit = useGitCommit(workspaceId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const files = status.data?.files ?? [];

  // Default-select every changed file whenever the change set shifts.
  const fileKey = files.map((f) => f.path).join("|");
  useEffect(() => {
    setSelected(new Set(fileKey ? fileKey.split("|") : []));
  }, [fileKey]);

  // A staged-only file's working-tree diff is empty, so view its staged diff.
  const viewingFile = files.find((f) => f.path === viewing);
  const viewStaged = viewingFile ? viewingFile.staged && !viewingFile.unstaged : false;
  const diffQuery = useQuery({
    queryKey: ["git-diff", workspaceId, viewing, viewStaged] as const,
    queryFn: () => getGitDiff(workspaceId, viewing!, viewStaged),
    enabled: !!viewing,
  });

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleCommit = async () => {
    try {
      const res = await commit.mutateAsync({ message: message.trim(), paths: Array.from(selected) });
      toast({ title: t("git.committed", { sha: res.sha?.slice(0, 7) ?? "" }), variant: "success" });
      setMessage("");
      setViewing(null);
    } catch (err) {
      toast({
        title: t("git.commitFailed"),
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  if (status.isLoading) {
    return <p className="text-xs text-muted-foreground p-4">{t("common.loading")}</p>;
  }

  if (!status.data?.isRepo) {
    return (
      <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
        <GitBranch className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{t("git.notRepo")}</p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {/* Branch + sync state */}
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="h-4 w-4 text-accent" />
        <span className="font-medium">{status.data.branch ?? t("git.detached")}</span>
        {(status.data.ahead > 0 || status.data.behind > 0) && (
          <span className="text-2xs text-muted-foreground">
            {status.data.ahead > 0 ? `↑${status.data.ahead}` : ""}
            {status.data.behind > 0 ? ` ↓${status.data.behind}` : ""}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          loading={status.isFetching}
          onClick={() => void status.refetch()}
          className="ml-auto"
        >
          {t("git.refresh")}
        </Button>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{t("git.clean")}</p>
      ) : (
        <>
          {/* Changed files */}
          <div className="rounded-lg border border-border divide-y divide-border">
            {files.map((f) => {
              const k = KIND_STYLES[f.kind];
              return (
                <div
                  key={f.path}
                  className={[
                    "flex items-center gap-2 px-2.5 py-1.5 text-xs",
                    viewing === f.path ? "bg-surface-2" : "",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                    className="accent-accent h-3.5 w-3.5"
                  />
                  <span
                    className={["font-mono font-bold w-3 text-center shrink-0", k.cls].join(" ")}
                    title={f.kind}
                  >
                    {k.badge}
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewing(f.path)}
                    className="flex-1 text-left font-mono truncate hover:text-accent"
                    title={f.path}
                  >
                    {f.path}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Diff for the selected file */}
          {viewing && (
            <div className="rounded-lg border border-border bg-card p-3 max-h-[40vh] overflow-y-auto">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <FileText className="h-3.5 w-3.5" />
                <span className="font-mono">{viewing}</span>
              </div>
              {diffQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
              ) : diffQuery.data?.diff ? (
                <UnifiedDiff diff={diffQuery.data.diff} />
              ) : (
                <p className="text-xs text-muted-foreground italic">{t("git.noDiff")}</p>
              )}
            </div>
          )}

          {/* Commit */}
          <div className="flex flex-col gap-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("git.messagePlaceholder")}
              className="h-20 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">
                {t("git.selectedN", { n: String(selected.size) })}
              </span>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<GitCommit className="h-3.5 w-3.5" />}
                loading={commit.isPending}
                disabled={!message.trim() || selected.size === 0}
                onClick={() => void handleCommit()}
              >
                {t("git.commit")}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
