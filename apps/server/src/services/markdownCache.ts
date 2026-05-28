/**
 * markdownCache — hash-keyed disk cache for markitdown extractions.
 *
 * Stored under <workspaceRoot>/.ariadne/cache/markdown/<sha256>.md so
 * the cache lives WITH the workspace (portable, gitignored, easy to
 * blow away). The file name is the SHA-256 of the source file contents;
 * if the source file changes, the hash changes, and we re-extract.
 *
 * Reads are O(1). Writes are atomic (write-then-rename) so a crashed
 * server never leaves a half-written cache entry.
 *
 * Sized cap: each entry is at most CACHE_FILE_LIMIT (default 2MB of
 * markdown). Larger entries are stored truncated with a "[...truncated]"
 * marker — markdown for a 500-page PDF can otherwise eat hundreds of MB
 * of cache before the user notices.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import logger from "../logger.js";
import { convertToMarkdown, MARKITDOWN_FORMATS, getMarkitdownStatus } from "./markitdown.js";

const CACHE_FILE_LIMIT = 2 * 1024 * 1024;

function cacheDirFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".ariadne", "cache", "markdown");
}

function cachePathFor(workspaceRoot: string, hash: string): string {
  return path.join(cacheDirFor(workspaceRoot), `${hash}.md`);
}

/** Compute the SHA-256 of the file at `absPath`. Used as the cache key
 *  so a file change forces a re-extract on the next request. */
async function fileHash(absPath: string): Promise<string> {
  const data = await readFile(absPath);
  return createHash("sha256").update(data).digest("hex");
}

export interface MarkdownExtractResult {
  /** Markdown body. Truncated to CACHE_FILE_LIMIT if the source was huge. */
  markdown: string;
  /** Where it came from this request. */
  source: "cache" | "markitdown" | "fallback";
  /** Hash key used. */
  hash: string;
  /** Bytes returned. */
  bytes: number;
  /** Was the result truncated to fit the cache cap. */
  truncated: boolean;
}

/** Get-or-compute markdown for a file. Tries cache first, then
 *  markitdown if available, then throws — callers handle the
 *  fall-back themselves so the legacy extractor paths stay isolated. */
export async function getOrExtractMarkdown(
  workspaceRoot: string,
  absPath: string,
): Promise<MarkdownExtractResult> {
  const ext = path.extname(absPath).toLowerCase();
  if (!MARKITDOWN_FORMATS.has(ext)) {
    throw new Error(`extension ${ext} not in markitdown supported set`);
  }
  const hash = await fileHash(absPath);
  const cachePath = cachePathFor(workspaceRoot, hash);

  // Cache hit
  try {
    const cached = await readFile(cachePath, "utf8");
    return {
      markdown: cached,
      source: "cache",
      hash,
      bytes: Buffer.byteLength(cached),
      truncated: cached.endsWith("[...truncated]\n"),
    };
  } catch {
    // Miss — fall through to extraction.
  }

  if (!getMarkitdownStatus().available) {
    throw new Error("markitdown not available — caller should fall back");
  }
  let md = await convertToMarkdown(absPath);
  let truncated = false;
  if (Buffer.byteLength(md) > CACHE_FILE_LIMIT) {
    // Keep the head + 2KB tail so the AI sees the document structure
    // even after truncation. Marker line tells the consumer the result
    // is partial.
    md = md.slice(0, CACHE_FILE_LIMIT - 2048) + "\n\n[...truncated]\n";
    truncated = true;
  }
  await mkdir(cacheDirFor(workspaceRoot), { recursive: true });
  // Atomic write-then-rename so a partial write never appears as cached.
  const tmpPath = cachePath + ".tmp-" + process.pid;
  await writeFile(tmpPath, md, "utf8");
  await rename(tmpPath, cachePath);
  logger.info({ absPath, hash, bytes: md.length, truncated }, "markitdown cache write");

  return { markdown: md, source: "markitdown", hash, bytes: Buffer.byteLength(md), truncated };
}

/** Quick existence check without reading or extracting. Used by the
 *  workspace snapshot to surface a "markdown ready" badge. */
export async function isMarkdownCached(workspaceRoot: string, absPath: string): Promise<{ cached: boolean; bytes: number | null }> {
  try {
    const hash = await fileHash(absPath);
    const st = await stat(cachePathFor(workspaceRoot, hash));
    return { cached: true, bytes: st.size };
  } catch {
    return { cached: false, bytes: null };
  }
}
