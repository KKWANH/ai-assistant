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
import { existsSync } from "node:fs";
import path from "node:path";
import logger from "../logger.js";
import { convertToMarkdown, MARKITDOWN_FORMATS, getMarkitdownStatus } from "./markitdown.js";
import { convertPdfWithPyMuPDF, getPyMuPDFStatus, looksKorean } from "./pymupdf.js";

/** Extraction backend. "auto" (default) picks per-file. */
export type ExtractBackend = "auto" | "markitdown" | "pymupdf";

const CACHE_FILE_LIMIT = 2 * 1024 * 1024;

function cacheDirFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".ariadne", "cache", "markdown");
}

function cachePathFor(workspaceRoot: string, hash: string, backend?: ExtractBackend): string {
  // AZ — backend goes into the filename suffix so swapping backends gives
  // a fresh extract while keeping both side-by-side for comparison. The
  // default (no suffix) is the auto-picked or markitdown result for
  // backwards compatibility with AX/AY cache entries.
  const suffix = backend && backend !== "auto" ? `.${backend}` : "";
  return path.join(cacheDirFor(workspaceRoot), `${hash}${suffix}.md`);
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
  source: "cache" | "markitdown" | "pymupdf" | "fallback";
  /** Which backend produced the markdown (cache results carry the
   *  original backend). */
  backend: "markitdown" | "pymupdf";
  /** Hash key used. */
  hash: string;
  /** Bytes returned. */
  bytes: number;
  /** Was the result truncated to fit the cache cap. */
  truncated: boolean;
}

/** Pick the best backend for a file. "auto" inspects the format +
 *  (for PDF) a quick Korean sniff to choose pymupdf over markitdown
 *  for Korean PDFs. */
async function chooseBackend(absPath: string, requested: ExtractBackend): Promise<"markitdown" | "pymupdf"> {
  if (requested === "markitdown" || requested === "pymupdf") return requested;
  const ext = path.extname(absPath).toLowerCase();
  // pymupdf is PDF-only — non-PDF formats always go through markitdown.
  if (ext !== ".pdf") return "markitdown";
  // Both backends available? Sniff first KB of pymupdf's pages-as-text
  // (cheap, ~50ms for small PDFs) and pick pymupdf when the doc is
  // Korean-heavy. If pymupdf isn't installed, fall through to markitdown.
  if (!getPyMuPDFStatus().available) return "markitdown";
  if (!getMarkitdownStatus().available) return "pymupdf";
  try {
    // Cheap probe: pymupdf is fast on the first page; we just want a
    // signal whether the content is Korean.
    const sample = await convertPdfWithPyMuPDF(absPath, 8000);
    return looksKorean(sample) ? "pymupdf" : "markitdown";
  } catch {
    // Probe failed (corrupt PDF, etc.) — defer to markitdown which has
    // its own OCR fallback path.
    return "markitdown";
  }
}

/** Get-or-compute markdown for a file. AZ — `backend` lets the caller
 *  pin a specific extractor (markitdown / pymupdf) or leave at "auto"
 *  for per-file dispatching (pymupdf for Korean PDFs, markitdown
 *  otherwise). Cache key includes the backend so swapping doesn't
 *  serve a stale result. */
export async function getOrExtractMarkdown(
  workspaceRoot: string,
  absPath: string,
  backend: ExtractBackend = "auto",
): Promise<MarkdownExtractResult> {
  const ext = path.extname(absPath).toLowerCase();
  if (!MARKITDOWN_FORMATS.has(ext) && ext !== ".pdf") {
    throw new Error(`extension ${ext} not supported by any backend`);
  }
  const chosen = await chooseBackend(absPath, backend);
  const hash = await fileHash(absPath);
  const cachePath = cachePathFor(workspaceRoot, hash, chosen);

  // Cache hit
  try {
    const cached = await readFile(cachePath, "utf8");
    return {
      markdown: cached,
      source: "cache",
      backend: chosen,
      hash,
      bytes: Buffer.byteLength(cached),
      truncated: cached.endsWith("[...truncated]\n"),
    };
  } catch {
    // Miss — fall through to extraction.
  }

  // Run the chosen backend, falling back to the other if it throws.
  let md: string;
  let usedBackend: "markitdown" | "pymupdf" = chosen;
  try {
    md = chosen === "pymupdf"
      ? await convertPdfWithPyMuPDF(absPath)
      : await convertToMarkdown(absPath);
  } catch (primaryErr) {
    const otherAvailable = chosen === "pymupdf"
      ? getMarkitdownStatus().available
      : getPyMuPDFStatus().available && ext === ".pdf";
    if (!otherAvailable) throw primaryErr;
    logger.warn(
      { absPath, primary: chosen, err: String((primaryErr as Error).message) },
      "primary backend failed — falling back",
    );
    usedBackend = chosen === "pymupdf" ? "markitdown" : "pymupdf";
    md = usedBackend === "pymupdf"
      ? await convertPdfWithPyMuPDF(absPath)
      : await convertToMarkdown(absPath);
  }

  let truncated = false;
  if (Buffer.byteLength(md) > CACHE_FILE_LIMIT) {
    md = md.slice(0, CACHE_FILE_LIMIT - 2048) + "\n\n[...truncated]\n";
    truncated = true;
  }
  await mkdir(cacheDirFor(workspaceRoot), { recursive: true });
  const finalCachePath = cachePathFor(workspaceRoot, hash, usedBackend);
  const tmpPath = finalCachePath + ".tmp-" + process.pid;
  await writeFile(tmpPath, md, "utf8");
  await rename(tmpPath, finalCachePath);
  logger.info({ absPath, hash, bytes: md.length, truncated, backend: usedBackend }, "markdown cache write");

  return {
    markdown: md,
    source: usedBackend,
    backend: usedBackend,
    hash,
    bytes: Buffer.byteLength(md),
    truncated,
  };
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

/** AX — sync existence check by pre-computed hash. AZ: also checks the
 *  backend-suffixed variants (e.g. `<hash>.pymupdf.md`) so the "md"
 *  badge appears regardless of which extractor produced the cache. */
export function isMarkdownCachedByHashSync(workspaceRoot: string, hash: string): boolean {
  return (
    existsSync(cachePathFor(workspaceRoot, hash)) ||
    existsSync(cachePathFor(workspaceRoot, hash, "markitdown")) ||
    existsSync(cachePathFor(workspaceRoot, hash, "pymupdf"))
  );
}
