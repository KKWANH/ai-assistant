/**
 * WorkspaceFilePicker — modal for inserting workspace files into the chat
 * composer as attachments. Addresses the AK user complaint:
 *
 *   '프로젝트 내 챗에서 그냥 일반 챗이랑 너무 똑같이 보이면 어떻게 쓸지를
 *    모르겠음. 이 파일 구조를 보여주면서 파일을 쉽게 삽입하고 지정할 수
 *    있으면 좋겠음.'
 *
 * Strategy:
 *   - List the latest workspace snapshot's files (no new server API).
 *   - User can filter by typing.
 *   - Multi-select with checkboxes; the modal returns the selected file
 *     paths to the composer, which fetches each one's content via the
 *     existing GET /api/workspaces/:id/files/:path endpoint and converts
 *     them into composer attachments. Zero server changes.
 *
 * Why attachments (not a new `mentioned_files` payload field): the
 * existing chat-context pipeline already handles attachments cleanly
 * (parsed by file type, character-budgeted, prepended to the system
 * prompt). Routing workspace files through attachments inherits all of
 * that for free.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { useSnapshot } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Search, FileText, FileSpreadsheet, FileCode, File as FileIcon, ChevronRight, ChevronDown, Folder } from "lucide-react";

// AL2 — recursive file tree.
interface TreeNode {
  kind: "dir" | "file";
  name: string;        // basename
  path: string;        // full path
  size?: number;
  children?: TreeNode[];
}

function buildTree(files: Array<{ path: string; size?: number }>): TreeNode {
  const root: TreeNode = { kind: "dir", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let child = cur.children!.find((c) => c.name === part);
      if (!child) {
        child = {
          kind: isLast ? "file" : "dir",
          name: part,
          path: childPath,
          size: isLast ? f.size : undefined,
          children: isLast ? undefined : [],
        };
        cur.children!.push(child);
      }
      cur = child;
    }
  }
  // Sort: dirs before files at each level, then alphabetical.
  function sortRec(node: TreeNode) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortRec(c);
  }
  sortRec(root);
  return root;
}

// AL4 — search result weighting. Compute a score per file given a
// query. Higher = more relevant. 0 = no match (filtered out).
function matchScore(path: string, basename: string, query: string, recentSet: Set<string>): number {
  if (!query) {
    // No query: recent files float to top, otherwise stable.
    return recentSet.has(path) ? 0.5 : 0.1;
  }
  const q = query.toLowerCase();
  const lowPath = path.toLowerCase();
  const lowBase = basename.toLowerCase();
  if (lowBase === q) return 100;                        // exact basename
  if (lowBase.startsWith(q)) return 80;                 // basename prefix
  if (lowBase.includes(q)) return 60;                   // basename substring
  if (lowPath.startsWith(q)) return 40;                 // full-path prefix
  if (lowPath.includes(q)) return 20;                   // full-path substring
  // Fuzzy: all chars present in order, weighted by tightness.
  let qi = 0;
  let last = -1;
  for (let i = 0; i < lowPath.length && qi < q.length; i++) {
    if (lowPath[i] === q[qi]) { last = i; qi++; }
  }
  if (qi === q.length) return Math.max(1, 15 - (last - q.length));
  return 0;
}

function countFiles(node: TreeNode): number {
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((s, c) => s + countFiles(c), 0);
}

const RECENT_KEY = "ariadne:wsFilePicker:recent";
function readRecent(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY}:${workspaceId}`);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch { return []; }
}
function writeRecent(workspaceId: string, paths: string[]) {
  try {
    // Keep last 20.
    localStorage.setItem(`${RECENT_KEY}:${workspaceId}`, JSON.stringify(paths.slice(0, 20)));
  } catch { /* localStorage full or disabled — non-fatal */ }
}

export interface WorkspaceFilePickerProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (paths: string[]) => void;
  /** Already-selected paths (so users can re-open the modal to add more). */
  initialSelected?: string[];
}

/** Tiny extension → icon map. Keeps the picker scannable without
 *  pulling a bigger filetype lib. */
function iconFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt"].includes(ext)) return FileText;
  if (["csv", "tsv", "xlsx"].includes(ext)) return FileSpreadsheet;
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "yaml", "yml", "json"].includes(ext)) return FileCode;
  return FileIcon;
}

