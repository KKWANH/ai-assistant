/**
 * markitdown wrapper — invokes microsoft/markitdown as a subprocess to
 * convert PDF / DOCX / PPTX / XLSX / HTML to markdown.
 *
 * Why subprocess (not a JS port): markitdown is Python-only and has
 * battle-tested handling for the format quirks we care about (tables in
 * PPTX speaker notes, embedded images, etc.). A native JS port would
 * mean reimplementing python-pptx + pdfplumber + mammoth — months of
 * work for marginal gain.
 *
 * Lifecycle:
 *   - detectMarkitdown() runs once at server boot. If the CLI is on
 *     PATH (or at MARKITDOWN_PATH), we cache the path + version and
 *     gate routes on its availability.
 *   - convertToMarkdown(absPath) spawns markitdown with a 30s timeout
 *     and returns stdout. Per-file failures throw — caller decides
 *     whether to fall back to the legacy text extractor or surface the
 *     error.
 *   - Results are NOT cached here. The caller (markdownCache.ts) owns
 *     the on-disk cache so the cache invariants (hash key, atomic
 *     write) live in one place.
 *
 * Supported by default: pdf, docx, pptx, xlsx, html, htm, xml, csv,
 * json, ipynb, msg, eml, mp3, wav (audio uses LLM transcription —
 * skipped here), zip (recursive). See markitdown docs for full list.
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import logger from "../logger.js";

/** Formats markitdown can convert without additional install steps
 *  (image / audio formats require LLM endpoints; we skip those). */
export const MARKITDOWN_FORMATS = new Set([
  ".pdf", ".docx", ".pptx", ".xlsx", ".xls",
  ".html", ".htm", ".xml",
  ".csv", ".json", ".jsonl", ".ipynb",
  ".msg", ".eml",
]);

interface MarkitdownStatus {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  detectedAt: number;
}

let status: MarkitdownStatus = {
  available: false,
  binaryPath: null,
  version: null,
  detectedAt: 0,
};

/** Probe for markitdown. Respects MARKITDOWN_PATH env override. Runs
 *  once at server boot — re-detection requires a restart. */
export async function detectMarkitdown(): Promise<MarkitdownStatus> {
  const explicit = process.env["MARKITDOWN_PATH"]?.trim();
  // Try the explicit path first, then PATH (just "markitdown").
  const candidates = [explicit, "markitdown"].filter(Boolean) as string[];
  for (const cand of candidates) {
    try {
      // If the candidate is an absolute path, also stat it.
      if (cand.startsWith("/")) {
        await access(cand, FS.X_OK);
      }
      const version = await runMarkitdownArgs(cand, ["--version"], 5000);
      const v = version.trim().split(/\s+/).pop() ?? null;
      status = { available: true, binaryPath: cand, version: v, detectedAt: Date.now() };
      logger.info({ binaryPath: cand, version: v }, "markitdown detected");
      return status;
    } catch {
      // Try next candidate.
    }
  }
  status = { available: false, binaryPath: null, version: null, detectedAt: Date.now() };
  logger.info("markitdown not available — extraction falls back to pdfjs/mammoth");
  return status;
}

export function getMarkitdownStatus(): MarkitdownStatus {
  return status;
}

/** Convert a file to markdown using markitdown. Throws if markitdown
 *  isn't installed, or the subprocess exits non-zero, or stdout is
 *  empty. Caller wraps in try/catch and falls back where appropriate. */
export async function convertToMarkdown(absPath: string, timeoutMs = 30_000): Promise<string> {
  if (!status.available || !status.binaryPath) {
    throw new Error("markitdown not installed — set MARKITDOWN_PATH or pip install markitdown");
  }
  const out = await runMarkitdownArgs(status.binaryPath, [absPath], timeoutMs);
  if (!out.trim()) {
    throw new Error(`markitdown produced empty output for ${absPath}`);
  }
  return out;
}

/** Internal: spawn helper that collects stdout, enforces a timeout,
 *  and rejects on non-zero exit. Used for both --version probing and
 *  conversion. */
function runMarkitdownArgs(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // Don't inherit a wide env — markitdown only needs PATH + HOME.
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => errChunks.push(b));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`markitdown timeout after ${timeoutMs}ms`));
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf8").trim();
        return reject(new Error(`markitdown exit ${code}: ${stderr || "(no stderr)"}`));
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
