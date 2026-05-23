/**
 * Diff review view for staged edits — `/runs/:id/diff`.
 *
 * Renders the StagedManifest produced by `edit_file` blocks during a
 * run as a list of files, each with a per-file checkbox and an
 * expandable side-by-side line-level diff. The bottom bar applies
 * selected files (atomic commit via the workspace-history repo) or
 * discards the whole staged set.
 *
 * No third-party diff renderer — the line ops are re-derived in the
 * browser from each file's before/after via the same LCS we use on the
 * server, so the visual stays consistent and there's no extra bundle.
 */
import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { GitCommit, Trash2, Check } from "lucide-react";
import { useStagedManifest, useApplyStagedEdits, useDiscardStagedEdits } from "../../lib/queries";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { FileRow } from "./diffRender";

export function StagedDiffView() {
  const { id: runId = "" } = useParams<{ id: string }>();
  const { t } = useT();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: manifest, isLoading, isError } = useStagedManifest(runId);
  const applyMut = useApplyStagedEdits();
  const discardMut = useDiscardStagedEdits();

  // Selection — default everything on. Reset when the manifest swaps.
  const allPaths = useMemo(
    () => (manifest?.files ?? []).map((f) => f.path),
    [manifest],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(allPaths));
  // Sync selection when manifest first arrives.
  useMemo(() => {
    setSelected(new Set(allPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest?.runId]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="px-5 py-5 max-w-5xl mx-auto">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (isError || !manifest) {
    return (
      <div className="px-5 py-5 max-w-5xl mx-auto">
        <PageHeader
          title={t("diff.title")}
          description={t("diff.empty")}
        />
        <Link
          to={`/runs/${runId}`}
          className="text-sm text-accent hover:underline"
        >
          ← Run detail
        </Link>
      </div>
    );
  }

  const isApplied = manifest.appliedAt !== null;

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
        runId,
        paths: Array.from(selected),
      });
      toast({
        title: t("diff.applySuccess", { n: result.applied.length }),
        variant: "success",
      });
      navigate(`/runs/${runId}`);
    } catch (err) {
      toast({
        title: t("diff.applyFailed"),
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  const discard = async () => {
    if (!window.confirm(t("diff.discardConfirm"))) return;
    try {
      await discardMut.mutateAsync(runId);
      navigate(`/runs/${runId}`);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="px-5 py-5 max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        title={t("diff.title")}
        description={t("diff.filesSelected", { n: selected.size })}
      />

      {isApplied && (
        <Card className="px-4 py-3 bg-success/10 border-success/40">
          <p className="text-xs text-success flex items-center gap-2">
            <Check className="h-3.5 w-3.5" />
            {t("diff.alreadyApplied")}
            {manifest.appliedAt && (
              <span className="text-muted-foreground">
                · {new Date(manifest.appliedAt).toLocaleString()}
              </span>
            )}
          </p>
        </Card>
      )}

      {/* Header strip — select-all + counts */}
      <div className="flex items-center gap-3 px-1">
        <input
          type="checkbox"
          checked={selected.size === allPaths.length && allPaths.length > 0}
          onChange={toggleAll}
          disabled={isApplied}
          className="accent-accent h-3.5 w-3.5"
          aria-label="Select all"
        />
        <span className="text-xs text-muted-foreground">
          {selected.size} / {allPaths.length}
        </span>
      </div>

      {/* File list */}
      <div className="flex flex-col gap-2">
        {manifest.files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            checked={selected.has(f.path)}
            disabled={isApplied}
            isExpanded={expanded.has(f.path)}
            onToggle={() => toggle(f.path)}
            onToggleExpand={() => toggleExpand(f.path)}
          />
        ))}
      </div>

      {/* Bottom action bar */}
      {!isApplied && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void discard()}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            disabled={discardMut.isPending}
          >
            {t("diff.discard")}
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
    </div>
  );
}
