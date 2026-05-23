/**
 * Shared file-read helpers for the indexers — symbol, embedding, and
 * any future per-file scanner. The duplicated triple of "resolve under
 * root + read + truncate at budget + skip on error" used to live in
 * three places; centralising it here keeps the path-traversal guard
 * (security-flavoured) and the byte-budget (perf-flavoured) in one
 * auditable spot.
 */
import fs from "node:fs";
import path from "node:path";
import type { FileMeta } from "@ariadne/shared";
import { safeResolveUnderRoot } from "../security/pathGuard.js";

/**
 * Read a UTF-8 text file under `root`, truncated at `maxBytes`. Returns
 * null if the path escapes `root` or the read fails (missing file, EPERM,
 * binary content, …). The caller decides what "skip" means — usually
 * continue past the file in the indexing loop.
 */
export async function readTextUnderRoot(
  root: string,
  relPath: string,
  maxBytes: number,
): Promise<string | null> {
  const abs = safeResolveUnderRoot(root, relPath);
  if (!abs) return null;
  try {
    const buf = await fs.promises.readFile(abs, "utf-8");
    return buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
  } catch {
    return null;
  }
}

/**
 * Normalize a file's extension to the lowercase form (no leading dot).
 * Used by every indexer's per-extension dispatch. `FileMeta.extension`
 * is supposed to be pre-normalised by the scanner but a fallback path
 * in `gasp/filter.ts` constructs metas without that guarantee, so the
 * defensive normalisation stays load-bearing.
 */
export function normalizedExtension(f: Pick<FileMeta, "path" | "extension">): string {
  return (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();
}
