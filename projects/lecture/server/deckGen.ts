/**
 * Deck generation — turn a topic (+ the week's materials) into a real .pptx
 * lecture deck. Two steps: an LLM writes a structured outline (title slide +
 * content slides with bullets, speaker notes, and a per-slide image query),
 * then pptxgenjs renders it as a clean academic deck. The same outline backs
 * the in-app HTML preview, so one structure drives both.
 */
import * as PptxNS from "pptxgenjs";
import type { Deck } from "../types.js";
import type { AiProvider } from "@ariadne/server/src/providers/index.js";
import { extractJson } from "@ariadne/server/src/providers/index.js";
import { parsePublicHttpUrl } from "@ariadne/server/src/services/search.js";

// pptxgenjs is CJS; under tsx/esbuild the constructor ends up one or two
// `.default` hops deep. Walk down until we hit the actual function.
function resolveCtor(mod: unknown): new () => PptxInstance {
  let c: unknown = mod;
  while (c && typeof c !== "function" && typeof (c as { default?: unknown }).default !== "undefined") {
    c = (c as { default: unknown }).default;
  }
  return c as new () => PptxInstance;
}
const PptxGenJS = resolveCtor(PptxNS);

// Minimal structural typing for the bits of pptxgenjs we use.
interface PptxText { text: string; options?: Record<string, unknown> }
interface PptxSlide {
  background?: { color: string };
  addText(text: string | PptxText[], opts: Record<string, unknown>): void;
  addShape(type: unknown, opts: Record<string, unknown>): void;
  addImage(opts: Record<string, unknown>): void;
  addNotes(notes: string): void;
}
interface PptxInstance {
  layout: string;
  readonly ShapeType: { line: unknown };
  addSlide(): PptxSlide;
  write(opts: { outputType: "nodebuffer" }): Promise<Buffer>;
}

const DECK_SCHEMA = {
  name: "lecture_deck",
  schema: {
    type: "object" as const,
    required: ["title", "slides"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      subtitle: { type: "string" },
      slides: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "bullets"],
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
            imageQuery: { type: "string" },
          },
        },
      },
    },
  },
};

/** LLM step — write the deck outline, grounded in `grounding` when provided. */
export async function generateDeckOutline(
  topic: string,
  grounding: string,
  provider: AiProvider,
  signal?: AbortSignal,
  courseMemo = "",
): Promise<Deck> {
  const courseContext = courseMemo.trim()
    ? `\n\nCourse context — keep EVERY slide consistent with the course's thread, teaching ` +
      `style, and student level described here:\n${courseMemo.trim().slice(0, 2000)}`
    : "";
  const system =
    "You are a lecture-slide author. Produce a clear, academic slide deck: a title plus 8–12 " +
    "content slides. Each content slide has a short title, 3–5 concise bullet points (not full " +
    "sentences), speaker notes of 2–4 sentences the lecturer will read aloud, and an imageQuery: " +
    "ENGLISH search terms for ONE supporting image (artist + work + medium for art topics), or an " +
    "empty string. Write titles, bullets, and notes in the SAME language as the topic. Be strictly " +
    "factual: never invent dates, names, or attributions — if unsure, keep a bullet general rather " +
    "than state something that may be wrong. When materials are provided, ground the content " +
    "STRICTLY in them. Reply with ONLY the JSON deck." +
    courseContext;
  const prompt =
    `Topic: ${topic}\n\n` +
    (grounding.trim()
      ? `Materials to ground in:\n${grounding.slice(0, 8000)}`
      : "(No materials provided — use general knowledge and stay factual.)");
  const { text } = await provider.complete({
    system,
    prompt,
    json: true,
    jsonSchema: DECK_SCHEMA,
    signal,
    // The outline is structured selection grounded in the materials, not open
    // reasoning — chain-of-thought roughly doubled the wall time for little
    // gain. Ollama honors this via native /api/chat + the schema as `format`.
    noThink: true,
  });
  const parsed = JSON.parse(extractJson(text)) as Partial<Deck>;
  return {
    title: (parsed.title || topic).slice(0, 200),
    subtitle: parsed.subtitle?.slice(0, 200),
    slides: (parsed.slides ?? []).slice(0, 20).map((s) => ({
      title: (s.title || "").slice(0, 160),
      bullets: (s.bullets ?? []).slice(0, 8).map((b) => String(b).slice(0, 300)),
      notes: s.notes ? String(s.notes).slice(0, 1200) : undefined,
      imageQuery: s.imageQuery ? String(s.imageQuery).slice(0, 120) : undefined,
    })),
  };
}

/**
 * Fetch a picked slide image and return it as a base64 data URI that pptxgenjs
 * can embed (PowerPoint reads jpeg/png/gif). SSRF-guarded and size-capped;
 * best-effort — returns null on any failure so a deck still builds without it.
 */
async function fetchSlideImage(url: string): Promise<string | null> {
  const u = parsePublicHttpUrl(url);
  if (!u) return null;
  try {
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Ariadne/1.0)", Accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!/^image\/(jpeg|png|gif)$/.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8_000_000) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Render step — a clean academic .pptx (16:9) from the outline. Slides that
 *  carry a picked imageUrl get the image embedded on the right, bullets left. */
export async function buildPptx(deck: Deck): Promise<Buffer> {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in (16:9)
  const ACCENT = "C0392B";
  const INK = "1A1A1A";

  // Embed any picked images up front (parallel fetch), then build synchronously.
  const images = await Promise.all(
    deck.slides.map((s) => (s.imageUrl ? fetchSlideImage(s.imageUrl) : Promise.resolve(null))),
  );

  // Title slide.
  const title = p.addSlide();
  title.background = { color: "FFFFFF" };
  title.addShape(p.ShapeType.line, { x: 0.7, y: 2.5, w: 3, h: 0, line: { color: ACCENT, width: 3 } });
  title.addText(deck.title, { x: 0.7, y: 2.7, w: 11.9, h: 1.6, fontSize: 40, bold: true, color: INK });
  if (deck.subtitle) {
    title.addText(deck.subtitle, { x: 0.7, y: 4.3, w: 11.9, h: 0.8, fontSize: 20, color: "666666" });
  }

  // Content slides.
  deck.slides.forEach((s, i) => {
    const img = images[i];
    const sl = p.addSlide();
    sl.background = { color: "FFFFFF" };
    sl.addText(s.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: INK });
    sl.addShape(p.ShapeType.line, { x: 0.6, y: 1.32, w: 12.1, h: 0, line: { color: "E0E0E0", width: 1 } });
    // With an image, bullets take the left ~55%; otherwise full width.
    const bulletW = img ? 6.6 : 11.7;
    if (s.bullets.length > 0) {
      sl.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, fontSize: 18, color: "333333", paraSpaceAfter: 10 } })),
        { x: 0.8, y: 1.6, w: bulletW, h: 5.2, valign: "top" },
      );
    }
    if (img) {
      // Right column: contained image + a small attribution caption.
      sl.addImage({ data: img, x: 7.7, y: 1.6, w: 5.0, h: 4.5, sizing: { type: "contain", w: 5.0, h: 4.5 } });
      if (s.imageCredit) {
        sl.addText(s.imageCredit.slice(0, 160), {
          x: 7.7, y: 6.15, w: 5.0, h: 0.5, fontSize: 9, italic: true, color: "999999", valign: "top",
        });
      }
    }
    if (s.notes) sl.addNotes(s.notes);
  });

  return p.write({ outputType: "nodebuffer" });
}
