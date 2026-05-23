/**
 * Symbol indexer — v1 is regex-based, intentionally simple.
 *
 * Tree-sitter would be more accurate but each grammar bundle is
 * 500 KB–2 MB of WASM and we'd be carrying five. The regex patterns
 * below catch the symbol kinds that matter for retrieval boosting
 * (function, class, method, const) across JavaScript/TypeScript,
 * Python, Go, Rust, and Java. False positives are cheap (retrieval
 * just gets a small score nudge); false negatives mean the embedding
 * + keyword paths carry the load, which they already do well.
 *
 * The indexer runs once per scan, in the same background slot as the
 * embedding indexer. Symbols live in a tiny SQLite table; retrieval
 * adds a +1.0 bonus per chunk whose path appears in the matched-
 * symbols set for the query.
 */
import fs from "node:fs";
import path from "node:path";
import type { FileMeta } from "@ariadne/shared";
import {
  dbClearWorkspaceSymbols,
  dbInsertSymbols,
  type SymbolRow,
} from "../db/repo.js";

const READ_BUDGET = 200_000; // 200 KB per file is plenty for symbol heads.
const MAX_FILES = 200;

/** Languages we extract — keyed by file extension. */
const LANG_PATTERNS: Record<string, { kind: SymbolRow["kind"]; re: RegExp }[]> = {
  ts: [
    { kind: "function", re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "class", re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "const", re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm },
    { kind: "method", re: /^\s+(?:public|private|protected|static|async)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/gm },
    { kind: "interface", re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm },
    { kind: "type", re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm },
  ],
  // JS shares the TS patterns minus interface/type — extracting them anyway
  // is harmless because plain JS won't have those tokens.
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
LANG_PATTERNS["js"] = LANG_PATTERNS["ts"]!;
LANG_PATTERNS["tsx"] = LANG_PATTERNS["ts"]!;
LANG_PATTERNS["jsx"] = LANG_PATTERNS["ts"]!;

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
  const candidates = files
    .filter((f) => {
      if (f.sensitive) return false;
      const ext = (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();
      return ext in LANG_PATTERNS;
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
    const patterns = LANG_PATTERNS[ext];
    if (!patterns) continue;

    for (const { kind, re } of patterns) {
      // Each pattern is a fresh RegExp with `g` flag, but they're
      // module-scoped — reset lastIndex before each file to be safe.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        if (!name) continue;
        // Approximate line number by counting newlines up to the
        // match. O(n) per match is fine at this scale.
        const line = (text.slice(0, m.index).match(/\n/g)?.length ?? 0) + 1;
        rows.push({
          workspaceId,
          path: f.path,
          name,
          kind,
          line,
        });
      }
    }
  }

  // Replace, don't merge — same reasoning as the embedding indexer.
  dbClearWorkspaceSymbols(workspaceId);
  if (rows.length > 0) dbInsertSymbols(rows);
  return { symbols: rows.length };
}
