/**
 * pdfScreenshot — render a single page of a PDF as a PNG buffer.
 *
 * Powered by pdfjs-dist (already a dep — used by pdfExtract.ts's OCR
 * fallback) + @napi-rs/canvas (also already a dep). No new install.
 *
 * Use case: when a user wants the AI to "see" a slide / figure / chart
 * inside a PDF, request `/api/files/screenshot/pdf/:page` and pipe the
 * returned PNG into a multimodal chat message. The markdown extract
 * (via markitdown) handles text + structure; this handles layout +
 * visuals that don't survive markdown conversion (graphs, photos, equations).
 *
 * Rendering scale defaults to 2x (≈ 192 DPI) which is enough for
 * legible text on retina-class screens while keeping PNGs in the ~150-
 * 400 KB range. Capped at 4x to prevent runaway memory on giant pages.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import logger from "../logger.js";

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

// Point pdfjs at its bundled standard fonts + CMaps (as filesystem paths — a
// file:// URL fails because Node's fetch can't load it). Without these, pdfjs
// skips every text glyph: only shapes/images render, so slide titles, labels,
// and Korean captions vanish from the page image. Resolved once from the
// installed pdfjs-dist (works in dev and in the bundled desktop server).
let pdfAssetOpts: { standardFontDataUrl: string; cMapUrl: string; cMapPacked: true } | null = null;
function pdfAssets(): { standardFontDataUrl: string; cMapUrl: string; cMapPacked: true } {
  if (!pdfAssetOpts) {
    let root = "";
    try {
      root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    } catch {
      /* leave empty — pdfjs falls back to glyph-less rendering (shapes/images only) */
    }
    pdfAssetOpts = {
      standardFontDataUrl: root ? `${path.join(root, "standard_fonts")}/` : "",
      cMapUrl: root ? `${path.join(root, "cmaps")}/` : "",
      cMapPacked: true,
    };
  }
  return pdfAssetOpts;
}

export interface ScreenshotResult {
  buffer: Buffer;
  page: number;
  totalPages: number;
  widthPx: number;
  heightPx: number;
  scale: number;
}

/** Render `page` (1-indexed) of the PDF at `absPath` as a PNG buffer.
 *  Throws on page-out-of-range or render failure. */
export async function renderPdfPage(
  absPath: string,
  page: number,
  scale = 2,
): Promise<ScreenshotResult> {
  const safeScale = Math.min(Math.max(scale, 1), 4);
  const buf = await readFile(absPath);
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    // The legacy build already runs on the main thread (no worker). Disable
    // eval; disableFontFace renders glyphs via paths from the standard-font
    // data below (so text shows up, not just shapes/images).
    isEvalSupported: false,
    disableFontFace: true,
    ...pdfAssets(),
  }).promise;
  try {
    const totalPages = doc.numPages;
    if (page < 1 || page > totalPages) {
      throw new Error(`page ${page} out of range (PDF has ${totalPages})`);
    }
    const pageProxy = await doc.getPage(page);
    const viewport = pageProxy.getViewport({ scale: safeScale });
    const widthPx = Math.ceil(viewport.width);
    const heightPx = Math.ceil(viewport.height);

    const canvas = createCanvas(widthPx, heightPx);
    const ctx = canvas.getContext("2d");
    // pdfjs renders against a white background by default — paint it
    // explicitly so transparent PDFs don't render as black on the
    // canvas's default opaque-black.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, widthPx, heightPx);

    // pdfjs's CanvasRenderingContext2D type and our @napi-rs/canvas
    // surface aren't structurally identical but the runtime API is
    // compatible (basic 2D ops). One assertion at the boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pageProxy.render({ canvasContext: ctx as any, viewport }).promise;

    const png = await canvas.encode("png");
    logger.info({ absPath, page, totalPages, bytes: png.length }, "pdf page rendered");
    return {
      buffer: Buffer.from(png),
      page,
      totalPages,
      widthPx,
      heightPx,
      scale: safeScale,
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Render the first `maxPages` pages of a PDF as PNG buffers, opening the
 * document ONCE (renderPdfPage re-parses the whole PDF per call — wasteful when
 * a chat attachment needs every slide). Returns the rendered pages in order
 * plus the PDF's true page count, so the caller can tell the user when the set
 * was capped. Used to let a vision model SEE attached slides/figures that text
 * extraction drops.
 */
export async function renderPdfPages(
  absPath: string,
  opts: { maxPages?: number; scale?: number } = {},
): Promise<{ pages: { page: number; buffer: Buffer }[]; totalPages: number }> {
  const safeScale = Math.min(Math.max(opts.scale ?? 2, 1), 4);
  const buf = await readFile(absPath);
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    ...pdfAssets(),
  }).promise;
  try {
    const totalPages = doc.numPages;
    const n = Math.min(opts.maxPages ?? totalPages, totalPages);
    const pages: { page: number; buffer: Buffer }[] = [];
    for (let p = 1; p <= n; p++) {
      const pageProxy = await doc.getPage(p);
      const viewport = pageProxy.getViewport({ scale: safeScale });
      const widthPx = Math.ceil(viewport.width);
      const heightPx = Math.ceil(viewport.height);
      const canvas = createCanvas(widthPx, heightPx);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, widthPx, heightPx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pageProxy.render({ canvasContext: ctx as any, viewport }).promise;
      pages.push({ page: p, buffer: Buffer.from(await canvas.encode("png")) });
      pageProxy.cleanup();
    }
    logger.info({ absPath, rendered: pages.length, totalPages }, "pdf pages rendered (multi)");
    return { pages, totalPages };
  } finally {
    await doc.destroy();
  }
}
