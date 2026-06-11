/**
 * Document fan-out (MW3) — one engine, many deliverables. Rather than a bespoke
 * pipeline per output, a small registry maps a document TYPE to its generation
 * instruction; generateDoc produces a generic {title, sections[]} shape for any
 * type, and buildDocDocx renders any of them. Adding a new deliverable is a
 * registry entry, not a new pipeline. All run on the workhorse tier (F).
 *
 * Mirrors deckGen/scriptGen/examGen: an LLM step + a docx renderer.
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type { DocType, GeneratedDoc } from "../types.js";
import type { AiProvider } from "@ariadne/server/src/providers/index.js";
import { extractJson } from "@ariadne/server/src/providers/index.js";

/** The deliverables the fan-out supports. `label` is the Korean menu label;
 *  `system` is the per-type generation instruction layered on the shared rules. */
export const DOC_SPECS: Record<DocType, { label: string; system: string }> = {
  handout: {
    label: "유인물",
    system:
      "Write a one-to-two page student handout summarizing the week's material: a short framing " +
      "section, then 3–6 sections each with a heading and one tight explanatory paragraph. Plain, " +
      "teachable prose — no filler.",
  },
  worksheet: {
    label: "워크시트",
    system:
      "Write an in-class worksheet: 5–8 practice problems, each a section (heading = '문제 N', body = " +
      "the problem, with a short prompt or sub-questions). Mix recall and application. No answer key.",
  },
  reading: {
    label: "참고문헌",
    system:
      "Write a further-reading list for the topics the materials cover: each section is one suggested " +
      "reading (heading = a real, well-known work or author on this topic; body = one sentence on why " +
      "it's relevant). List ONLY works you are confident actually exist — never fabricate a citation; " +
      "if unsure, describe the KIND of source to look for instead of inventing one.",
  },
  syllabus: {
    label: "강의계획 항목",
    system:
      "Write a syllabus entry for this week as four sections: '주제' (the theme in one line), " +
      "'학습목표' (3–4 objectives), '다룰 내용' (an outline in prose), and '준비물/읽기' (what students " +
      "prepare beforehand).",
  },
};

const DOC_SCHEMA = {
  name: "lecture_document",
  schema: {
    type: "object" as const,
    required: ["title", "sections"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["heading", "body"],
          additionalProperties: false,
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
          },
        },
      },
    },
  },
};

/** Tier F — generate one deliverable, grounded strictly in the week's materials. */
export async function generateDoc(
  type: DocType,
  scope: string,
  grounding: string,
  courseMemo: string,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<GeneratedDoc> {
  const spec = DOC_SPECS[type];
  const system =
    `You are preparing course materials for a university lecturer. ${spec.system} ` +
    "Write in the SAME language as the materials. Ground STRICTLY in them — never invent facts, " +
    "works, dates, or names. Reply with ONLY the JSON document." +
    (courseMemo.trim() ? `\n\nCourse context (style, level):\n${courseMemo.trim().slice(0, 1500)}` : "");
  const prompt =
    `Document: ${spec.label}\nScope: ${scope}\n\n` +
    (grounding.trim()
      ? `Course materials to ground in:\n${grounding.slice(0, 8000)}`
      : "(No materials provided — return an empty sections array.)");
  const { text } = await provider.complete({
    system,
    prompt,
    json: true,
    jsonSchema: DOC_SCHEMA,
    signal,
  });
  const parsed = JSON.parse(extractJson(text)) as Partial<GeneratedDoc>;
  return {
    title: (parsed.title || `${scope} ${spec.label}`).slice(0, 200),
    sections: (parsed.sections ?? []).slice(0, 30).map((s) => ({
      heading: String(s.heading || "").slice(0, 200),
      body: String(s.body || "").slice(0, 3000),
    })),
  };
}

/** Render any generated document as a .docx: title + a heading/body per section. */
export async function buildDocDocx(doc: GeneratedDoc): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE })];
  doc.sections.forEach((s) => {
    if (s.heading) children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ children: [new TextRun(s.body)], spacing: { after: 160 } }));
  });
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
