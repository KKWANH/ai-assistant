/**
 * PDF text extraction with OCR fallback.
 *
 * Strategy:
 *   1. Try pdfjs-dist (legacy build) to extract text layer.
 *   2. If result is empty / very short (<100 chars after trimming), the PDF is
 *      likely scanned. Render the first few pages to PNG via @napi-rs/canvas
 *      and OCR them via the active provider's completeWithImages.
 *   3. All steps wrapped in try/catch with clear fallback text.
 */

import type { AiProvider } from "../providers/index.js";
import logger from "../logger.js";

const MIN_TEXT_CHARS = 100;
const OCR_MAX_PAGES = 4;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractPdfText(
  buffer: Buffer,
  provider?: AiProvider,
): Promise<string> {
  // --- Step 1: pdfjs text layer ---
  let text = "";
  try {
    text = await extractWithPdfJs(buffer);
  } catch (err) {
    logger.warn({ err }, "pdfjs extraction failed");
  }

  if (text.trim().length >= MIN_TEXT_CHARS) {
    return capText(text);
  }

  // --- Step 2: OCR fallback ---
  if (provider?.completeWithImages) {
    try {
      const ocrText = await ocrWithCanvas(buffer, provider);
      if (ocrText.trim().length > 0) {
        return capText(ocrText);
      }
    } catch (err) {
      logger.warn({ err }, "PDF OCR fallback failed");
    }
  }

  // --- Final fallback ---
  if (text.trim().length > 0) return capText(text);
  return "[Could not extract text from PDF — the file may be scanned or corrupted]";
}

// ---------------------------------------------------------------------------
// pdfjs-dist extraction
// ---------------------------------------------------------------------------

async function extractWithPdfJs(buffer: Buffer): Promise<string> {
  // Use the legacy (non-esm) build so we can import it in Node ESM context
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(() =>
    import("pdfjs-dist")
  );

  // pdfjs needs a Uint8Array
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  const numPages = Math.min(pdf.numPages, 50); // cap at 50 pages

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => {
        // TextItem has .str; TextMarkedContent does not
        const ti = item as { str?: string };
        return ti.str ?? "";
      })
      .join(" ");
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Canvas render + OCR
// ---------------------------------------------------------------------------

async function ocrWithCanvas(buffer: Buffer, provider: AiProvider): Promise<string> {
  // Lazy import so the server still starts even if @napi-rs/canvas is absent
  let createCanvas: ((w: number, h: number) => import("@napi-rs/canvas").Canvas) | undefined;
  try {
    const canvasMod = await import("@napi-rs/canvas");
    createCanvas = canvasMod.createCanvas;
  } catch {
    return "";
  }
  if (!createCanvas) return "";

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(() =>
    import("pdfjs-dist")
  );

  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const numPages = Math.min(pdf.numPages, OCR_MAX_PAGES);

  const ocrParts: string[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    // @napi-rs/canvas exposes a canvas context compatible with OffscreenCanvas
    const context = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    await page.render({ canvasContext: context, viewport }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    const dataBase64 = pngBuffer.toString("base64");

    const { text } = await provider.completeWithImages!({
      system: "You are an OCR assistant. Extract all visible text from the provided image faithfully.",
      prompt: "Transcribe all text in this image. Preserve layout where possible.",
      images: [{ mediaType: "image/png", dataBase64 }],
    });

    ocrParts.push(text);
  }

  return ocrParts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capText(text: string): string {
  if (text.length <= 12000) return text;
  return text.slice(0, 6000) + "\n\n[...truncated...]\n\n" + text.slice(-2000);
}
