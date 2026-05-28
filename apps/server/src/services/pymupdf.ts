/**
 * pymupdf — second PDF → markdown backend, optimised for Korean content.
 *
 * Why we have both this and markitdown:
 *
 *   markitdown (pdfplumber/pdfminer.six)
 *     - Strong for English, structured PDFs with clean text streams
 *     - Handles MS Office formats (DOCX/PPTX/XLSX/HTML)
 *     - Known to mis-decode Korean font CMaps in HWP-origin PDFs —
 *       symptom is mojibake / empty strings where Korean text should be
 *
 *   pymupdf (MuPDF engine via pymupdf4llm)
 *     - Better Korean text extraction, especially for HWP-origin PDFs
 *     - Recognises headings → emits markdown `##` (markitdown emits
 *       plain paragraphs at the same point)
 *     - PDF only — no DOCX/PPTX/etc.
 *
 * Strategy: routes accept a `backend` parameter. When unset (auto),
 * Korean detection picks pymupdf for PDFs likely to contain Korean
 * (we sniff a small sample of pages first), markitdown for everything
 * else.
 *
 * Invocation: scripts/pymupdf_extract.py (Python wrapper). Same
 * subprocess + stdout pattern as markitdown.ts so the boundary stays
 * language-agnostic.
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = path.resolve(
  path.dirname(__filename),
  "..",
  "..",
  "scripts",
  "pymupdf_extract.py",
);

interface PyMuPDFStatus {
  available: boolean;
  pythonPath: string | null;
  scriptPath: string;
}

let status: PyMuPDFStatus = { available: false, pythonPath: null, scriptPath: SCRIPT_PATH };

/** Detect a Python with `pymupdf4llm` installed at server boot. */
export async function detectPyMuPDF(): Promise<PyMuPDFStatus> {
  const explicit = process.env["PYTHON_PATH"]?.trim() || process.env["PYTHON3_PATH"]?.trim();
  const candidates = [explicit, "python3", "python"].filter(Boolean) as string[];
  for (const cand of candidates) {
    try {
      if (cand.startsWith("/")) await access(cand, FS.X_OK);
      // Confirm pymupdf4llm is importable in this interpreter.
      await runCmd(cand, ["-c", "import pymupdf4llm"], 5000);
      status = { available: true, pythonPath: cand, scriptPath: SCRIPT_PATH };
      logger.info({ pythonPath: cand }, "pymupdf detected — Korean PDF backend enabled");
      return status;
    } catch { /* try next */ }
  }
  status = { available: false, pythonPath: null, scriptPath: SCRIPT_PATH };
  logger.info("pymupdf not available — install via `pip install pymupdf4llm` for Korean PDF extraction");
  return status;
}

export function getPyMuPDFStatus(): PyMuPDFStatus {
  return status;
}

/** Convert a PDF to markdown via pymupdf4llm. Throws on missing python,
 *  bad exit, or empty output. Caller decides whether to fall back. */
export async function convertPdfWithPyMuPDF(absPath: string, timeoutMs = 30_000): Promise<string> {
  if (!status.available || !status.pythonPath) {
    throw new Error("pymupdf not installed — pip install pymupdf4llm");
  }
  const md = await runCmd(status.pythonPath, [SCRIPT_PATH, absPath], timeoutMs);
  if (!md.trim()) throw new Error(`pymupdf produced empty output for ${absPath}`);
  return md;
}

/** Sniff the first ~4KB of pymupdf's output for Hangul codepoints.
 *  Used by the auto-backend chooser: if the previous backend's output
 *  contains <5% Hangul but the doc filename / size suggests Korean
 *  content, swap to pymupdf. */
export function containsHangul(text: string): boolean {
  // Hangul Syllables U+AC00–U+D7A3, Jamo U+1100–U+11FF, Compat Jamo U+3130–U+318F.
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(text);
}

/** Heuristic Korean-content detector: returns true if more than the
 *  threshold fraction of the sample's letters are Hangul. */
export function looksKorean(text: string, threshold = 0.10): boolean {
  const sample = text.slice(0, 4000);
  let letters = 0;
  let hangul = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    // Letters: ASCII alpha or any non-space non-punct multibyte.
    if (c >= 33) letters += 1;
    if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F)) hangul += 1;
  }
  return letters > 0 && hangul / letters >= threshold;
}

function runCmd(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", PYTHONPATH: process.env["PYTHONPATH"] ?? "" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (b) => stdout.push(b));
    child.stderr.on("data", (b) => stderr.push(b));
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${bin} timeout after ${timeoutMs}ms`));
      if (code !== 0) {
        return reject(new Error(`${bin} exit ${code}: ${Buffer.concat(stderr).toString("utf8").trim() || "(no stderr)"}`));
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}
