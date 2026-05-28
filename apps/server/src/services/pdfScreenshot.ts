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
import { createCanvas } from "@napi-rs/canvas";
import logger from "../logger.js";

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
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
    // Disable workers + font/image fetches we can't fulfil server-side.
    useWorker: false,
    isEvalSupported: false,
    disableFontFace: true,
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
