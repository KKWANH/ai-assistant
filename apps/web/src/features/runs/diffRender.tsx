/**
 * Shared diff-renderer pieces — used by both StagedDiffView (action-run
 * staged manifests) and AttemptDiffView (agent-attempt staged manifests).
 *
 * Keeps two views' file-row UX exactly identical so behaviour doesn't
 * drift, and avoids a third-party diff package: the line ops are
 * re-derived in the browser via the same LCS we run server-side.
 */
import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StagedFile } from "@ariadne/shared";
import { Card } from "../../components/ui/Card";
import { useT } from "../../lib/i18n";

export function FileRow({
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

type SideRow = {
  left: { text: string; kind: "context" | "remove" | "blank" };
  right: { text: string; kind: "context" | "add" | "blank" };
};

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

function buildSideBySide(beforeStr: string, afterStr: string): SideRow[] {
  const a = beforeStr.length === 0 ? [] : beforeStr.split("\n");
  const b = afterStr.length === 0 ? [] : afterStr.split("\n");
  const n = a.length;
  const m = b.length;

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

function quickStats(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
