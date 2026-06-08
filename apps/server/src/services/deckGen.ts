/**
 * Deck generation — turn a topic (+ the week's materials) into a real .pptx
 * lecture deck. Two steps: an LLM writes a structured outline (title slide +
 * content slides with bullets, speaker notes, and a per-slide image query),
 * then pptxgenjs renders it as a clean academic deck. The same outline backs
 * the in-app HTML preview, so one structure drives both.
 */
import * as PptxNS from "pptxgenjs";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";

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
  addNotes(notes: string): void;
}
interface PptxInstance {
  layout: string;
  readonly ShapeType: { line: unknown };
  addSlide(): PptxSlide;
  write(opts: { outputType: "nodebuffer" }): Promise<Buffer>;
}

export interface DeckSlide {
  title: string;
  bullets: string[];
  notes?: string;
  /** English image-search terms for one supporting image (or empty). */
  imageQuery?: string;
}
export interface Deck {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
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
): Promise<Deck> {
  const system =
    "You are a lecture-slide author. Produce a clear, academic slide deck: a title plus 8–12 " +
    "content slides. Each content slide has a short title, 3–5 concise bullet points (not full " +
    "sentences), speaker notes of 2–4 sentences the lecturer will read aloud, and an imageQuery: " +
    "ENGLISH search terms for ONE supporting image (artist + work + medium for art topics), or an " +
    "empty string. Write titles, bullets, and notes in the SAME language as the topic. When " +
    "materials are provided, ground the content STRICTLY in them — never invent facts, dates, or " +
    "names. Reply with ONLY the JSON deck.";
  const prompt =
    `Topic: ${topic}\n\n` +
    (grounding.trim()
      ? `Materials to ground in:\n${grounding.slice(0, 8000)}`
      : "(No materials provided — use general knowledge and stay factual.)");
  const { text } = await provider.complete({ system, prompt, json: true, jsonSchema: DECK_SCHEMA, signal });
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

/** Render step — a clean academic .pptx (16:9) from the outline. */
export async function buildPptx(deck: Deck): Promise<Buffer> {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in (16:9)
  const ACCENT = "C0392B";
  const INK = "1A1A1A";

  // Title slide.
  const title = p.addSlide();
  title.background = { color: "FFFFFF" };
  title.addShape(p.ShapeType.line, { x: 0.7, y: 2.5, w: 3, h: 0, line: { color: ACCENT, width: 3 } });
  title.addText(deck.title, { x: 0.7, y: 2.7, w: 11.9, h: 1.6, fontSize: 40, bold: true, color: INK });
  if (deck.subtitle) {
    title.addText(deck.subtitle, { x: 0.7, y: 4.3, w: 11.9, h: 0.8, fontSize: 20, color: "666666" });
  }

  // Content slides.
  for (const s of deck.slides) {
    const sl = p.addSlide();
    sl.background = { color: "FFFFFF" };
    sl.addText(s.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: INK });
    sl.addShape(p.ShapeType.line, { x: 0.6, y: 1.32, w: 12.1, h: 0, line: { color: "E0E0E0", width: 1 } });
    if (s.bullets.length > 0) {
      sl.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, fontSize: 18, color: "333333", paraSpaceAfter: 10 } })),
        { x: 0.8, y: 1.6, w: 11.7, h: 5.2, valign: "top" },
      );
    }
    if (s.notes) sl.addNotes(s.notes);
  }

  return p.write({ outputType: "nodebuffer" });
}
