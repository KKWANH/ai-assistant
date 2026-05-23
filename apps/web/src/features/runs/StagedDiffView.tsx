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
import { ChevronDown, ChevronRight, GitCommit, Trash2, Check } from "lucide-react";
import type { StagedFile } from "@ariadne/shared";
import { useStagedManifest, useApplyStagedEdits, useDiscardStagedEdits } from "../../lib/queries";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

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

// ── File row + diff renderer ──────────────────────────────────────────────────

function FileRow({
  file,
  checked,
  disabled,
  isExpanded,
  onToggle,
  onToggleExpand,
}: {
  file: StagedFile;
  checked: boolean;
  disabled: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  const { t } = useT();
  const actionLabel = t(`diff.action.${file.action}` as `diff.action.create`);
  const actionTone =
    file.action === "create"
      ? "text-success"
      : file.action === "delete"
        ? "text-destructive"
        : "text-foreground";

  const { added, removed } = useMemo(() => quickStats(file.diff), [file.diff]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          className="accent-accent h-3.5 w-3.5 shrink-0"
          aria-label={`Select ${file.path}`}
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className={`text-2xs font-medium uppercase tracking-wider shrink-0 ${actionTone}`}>
            {actionLabel}
          </span>
          <span className="font-mono text-xs text-foreground truncate flex-1">
            {file.path}
          </span>
          <span className="text-2xs text-muted-foreground shrink-0 font-mono">
            <span className="text-success">+{added}</span>
            {" "}
            <span className="text-destructive">−{removed}</span>
          </span>
        </button>
      </div>
      {isExpanded && (
        <div className="border-t border-border bg-surface-2">
          <SideBySideDiff before={file.before ?? ""} after={file.after ?? ""} />
        </div>
      )}
    </Card>
  );
}

/** Lightweight LCS line diff — keeps the page bundle-dep-free. */
function SideBySideDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => buildSideBySide(before, after), [before, after]);
  return (
    <div className="grid grid-cols-2 gap-0 font-mono text-2xs overflow-x-auto">
      {rows.map((row, i) => (
        <DiffPair key={i} row={row} />
      ))}
    </div>
  );
}

type SideRow = { left: { text: string; kind: "context" | "remove" | "blank" }; right: { text: string; kind: "context" | "add" | "blank" } };

function DiffPair({ row }: { row: SideRow }) {
  const cellBg = (kind: string): string => {
    if (kind === "remove") return "bg-destructive/15";
    if (kind === "add") return "bg-success/15";
    if (kind === "blank") return "bg-surface-3";
    return "";
  };
  return (
    <>
      <div className={`px-3 py-0.5 whitespace-pre-wrap break-words border-r border-border ${cellBg(row.left.kind)}`}>
        <span className="text-muted-foreground select-none mr-2">{row.left.kind === "remove" ? "−" : " "}</span>
        {row.left.text}
      </div>
      <div className={`px-3 py-0.5 whitespace-pre-wrap break-words ${cellBg(row.right.kind)}`}>
        <span className="text-muted-foreground select-none mr-2">{row.right.kind === "add" ? "+" : " "}</span>
        {row.right.text}
      </div>
    </>
  );
}

/**
 * Same LCS pass the server runs — packaged into side-by-side rows so
 * a deletion in the left column lines up with an addition in the right
 * (alignment that a flat unified diff loses).
 */
function buildSideBySide(beforeStr: string, afterStr: string): SideRow[] {
  const a = beforeStr.length === 0 ? [] : beforeStr.split("\n");
  const b = afterStr.length === 0 ? [] : afterStr.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS table; same shape as the server's diff.ts.
  const dp = new Uint32Array((n + 1) * (m + 1));
  const row = m + 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i * row + j] = (dp[(i - 1) * row + (j - 1)] ?? 0) + 1;
      } else {
        const up = dp[(i - 1) * row + j] ?? 0;
        const left = dp[i * row + (j - 1)] ?? 0;
        dp[i * row + j] = up > left ? up : left;
      }
    }
  }

  // Reverse walk → ops, then pack consecutive deletes/inserts into the
  // same SideRow so they sit side-by-side.
  const ops: Array<{ kind: "equal" | "delete" | "insert"; text: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: "equal", text: a[i - 1] ?? "" });
      i--; j--;
    } else if (j > 0 && (i === 0 || (dp[i * row + (j - 1)] ?? 0) >= (dp[(i - 1) * row + j] ?? 0))) {
      ops.push({ kind: "insert", text: b[j - 1] ?? "" });
      j--;
    } else {
      ops.push({ kind: "delete", text: a[i - 1] ?? "" });
      i--;
    }
  }
  ops.reverse();

  const out: SideRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (!op) { k++; continue; }
    if (op.kind === "equal") {
      out.push({
        left: { text: op.text, kind: "context" },
        right: { text: op.text, kind: "context" },
      });
      k++;
      continue;
    }
    // Pack a contiguous delete-then-insert block into paired rows so
    // the right column shows the replacement next to its source.
    const removes: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k]?.kind === "delete") {
      removes.push(ops[k]!.text);
      k++;
    }
    while (k < ops.length && ops[k]?.kind === "insert") {
      adds.push(ops[k]!.text);
      k++;
    }
    const len = Math.max(removes.length, adds.length);
    for (let r = 0; r < len; r++) {
      out.push({
        left: { text: removes[r] ?? "", kind: removes[r] !== undefined ? "remove" : "blank" },
        right: { text: adds[r] ?? "", kind: adds[r] !== undefined ? "add" : "blank" },
      });
    }
  }
  return out;
}

/** Pulled directly from the unified-diff text so we don't redo the LCS just for a stat strip. */
function quickStats(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