export function WorkspaceFilePicker({
  workspaceId, open, onClose, onConfirm, initialSelected = [],
}: WorkspaceFilePickerProps) {
  const { t } = useT();
  const { data: snapshot } = useSnapshot(workspaceId, open);  // only fetch when open
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  // Reset selection when the modal reopens with a fresh initialSelected.
  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
  }, [open, initialSelected.join(",")]);  // eslint-disable-line react-hooks/exhaustive-deps

  // AL4 — recent files float to top; AL2 — recursive tree shape.
  const recent = useMemo(() => new Set(readRecent(workspaceId)), [workspaceId, open]);
  const q = query.trim();

  // When the user is searching, show a flat ranked list (search results
  // make sense flat). When the query is empty, show the tree.
  const ranked = useMemo(() => {
    if (!snapshot) return [];
    const scored = snapshot.files
      .map((f) => {
        const base = f.path.split("/").pop() ?? f.path;
        return { f, score: matchScore(f.path, base, q, recent) };
      })
      .filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));
    return scored.map((x) => x.f);
  }, [snapshot, q, recent]);

  const tree = useMemo(() => buildTree(snapshot?.files ?? []), [snapshot]);

  // Track which dirs are expanded. By default everything one level deep
  // is open so the user immediately sees the top-level structure.
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set([""]));
  useEffect(() => {
    if (!snapshot || !tree.children) return;
    // Pre-open top-level dirs once on first snapshot.
    setOpenDirs((prev) => {
      if (prev.size > 1) return prev;
      const next = new Set(prev);
      for (const c of tree.children!) if (c.kind === "dir") next.add(c.path);
      return next;
    });
  }, [snapshot, tree]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const confirm = () => {
    const chosen = Array.from(selected);
    // AL4 — remember the picked paths so they bubble up the next time.
    const prevRecent = readRecent(workspaceId);
    const merged = Array.from(new Set([...chosen, ...prevRecent]));
    writeRecent(workspaceId, merged);
    onConfirm(chosen);
    onClose();
  };

  // Render one tree row (file or dir). Dirs recurse via openDirs.
  function renderNode(node: TreeNode, depth: number): JSX.Element | null {
    if (node.kind === "file") {
      const Icon = iconFor(node.path);
      const isSelected = selected.has(node.path);
      const isRecent = recent.has(node.path);
      return (
        <label
          key={node.path}
          style={{ paddingLeft: 8 + depth * 16 }}
          className={`flex items-center gap-2 pr-3 py-1 text-sm cursor-pointer hover:bg-surface-3 ${isSelected ? "bg-accent/10" : ""}`}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggle(node.path)}
            className="accent-accent h-3.5 w-3.5"
          />
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate" title={node.path}>{node.name}</span>
          {isRecent && <span className="text-2xs text-accent">최근</span>}
          {node.size != null && (
            <span className="text-2xs text-muted-foreground">{Math.ceil(node.size / 1024)}kB</span>
          )}
        </label>
      );
    }
    // Directory
    const isOpen = openDirs.has(node.path);
    const fileCount = countFiles(node);
    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          style={{ paddingLeft: 8 + depth * 16 }}
          className="w-full text-left flex items-center gap-1.5 pr-3 py-1 text-sm hover:bg-surface-3"
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="flex-1 truncate font-medium">{node.name || "(root)"}</span>
          <span className="text-2xs text-muted-foreground">{fileCount}</span>
        </button>
        {isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("workspaceFilePicker.title")}
      description={t("workspaceFilePicker.subtitle", { n: String(snapshot?.files.length ?? 0) })}
      size="lg"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-surface-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("workspaceFilePicker.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* AL2 — recursive tree (no query) OR AL4 — ranked flat list (query). */}
        <div className="max-h-[50vh] overflow-y-auto border border-border rounded">
          {!snapshot && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("workspaceFilePicker.notScanned")}
            </div>
          )}
          {snapshot && q && ranked.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("workspaceFilePicker.noMatch")}
            </div>
          )}
          {snapshot && q && ranked.map((f) => {
            const Icon = iconFor(f.path);
            const isSelected = selected.has(f.path);
            const isRecent = recent.has(f.path);
            return (
              <label
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-3 ${isSelected ? "bg-accent/10" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(f.path)}
                  className="accent-accent h-3.5 w-3.5"
                />
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate" title={f.path}>{f.path}</span>
                {isRecent && <span className="text-2xs text-accent">최근</span>}
                {f.size != null && (
                  <span className="text-2xs text-muted-foreground">{Math.ceil(f.size / 1024)}kB</span>
                )}
              </label>
            );
          })}
          {snapshot && !q && tree.children?.map((c) => renderNode(c, 0))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {t("workspaceFilePicker.selectedN", { n: String(selected.size) })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={selected.size === 0}
            >
              {t("workspaceFilePicker.insert", { n: String(selected.size) })}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
