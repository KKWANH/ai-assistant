/**
 * markdownQueue — background converter that warms the markdown cache
 * after every workspace scan.
 *
 * Called from scanner.ts inside a setImmediate so the scan response
 * returns immediately. Concurrency-limited (default 3) so a 200-file
 * workspace doesn't spawn 200 markitdown subprocesses simultaneously
 * and starve the box.
 *
 * Skips files that are already cached (sha256-keyed) so a second scan
 * is essentially a no-op when nothing has changed.
 *
 * Per-file failures are logged and counted but never abort the queue;
 * one corrupt PPTX shouldn't block the other 50 from converting.
 */

import path from "node:path";
import type { FileMeta } from "@ariadne/shared";
import logger from "../logger.js";
import {
  getOrExtractMarkdown,
  isMarkdownCached,
} from "./markdownCache.js";
import {
  MARKITDOWN_FORMATS,
  getMarkitdownStatus,
} from "./markitdown.js";

const DEFAULT_CONCURRENCY = 3;
/** Max files converted per scan. Higher = warmer cache, slower scans.
 *  Big enough for a typical lecture archive (one semester ≈ 30 files);
 *  beyond this the user can rescan to convert the rest. */
const PER_SCAN_LIMIT = 50;
/** Cap individual files at this size. A 500MB PDF is almost always a
 *  scanned manuscript dump and would lock markitdown for minutes. */
const MAX_FILE_BYTES = 80 * 1024 * 1024;

export interface QueueResult {
  /** Total files in MARKITDOWN_FORMATS that were considered. */
  considered: number;
  /** Already cached, skipped. */
  alreadyCached: number;
  /** Skipped because larger than MAX_FILE_BYTES. */
  oversized: number;
  /** Successfully converted this run. */
  converted: number;
  /** Conversion threw — logged with reason. */
  failed: number;
}

/** Run the conversion queue for one workspace. Returns counts; the
 *  caller logs them. Non-throwing — internal failures just go in
 *  the `failed` bucket. */
export async function queueWorkspaceMarkdown(
  workspaceRoot: string,
  files: FileMeta[],
  opts: { concurrency?: number; limit?: number } = {},
): Promise<QueueResult> {
  if (!getMarkitdownStatus().available) {
    // No markitdown → no queue. Return zeroes so the caller log is quiet.
    return { considered: 0, alreadyCached: 0, oversized: 0, converted: 0, failed: 0 };
  }
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const limit = Math.max(1, opts.limit ?? PER_SCAN_LIMIT);

  // Filter to convertible formats. We keep the original FileMeta around
  // so logs can carry the path for debugging.
  const candidates = files.filter((f) => MARKITDOWN_FORMATS.has(path.extname(f.path).toLowerCase()));
  const result: QueueResult = {
    considered: candidates.length,
    alreadyCached: 0,
    oversized: 0,
    converted: 0,
    failed: 0,
  };
  if (candidates.length === 0) return result;

  // Cheap cache existence check first — most of a steady-state workspace
  // is already converted, so this short-circuits the bulk of the list.
  const toConvert: FileMeta[] = [];
  for (const f of candidates) {
    if (toConvert.length >= limit) break;
    if (f.size > MAX_FILE_BYTES) {
      result.oversized += 1;
      continue;
    }
    const absPath = path.join(workspaceRoot, f.path);
    const cached = await isMarkdownCached(workspaceRoot, absPath);
    if (cached.cached) {
      result.alreadyCached += 1;
      continue;
    }
    toConvert.push(f);
  }

  if (toConvert.length === 0) return result;

  // Concurrency-limited worker pool. Iterate workers, each pulling from
  // the shared queue until empty. Simpler than a generic p-limit dep.
  let idx = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (idx < toConvert.length) {
        const myIdx = idx++;
        const f = toConvert[myIdx]!;
        const absPath = path.join(workspaceRoot, f.path);
        try {
          await getOrExtractMarkdown(workspaceRoot, absPath);
          result.converted += 1;
        } catch (err) {
          result.failed += 1;
          logger.debug({ path: f.path, err: String((err as Error).message) }, "queue: convert failed");
        }
      }
    })());
  }
  await Promise.all(workers);
  return result;
}
