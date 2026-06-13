/**
 * FileTree — collapsible workspace file tree for the editor's IDE sidebar
 * (P3 editing core). Pure presentation over a flat file list: builds the nested
 * tree, remembers expanded dirs (and auto-expands the path to the active file),
 * highlights the active file, and calls onSelect(path) on a file click.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder } from "lucide-react";
import { buildTree, countFiles, iconFor, type TreeNode } from "../../lib/fileTree";

export function FileTree({
  files,
  activePath,
  onSelect,
}: {
  files: Array<{ path: string; size?: number }>;
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set([""]));

  // Keep top-level dirs open, and expand every ancestor of the active file so
  // the current file is always visible after navigation.
  useEffect(() => {
    if (!tree.children) return;
    setOpenDirs((prev) => {
      const next = new Set(prev);
      for (const c of tree.children!) if (c.kind === "dir") next.add(c.path);
      if (activePath) {
        const parts = activePath.split("/").filter(Boolean);
        for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
  }, [tree, activePath]);

  const toggleDir = useCallback((path: string) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  function renderNode(node: TreeNode, depth: number): JSX.Element | null {
    if (node.kind === "file") {
      const Icon = iconFor(node.path);
      const isActive = node.path === activePath;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => onSelect(node.path)}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={[
            "w-full text-left flex items-center gap-2 pr-2 py-1 text-xs transition-colors",
            isActive ? "bg-accent/15 text-accent" : "text-foreground hover:bg-surface-3",
          ].join(" ")}
          title={node.path}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{node.name}</span>
        </button>
      );
    }
    const isOpen = openDirs.has(node.path);
    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          style={{ paddingLeft: 8 + depth * 14 }}
          className="w-full text-left flex items-center gap-1.5 pr-2 py-1 text-xs text-foreground hover:bg-surface-3"
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="flex-1 truncate font-medium">{node.name || "(root)"}</span>
          <span className="text-2xs text-muted-foreground">{countFiles(node)}</span>
        </button>
        {isOpen && node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  return <div className="py-1">{tree.children?.map((c) => renderNode(c, 0))}</div>;
}
