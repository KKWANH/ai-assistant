/**
 * libreoffice — headless DOCX/PPTX → PDF conversion for screenshot use.
 *
 * Strategy: convert the doc to PDF in a temp dir, then reuse the
 * existing pdfScreenshot.ts pipeline to render any page. The PDF is
 * cached at <workspace>/.ariadne/cache/pdf/<sha256>.pdf so the
 * expensive LO conversion only runs once per file version.
 *
 * Detection at server boot. Tries:
 *   1. LIBREOFFICE_PATH env override
 *   2. `soffice` on PATH (the LO CLI name on macOS / Linux when LO is
 *      installed via brew / apt)
 *   3. `/Applications/LibreOffice.app/Contents/MacOS/soffice`
 *
 * If none works, the DOCX/PPTX branch of the screenshot route returns
 * 503 with a friendly install hint. PDF screenshots keep working
 * regardless (they don't need LO).
 */

import { spawn } from "node:child_process";
import { access, mkdir, rename, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { constants as FS } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import logger from "../logger.js";

export const LO_FORMATS = new Set([".docx", ".doc", ".pptx", ".ppt", ".odt", ".odp", ".rtf"]);

interface LOStatus {
  available: boolean;
  binaryPath: string | null;
}

let status: LOStatus = { available: false, binaryPath: null };

const APP_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/libreoffice",
  "/usr/bin/soffice",
  "/opt/homebrew/bin/soffice",
];

/** Probe for LibreOffice at boot. Cached for the process lifetime. */
export async function detectLibreoffice(): Promise<LOStatus> {
  const explicit = process.env["LIBREOFFICE_PATH"]?.trim();
  const cands = [explicit, "soffice", "libreoffice", ...APP_CANDIDATES].filter(Boolean) as string[];
  for (const cand of cands) {
    try {
      if (cand.startsWith("/")) {
        await access(cand, FS.X_OK);
        status = { available: true, binaryPath: cand };
        logger.info({ binaryPath: cand }, "libreoffice detected — DOCX/PPTX screenshot enabled");
        return status;
      }
      // PATH lookup via --headless --version (cheap, no GUI).
      await runWithTimeout(cand, ["--headless", "--version"], 8000);
      status = { available: true, binaryPath: cand };
      logger.info({ binaryPath: cand }, "libreoffice detected — DOCX/PPTX screenshot enabled");
      return status;
    } catch { /* try next */ }
  }
  status = { available: false, binaryPath: null };
  logger.info("libreoffice not available — .docx/.pptx screenshot disabled (PDF screenshot still works)");
  return status;
}

export function getLibreofficeStatus(): LOStatus {
  return status;
}

/** Hash a file's contents → cache key. */
async function fileHash(absPath: string): Promise<string> {
  const data = await readFile(absPath);
  return createHash("sha256").update(data).digest("hex");
}

/** Convert a DOCX/PPTX/ODT/RTF to a PDF in the workspace's PDF cache.
 *  Returns the path to the cached PDF. Reuses the existing cache entry
 *  if the source file hasn't changed (sha256-keyed). */
export async function convertToPdfCached(workspaceRoot: string, absSourcePath: string): Promise<string> {
  if (!status.available || !status.binaryPath) {
    throw new Error("LibreOffice not installed — set LIBREOFFICE_PATH or `brew install --cask libreoffice`");
  }
  const ext = path.extname(absSourcePath).toLowerCase();
  if (!LO_FORMATS.has(ext)) {
    throw new Error(`extension ${ext} not in LibreOffice supported set`);
  }
  const hash = await fileHash(absSourcePath);
  const cacheDir = path.join(workspaceRoot, ".ariadne", "cache", "pdf");
  const cachePath = path.join(cacheDir, `${hash}.pdf`);
  if (existsSync(cachePath)) return cachePath;

  await mkdir(cacheDir, { recursive: true });
  // LO converts into the SAME dir as input + outputs there too. To avoid
  // polluting the user's workspace folder, copy into a tmpdir, convert,
  // then move the result into the cache.
  const tmpDir = await mkdir(path.join(os.tmpdir(), `ariadne-lo-${hash.slice(0, 12)}`), { recursive: true });
  const tmpDirPath = typeof tmpDir === "string" ? tmpDir : path.join(os.tmpdir(), `ariadne-lo-${hash.slice(0, 12)}`);
  // Copy input to tmpdir as a stable basename so LO produces a
  // predictable output filename.
  const srcName = `src${ext}`;
  const srcInTmp = path.join(tmpDirPath, srcName);
  await mkdir(tmpDirPath, { recursive: true });
  const fs = await import("node:fs/promises");
  await fs.copyFile(absSourcePath, srcInTmp);

  // --headless: no GUI. --convert-to pdf: target format. --outdir: where
  // to drop the result. Each invocation gets a UserInstallation so
  // parallel conversions don't fight over the same LO profile lock.
  const userProfile = `-env:UserInstallation=file://${tmpDirPath}/profile`;
  await runWithTimeout(
    status.binaryPath,
    [userProfile, "--headless", "--convert-to", "pdf", "--outdir", tmpDirPath, srcInTmp],
    60_000,
  );
  const producedName = `src.pdf`;
  const producedPath = path.join(tmpDirPath, producedName);
  if (!existsSync(producedPath)) {
    throw new Error(`LibreOffice produced no PDF for ${absSourcePath}`);
  }
  // Move into the cache atomically.
  await rename(producedPath, cachePath);
  // Best-effort cleanup of the tmp dir.
  try { await fs.rm(tmpDirPath, { recursive: true, force: true }); } catch { /* */ }
  logger.info({ src: absSourcePath, cachePath, hash }, "libreoffice converted DOCX/PPTX → PDF");
  return cachePath;
}

/** Internal: subprocess runner with timeout. */
function runWithTimeout(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
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
