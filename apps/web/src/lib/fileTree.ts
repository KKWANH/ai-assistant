/**
 * fileTree — build a nested tree from a flat list of workspace file paths, plus
 * a small extension→icon map. Shared by the chat file picker and the editor's
 * IDE file-tree sidebar so the tree shape + sorting stay identical in both.
 */
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";

export interface TreeNode {
  kind: "dir" | "file";
  name: string; // basename
  path: string; // full path (relative to workspace root)
  size?: number;
  children?: TreeNode[];
}

/** Fold a flat `{ path }[]` into a sorted tree (dirs before files, alpha). */
export function buildTree(files: Array<{ path: string; size?: number }>): TreeNode {
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

/** Total file count under a node — shown next to a directory row. */
export function countFiles(node: TreeNode): number {
  if (node.kind === "file") return 1;
  return (node.children ?? []).reduce((s, c) => s + countFiles(c), 0);
}

/** Tiny extension → icon map. Keeps lists scannable without a bigger lib. */
export function iconFor(path: string): LucideIcon {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt"].includes(ext)) return FileText;
  if (["csv", "tsv", "xlsx"].includes(ext)) return FileSpreadsheet;
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "yaml", "yml", "json", "c", "h", "cpp", "hpp"].includes(ext)) return FileCode;
  return FileIcon;
}
