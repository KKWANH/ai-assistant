/**
 * Symbol indexer — chooser over pluggable providers.
 *
 * Boot-time order:
 *   1. tree-sitter provider — accurate AST for TS/TSX/JS/JSX/Python,
 *      gated on optionalDependencies loading successfully (see
 *      docs/SYMBOL_INDEX_PLAN.md §8 for why we picked native bindings).
 *   2. regex provider — the existing patterns, always ready. Floor for
 *      Go/Rust/Java and the fallback path when tree-sitter is unavailable.
 *
 * The indexer runs once per scan in the same background slot as the
 * embedding indexer. Per-file routing picks the highest-priority
 * provider that supports the extension.
 */
import fs from "node:fs";
import path from "node:path";
import type { FileMeta } from "@ariadne/shared";
import {
  dbClearWorkspaceSymbols,
  dbInsertSymbols,
  type SymbolRow,
} from "../db/repo.js";
import { getTreeSitterProvider } from "./symbolIndex/treeSitterProvider.js";

const READ_BUDGET = 200_000; // 200 KB per file is plenty for symbol heads.
const MAX_FILES = 200;

type SymbolDraft = Omit<SymbolRow, "workspaceId" | "path">;

/** Languages the regex provider catches — keyed by file extension. */
const REGEX_PATTERNS: Record<string, { kind: SymbolRow["kind"]; re: RegExp }[]> = {
  ts: [
    { kind: "function", re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "const", re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm },
    { kind: "method", re: /^\s+(?:public|private|protected|static|async)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/gm },
    { kind: "interface", re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "type", re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm },
  ],
  js: [],
  tsx: [],
  jsx: [],
  py: [
    { kind: "function", re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm },
    { kind: "class", re: /^class\s+([A-Za-z_]\w*)/gm },
  ],
  go: [
    { kind: "function", re: /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)\s*\(/gm },
    { kind: "type", re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface|=)/gm },
  ],
  rs: [
    { kind: "function", re: /^(?:pub\s+(?:\([^)]+\)\s+)?)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm },
    { kind: "struct", re: /^(?:pub\s+(?:\([^)]+\)\s+)?)?struct\s+([A-Za-z_]\w*)/gm },
    { kind: "enum", re: /^(?:pub\s+(?:\([^)]+\)\s+)?)?enum\s+([A-Za-z_]\w*)/gm },
    { kind: "trait", re: /^(?:pub\s+(?:\([^)]+\)\s+)?)?trait\s+([A-Za-z_]\w*)/gm },
  ],
  java: [
    { kind: "class", re: /^(?:public\s+|private\s+|abstract\s+|final\s+)*class\s+([A-Za-z_]\w*)/gm },
    { kind: "method", re: /^\s+(?:public\s+|private\s+|protected\s+|static\s+|final\s+)+(?:[\w<>[\],\s]+\s+)?([A-Za-z_]\w*)\s*\(/gm },
  ],
};
// JS / TSX / JSX share TS rules.
REGEX_PATTERNS["js"] = REGEX_PATTERNS["ts"]!;
REGEX_PATTERNS["tsx"] = REGEX_PATTERNS["ts"]!;
REGEX_PATTERNS["jsx"] = REGEX_PATTERNS["ts"]!;

const REGEX_SUPPORTED = new Set(Object.keys(REGEX_PATTERNS));

/** Regex extractor — the same patterns we've had since Phase D. */
function extractWithRegex(text: string, ext: string): SymbolDraft[] {
  const patterns = REGEX_PATTERNS[ext];
  if (!patterns) return [];
  const rows: SymbolDraft[] = [];
  for (const { kind, re } of patterns) {
    // Each pattern is module-scoped with the `g` flag — reset lastIndex
    // before each file to be safe.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (!name) continue;
      // O(n) per match newline-count is fine at this scale.
      const line = (text.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
      rows.push({ name, kind, line });
    }
  }
  return rows;
}

/**
 * Reindex a workspace's symbol table from a fresh scan. Replaces all
 * rows for the workspace — staleness is a non-error.
 */
export async function indexWorkspaceSymbols(
  workspaceId: string,
  rootPath: string,
  files: FileMeta[],
): Promise<{ symbols: number }> {
  const root = path.resolve(rootPath);
  // Load tree-sitter once per scan; the chooser uses it per file.
  const treeSitter = await getTreeSitterProvider();

  const candidates = files
    .filter((f) => {
      if (f.sensitive) return false;
      const ext = (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();
      return treeSitter.supports(ext) || REGEX_SUPPORTED.has(ext);
    })
    .slice(0, MAX_FILES);

  const rows: SymbolRow[] = [];
  for (const f of candidates) {
    const abs = path.resolve(root, f.path);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    let text: string;
    try {
      const buf = await fs.promises.readFile(abs, "utf-8");
      text = buf.length > READ_BUDGET ? buf.slice(0, READ_BUDGET) : buf;
    } catch {
      continue;
    }
    const ext = (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();

    // Pick the highest-priority provider that handles this language.
    // The candidate filter above guarantees at least one branch matches.
    const drafts =
      treeSitter.ready && treeSitter.supports(ext)
        ? treeSitter.extract(text, ext)
        : extractWithRegex(text, ext);

    for (const d of drafts) {
      rows.push({ workspaceId, path: f.path, ...d });
    }
  }

  // Replace, don't merge — same reasoning as the embedding indexer.
  dbClearWorkspaceSymbols(workspaceId);
  if (rows.length > 0) dbInsertSymbols(rows);
  return { symbols: rows.length };
}
