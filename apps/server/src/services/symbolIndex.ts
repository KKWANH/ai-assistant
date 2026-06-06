/**
 * Symbol indexer — chooser over pluggable providers.
 *
 * Boot-time order:
 *   1. tree-sitter provider — accurate AST for TS/TSX/JS/JSX/Python,
 *      gated on optionalDependencies loading successfully (native bindings).
 *   2. regex provider — the patterns below, always ready. Floor for
 *      Go/Rust/Java and the fallback when tree-sitter is unavailable.
 *
 * The indexer runs once per scan in the same background slot as the
 * embedding indexer. File reads run concurrently with `Promise.all`
 * (file system is the bottleneck), AST/regex extraction runs serially
 * on the loaded buffers, then the rows are bulk-inserted under a single
 * transaction in `dbInsertSymbols`.
 */
import type { FileMeta } from "@ariadne/shared";
import {
  dbClearWorkspaceSymbols,
  dbInsertSymbols,
  type SymbolDraft,
  type SymbolRow,
} from "../db/repo.js";
import {
  normalizedExtension,
  readTextUnderRoot,
} from "../workspace/readWithinRoot.js";
import { getTreeSitterProvider } from "./symbolIndex/treeSitterProvider.js";

const READ_BUDGET = 200_000; // 200 KB per file is plenty for symbol heads.
const MAX_FILES = 200;

/**
 * Regex pattern *sources*, not RegExp instances. We construct fresh
 * RegExps per call so module-scoped `lastIndex` can't leak across
 * concurrent scans of different workspaces.
 */
interface RegexPattern {
  kind: SymbolRow["kind"];
  src: string;
}

const TS_PATTERNS: RegexPattern[] = [
  { kind: "function", src: "^(?:export\\s+)?(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)" },
  { kind: "class", src: "^(?:export\\s+)?(?:abstract\\s+)?class\\s+([A-Za-z_$][\\w$]*)" },
  { kind: "const", src: "^(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*[:=]" },
  // Method modifier (public/private/.../async/readonly) is REQUIRED — without
  // it the pattern matches `if (x) {`, `while (...) {`, and object-literal
  // shorthand methods. False positives are cheap for retrieval (+2.0 score
  // nudge on the wrong file) but adding noise to every TS scan isn't worth it.
  { kind: "method", src: "^\\s+(?:public|private|protected|static|async|readonly)\\s+([A-Za-z_$][\\w$]*)\\s*\\(" },
  { kind: "interface", src: "^(?:export\\s+)?interface\\s+([A-Za-z_$][\\w$]*)" },
  { kind: "type", src: "^(?:export\\s+)?type\\s+([A-Za-z_$][\\w$]*)\\s*=" },
];

/** Languages the regex provider catches — keyed by file extension. */
const REGEX_PATTERNS: Record<string, RegexPattern[]> = {
  // TS rules cover JS too (every JS construct is valid TS).
  ts: TS_PATTERNS,
  js: TS_PATTERNS,
  tsx: TS_PATTERNS,
  jsx: TS_PATTERNS,
  py: [
    { kind: "function", src: "^(?:async\\s+)?def\\s+([A-Za-z_]\\w*)" },
    { kind: "class", src: "^class\\s+([A-Za-z_]\\w*)" },
  ],
  go: [
    { kind: "function", src: "^func\\s+(?:\\([^)]+\\)\\s+)?([A-Za-z_]\\w*)\\s*\\(" },
    { kind: "type", src: "^type\\s+([A-Za-z_]\\w*)\\s+(?:struct|interface|=)" },
  ],
  rs: [
    { kind: "function", src: "^(?:pub\\s+(?:\\([^)]+\\)\\s+)?)?(?:async\\s+)?fn\\s+([A-Za-z_]\\w*)" },
    { kind: "struct", src: "^(?:pub\\s+(?:\\([^)]+\\)\\s+)?)?struct\\s+([A-Za-z_]\\w*)" },
    { kind: "enum", src: "^(?:pub\\s+(?:\\([^)]+\\)\\s+)?)?enum\\s+([A-Za-z_]\\w*)" },
    { kind: "trait", src: "^(?:pub\\s+(?:\\([^)]+\\)\\s+)?)?trait\\s+([A-Za-z_]\\w*)" },
  ],
  java: [
    { kind: "class", src: "^(?:public\\s+|private\\s+|abstract\\s+|final\\s+)*class\\s+([A-Za-z_]\\w*)" },
    { kind: "method", src: "^\\s+(?:public\\s+|private\\s+|protected\\s+|static\\s+|final\\s+)+(?:[\\w<>[\\],\\s]+\\s+)?([A-Za-z_]\\w*)\\s*\\(" },
  ],
};

const REGEX_SUPPORTED = new Set(Object.keys(REGEX_PATTERNS));

/**
 * Build a sorted array of newline byte offsets once per file. Per-match
 * line numbers then become a binary search instead of a fresh prefix
 * slice + regex scan — saves O(n·m) → O(n + m·log n) per file.
 */
function newlineOffsets(text: string): number[] {
  const offs: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) offs.push(i);
  }
  return offs;
}

function lineFor(offsets: number[], byteIndex: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // We want the count of newlines strictly before byteIndex + 1.
    const v = offsets[mid];
    if (v !== undefined && v < byteIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/** Regex extractor — fresh RegExp per pattern keeps the call reentrant. */
function extractWithRegex(text: string, ext: string): SymbolDraft[] {
  const patterns = REGEX_PATTERNS[ext];
  if (!patterns) return [];
  const offsets = newlineOffsets(text);
  const rows: SymbolDraft[] = [];
  for (const { kind, src } of patterns) {
    const re = new RegExp(src, "gm");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      if (!name) continue;
      rows.push({ name, kind, line: lineFor(offsets, m.index) });
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
  // Load tree-sitter once per scan; the chooser uses it per file.
  const treeSitter = await getTreeSitterProvider();

  // Compute extension once per file and carry it through — used by the
  // filter, the read step, and the provider dispatch.
  const candidates: Array<{ relPath: string; ext: string }> = [];
  for (const f of files) {
    if (f.sensitive) continue;
    const ext = normalizedExtension(f);
    if (!treeSitter.supports(ext) && !REGEX_SUPPORTED.has(ext)) continue;
    candidates.push({ relPath: f.path, ext });
    if (candidates.length >= MAX_FILES) break;
  }

  // Read concurrently — file system is the bottleneck, same logic as
  // the embedding indexer in retrieval.ts. The path-traversal guard
  // lives inside readTextUnderRoot.
  const loaded = await Promise.all(
    candidates.map(async (c) => {
      const text = await readTextUnderRoot(rootPath, c.relPath, READ_BUDGET);
      return text == null ? null : { ...c, text };
    }),
  );

  // Extract serially — parsing is CPU-bound and single-threaded.
  const rows: SymbolRow[] = [];
  for (const entry of loaded) {
    if (!entry) continue;
    const { relPath, ext, text } = entry;
    const drafts =
      treeSitter.ready && treeSitter.supports(ext)
        ? treeSitter.extract(text, ext)
        : extractWithRegex(text, ext);
    for (const d of drafts) {
      rows.push({ workspaceId, path: relPath, ...d });
    }
  }

  // Replace, don't merge — same reasoning as the embedding indexer.
  dbClearWorkspaceSymbols(workspaceId);
  if (rows.length > 0) dbInsertSymbols(rows);
  return { symbols: rows.length };
}
