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

/** Formats we can convert to markdown. Most go through markitdown
 *  directly; `.hwp` (Hangul Word Processor) gets a side-pipeline through
 *  hwp5txt because Korean academic users (notably the maintainer's
 *  mother — the AW commit's motivating use case) live on HWP. */
export const MARKITDOWN_FORMATS = new Set([
  ".pdf", ".docx", ".pptx", ".xlsx", ".xls",
  ".html", ".htm", ".xml",
  ".csv", ".json", ".jsonl", ".ipynb",
  ".msg", ".eml",
  ".hwp",
]);
const HWP_EXTS = new Set([".hwp"]);

interface MarkitdownStatus {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  detectedAt: number;
  /** HWP support — separate binary (hwp5txt), separately probed. */
  hwpAvailable: boolean;
  hwpBinaryPath: string | null;
}

let status: MarkitdownStatus = {
  available: false,
  binaryPath: null,
  version: null,
  detectedAt: 0,
  hwpAvailable: false,
  hwpBinaryPath: null,
};

/** Probe for markitdown + hwp5txt. Respects MARKITDOWN_PATH and
 *  HWP5TXT_PATH env overrides. Runs once at server boot. */
export async function detectMarkitdown(): Promise<MarkitdownStatus> {
  // markitdown
  let mdAvailable = false;
  let mdBinary: string | null = null;
  let mdVersion: string | null = null;
  for (const cand of [process.env["MARKITDOWN_PATH"]?.trim(), "markitdown"].filter(Boolean) as string[]) {
    try {
      if (cand.startsWith("/")) await access(cand, FS.X_OK);
      const v = await runCmd(cand, ["--version"], 5000);
      mdAvailable = true;
      mdBinary = cand;
      mdVersion = v.trim().split(/\s+/).pop() ?? null;
      logger.info({ binaryPath: cand, version: mdVersion }, "markitdown detected");
      break;
    } catch { /* try next */ }
  }
  if (!mdAvailable) {
    logger.info("markitdown not available — extraction falls back to pdfjs/mammoth");
  }

  // hwp5txt (Korean Hangul). Probed independently — users can have
  // either, both, or neither.
  let hwpAvailable = false;
  let hwpBinary: string | null = null;
  for (const cand of [process.env["HWP5TXT_PATH"]?.trim(), "hwp5txt"].filter(Boolean) as string[]) {
    try {
      if (cand.startsWith("/")) await access(cand, FS.X_OK);
      // hwp5txt has no --version; --help exits 0.
      await runCmd(cand, ["--help"], 5000);
      hwpAvailable = true;
      hwpBinary = cand;
      logger.info({ binaryPath: cand }, "hwp5txt detected — .hwp extraction enabled");
      break;
    } catch { /* try next */ }
  }
  if (!hwpAvailable) {
    logger.info("hwp5txt not available — .hwp files will be skipped");
  }

  status = {
    available: mdAvailable, binaryPath: mdBinary, version: mdVersion,
    detectedAt: Date.now(),
    hwpAvailable, hwpBinaryPath: hwpBinary,
  };
  return status;
}

export function getMarkitdownStatus(): MarkitdownStatus {
  return status;
}

/** Convert a file to markdown. Dispatches:
 *   - .hwp → hwp5txt subprocess, output wrapped in a minimal markdown
 *     stub (no structure but plain text is enough for AI context)
 *   - everything else → markitdown
 *  Throws if the relevant binary isn't installed or the subprocess
 *  fails. Caller handles fallback. */
export async function convertToMarkdown(absPath: string, timeoutMs = 30_000): Promise<string> {
  const ext = absPath.slice(absPath.lastIndexOf(".")).toLowerCase();
  if (HWP_EXTS.has(ext)) {
    if (!status.hwpAvailable || !status.hwpBinaryPath) {
      throw new Error("hwp5txt not installed — pip install pyhwp or set HWP5TXT_PATH");
    }
    const text = await runCmd(status.hwpBinaryPath, [absPath], timeoutMs);
    if (!text.trim()) throw new Error(`hwp5txt empty output for ${absPath}`);
    // HWP gives plain text. Wrap with a header so the AI sees the
    // source filename and the markdown chunker still has a heading
    // anchor. No structure inference — that needs a different
    // extractor (LibreOffice → ODT → markdown would be the next step).
    const filename = absPath.split("/").pop() ?? absPath;
    return `# ${filename}\n\n${text}`;
  }
  if (!status.available || !status.binaryPath) {
    throw new Error("markitdown not installed — set MARKITDOWN_PATH or pip install markitdown");
  }
  const out = await runCmd(status.binaryPath, [absPath], timeoutMs);
  if (!out.trim()) throw new Error(`markitdown produced empty output for ${absPath}`);
  return out;
}

/** Internal: spawn helper that collects stdout, enforces a timeout,
 *  and rejects on non-zero exit. Shared by markitdown + hwp5txt. */
function runCmd(bin: string, args: string[], timeoutMs: number): Promise<string> {
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
