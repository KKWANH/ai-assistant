/**
 * Lecture-script generation — turn a generated deck into the spoken script the
 * lecturer reads, exported as .docx (which Hangul opens). An LLM expands each
 * slide's bullets + notes into 2–4 sentences of flowing narration; the docx
 * lib renders it as a titled document with a section per slide.
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type { Deck } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";

export interface ScriptSection {
  slideTitle: string;
  narration: string;
}
export interface LectureScript {
  sections: ScriptSection[];
}

const SCRIPT_SCHEMA = {
  name: "lecture_script",
  schema: {
    type: "object" as const,
    required: ["sections"],
    additionalProperties: false,
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["slideTitle", "narration"],
          additionalProperties: false,
          properties: {
            slideTitle: { type: "string" },
            narration: { type: "string" },
          },
        },
      },
    },
  },
};

export async function generateScript(
  deck: Deck,
  courseMemo: string,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<LectureScript> {
  const system =
    "You write a lecturer's spoken script for a slide deck. For EACH slide, write 2–4 sentences " +
    "of natural, flowing narration the lecturer reads aloud while that slide is shown — turn the " +
    "bullets and notes into spoken prose, in the SAME language as the deck. Stay accurate to the " +
    "slide; do not add new facts. Reply with ONLY the JSON script." +
    (courseMemo.trim()
      ? `\n\nMatch this course's teaching style and student level:\n${courseMemo.trim().slice(0, 1500)}`
      : "");
  const deckText = deck.slides
    .map(
      (s, i) =>
        `Slide ${(i + 1).toString()}: ${s.title}\nBullets: ${s.bullets.join("; ")}` +
        (s.notes ? `\nNotes: ${s.notes}` : ""),
    )
    .join("\n\n");
  const { text } = await provider.complete({
    system,
    prompt: `Deck: ${deck.title}\n\n${deckText}`,
    json: true,
    jsonSchema: SCRIPT_SCHEMA,
    signal,
  });
  const parsed = JSON.parse(extractJson(text)) as Partial<LectureScript>;
  return {
    sections: (parsed.sections ?? []).slice(0, 30).map((s) => ({
      slideTitle: (s.slideTitle || "").slice(0, 160),
      narration: String(s.narration || "").slice(0, 2000),
    })),
  };
}

/** Render the script as a .docx: deck title, a "강의 스크립트" heading, then a
 *  heading + narration paragraph per slide. */
export async function buildScriptDocx(deckTitle: string, script: LectureScript): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: deckTitle, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "강의 스크립트", heading: HeadingLevel.HEADING_2 }),
  ];
  script.sections.forEach((s, i) => {
    children.push(
      new Paragraph({ text: `${(i + 1).toString()}. ${s.slideTitle}`, heading: HeadingLevel.HEADING_3 }),
    );
    children.push(new Paragraph({ children: [new TextRun(s.narration)], spacing: { after: 200 } }));
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
