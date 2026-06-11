/**
 * Attempt diff review — `/attempts/:id/diff`. Twin of StagedDiffView
 * but keyed on attempt id (so it covers the agent-staged path, where
 * there's no Run to attach to).
 *
 * Apply moves the attempt to status="applied" + commits to workspace
 * history; Abandon wipes the staged tree + marks "abandoned". The
 * chat that owns the attempt shows the corresponding status from its
 * open-attempt chip.
 */
import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { GitCommit, Trash2, Check, Bot } from "lucide-react";
import { useAttempt, useApplyAttempt, useAbandonAttempt } from "../../lib/queries";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useT } from "../../lib/i18n";
import { FileRow } from "./diffRender";

export function AttemptDiffView() {
  const { id: attemptId = "" } = useParams<{ id: string }>();
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAttempt(attemptId);
  const applyMut = useApplyAttempt();
  const abandonMut = useAbandonAttempt();

  const allPaths = useMemo(
    () => (data?.manifest?.files ?? []).map((f) => f.path),
    [data],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(allPaths));
  useMemo(() => {
    setSelected(new Set(allPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.attempt.id]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="px-5 py-5 max-w-5xl mx-auto">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="px-5 py-5 max-w-5xl mx-auto">
        <PageHeader title={t("diff.title")} description={t("diff.empty")} />
        <Link to="/" className="text-sm text-accent hover:underline">← Home</Link>
      </div>
    );
  }

  const { attempt, manifest } = data;
  const isClosed = attempt.status !== "open";
  const hasFiles = (manifest?.files ?? []).length > 0;

  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  };
  const toggleExpand = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };
  const toggleAll = () => {
    if (selected.size === allPaths.length) setSelected(new Set());
    else setSelected(new Set(allPaths));
  };

  const apply = async () => {
    if (selected.size === 0) return;
    try {
      const result = await applyMut.mutateAsync({
        attemptId,
        paths: Array.from(selected),
      });
      toast({
        title: t("diff.applySuccess", { n: result.applied.length }),
        variant: "success",
      });
      navigate(`/chat/${attempt.chatId}`);
    } catch (err) {
      toast({
        title: t("diff.applyFailed"),
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  const abandon = async () => {
    if (!(await confirm({ message: t("attempts.abandonConfirm"), danger: true }))) return;
    try {
      await abandonMut.mutateAsync(attemptId);
      navigate(`/chat/${attempt.chatId}`);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="px-5 py-5 max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        icon={<Bot className="h-5 w-5" />}
        title={t("attempts.title")}
        description={
          hasFiles
            ? t("diff.filesSelected", { n: selected.size })
            : t("diff.empty")
        }
      />

      {/* Origin chat link */}
      <Link
        to={`/chat/${attempt.chatId}`}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        ← {t("attempts.backToChat")}
      </Link>

      {attempt.status === "applied" && (
        <Card className="px-4 py-3 bg-success/10 border-success/40">
          <p className="text-xs text-success flex items-center gap-2">
            <Check className="h-3.5 w-3.5" />
            {t("attempts.appliedAt", {
              time: attempt.appliedAt
                ? new Date(attempt.appliedAt).toLocaleString()
                : "",
            })}
          </p>
        </Card>
      )}

      {attempt.status === "abandoned" && (
        <Card className="px-4 py-3 bg-destructive/10 border-destructive/40">
          <p className="text-xs text-destructive flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" />
            {t("attempts.abandonedAt", {
              time: attempt.abandonedAt
                ? new Date(attempt.abandonedAt).toLocaleString()
                : "",
            })}
          </p>
        </Card>
      )}

      {hasFiles && (
        <>
          <div className="flex items-center gap-3 px-1">
            <input
              type="checkbox"
              checked={selected.size === allPaths.length && allPaths.length > 0}
              onChange={toggleAll}
              disabled={isClosed}
              className="accent-accent h-3.5 w-3.5"
              aria-label={t("diff.selectAll")}
            />
            <span className="text-xs text-muted-foreground">
              {selected.size} / {allPaths.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {(manifest?.files ?? []).map((f) => (
              <FileRow
                key={f.path}
                file={f}
                checked={selected.has(f.path)}
                disabled={isClosed}
                isExpanded={expanded.has(f.path)}
                onToggle={() => toggle(f.path)}
                onToggleExpand={() => toggleExpand(f.path)}
              />
            ))}
          </div>

          {!isClosed && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void abandon()}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                disabled={abandonMut.isPending}
              >
                {t("attempts.abandon")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void apply()}
                disabled={selected.size === 0 || applyMut.isPending}
                loading={applyMut.isPending}
                leftIcon={<GitCommit className="h-3.5 w-3.5" />}
              >
                {t("diff.applySelected")} ({selected.size})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
