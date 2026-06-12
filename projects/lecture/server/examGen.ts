/**
 * Exam generation — turn a course's materials into a real test, then audit it.
 * This is the first feature that uses BOTH model tiers together (the point of
 * the routing scaffold):
 *
 *   1. generateExam  — Tier F (workhorse): write the items, grounded STRICTLY in
 *      the week's materials, each tagged with the single concept it tests.
 *   2. checkCoverage — Tier F+ (strong): audit the whole exam against the same
 *      materials — which key concepts go UNTESTED, which items test something the
 *      materials never taught (미설명 개념), plus a one-line assessment. Reasoning
 *      over the entire exam-vs-corpus is where the stronger model earns its cost.
 *
 * buildExamDocx renders a printable test: questions, an answer key, and a
 * coverage appendix. .docx so Hangul/Word open it. Mirrors deckGen/scriptGen.
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type {
  Exam,
  ExamItem,
  ExamItemType,
  ExamDifficulty,
  CoverageReport,
} from "../types.js";
import type { AiProvider } from "@ariadne/server/src/providers/index.js";
import { extractJson } from "@ariadne/server/src/providers/index.js";

const ITEM_TYPES: ExamItemType[] = ["객관식", "단답", "서술"];
const DIFFICULTIES: ExamDifficulty[] = ["기초", "심화", "응용"];

const EXAM_SCHEMA = {
  name: "exam",
  schema: {
    type: "object" as const,
    required: ["title", "items"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "question", "answer", "difficulty", "concept"],
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ITEM_TYPES },
            question: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            difficulty: { type: "string", enum: DIFFICULTIES },
            concept: { type: "string" },
          },
        },
      },
    },
  },
};

const COVERAGE_SCHEMA = {
  name: "coverage",
  schema: {
    type: "object" as const,
    required: ["concepts", "untaught", "summary"],
    additionalProperties: false,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          required: ["concept", "tested", "itemCount"],
          additionalProperties: false,
          properties: {
            concept: { type: "string" },
            tested: { type: "boolean" },
            itemCount: { type: "integer" },
          },
        },
      },
      untaught: {
        type: "array",
        items: {
          type: "object",
          required: ["question", "reason"],
          additionalProperties: false,
          properties: { question: { type: "string" }, reason: { type: "string" } },
        },
      },
      summary: { type: "string" },
    },
  },
};

/** Tier F — write the exam items, grounded strictly in the materials. */
export async function generateExam(
  scope: string,
  grounding: string,
  courseMemo: string,
  provider: AiProvider,
  count = 8,
  signal?: AbortSignal,
): Promise<Exam> {
  const system =
    "You are an exam author for a university course. Write exam items grounded STRICTLY in the " +
    "provided course materials — never test anything the materials don't cover. Mix item types " +
    "(객관식 = multiple choice with 4 choices, 단답 = short answer, 서술 = essay) and difficulties " +
    "(기초 = foundational, 심화 = deeper, 응용 = applied). For EACH item give the correct answer (for " +
    "서술, a concise model-answer outline) and tag the single concept it tests. Write everything in " +
    "the SAME language as the materials. Be strictly factual — never invent works, dates, or names. " +
    "Reply with ONLY the JSON exam." +
    (courseMemo.trim() ? `\n\nCourse context (teaching style, student level):\n${courseMemo.trim().slice(0, 1500)}` : "");
  const prompt =
    `Exam scope: ${scope}\nWrite ${count.toString()} items.\n\n` +
    (grounding.trim()
      ? `Course materials to ground in:\n${grounding.slice(0, 8000)}`
      : "(No materials provided — return an empty items array.)");
  const { text } = await provider.complete({
    system,
    prompt,
    json: true,
    jsonSchema: EXAM_SCHEMA,
    signal,
  });
  // Guard the parse: a thin/garbled model reply yields an empty exam, which the
  // route turns into a clean 422, rather than throwing into an opaque 500.
  let parsed: Partial<Exam> = {};
  try {
    parsed = JSON.parse(extractJson(text)) as Partial<Exam>;
  } catch {
    /* malformed JSON → empty exam */
  }
  return {
    title: (parsed.title || scope).slice(0, 200),
    items: (parsed.items ?? []).slice(0, 40).map((it) => ({
      type: ITEM_TYPES.includes(it.type as ExamItemType) ? (it.type as ExamItemType) : "단답",
      question: String(it.question || "").slice(0, 800),
      choices: Array.isArray(it.choices)
        ? it.choices.slice(0, 6).map((c) => String(c).slice(0, 300))
        : undefined,
      answer: String(it.answer || "").slice(0, 1200),
      difficulty: DIFFICULTIES.includes(it.difficulty as ExamDifficulty)
        ? (it.difficulty as ExamDifficulty)
        : "기초",
      concept: String(it.concept || "").slice(0, 120),
    })),
  };
}

/** Tier F+ — audit the exam against the materials (coverage + 미설명 개념 guard). */
export async function checkCoverage(
  exam: Exam,
  grounding: string,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<CoverageReport> {
  const system =
    "You audit an exam against the course materials it was built from. First identify the KEY " +
    "concepts the materials teach; for each, say whether the exam tests it and with how many items. " +
    "Then flag any exam item that tests something the materials do NOT actually cover (a scope or " +
    "recall error), each with a short reason. Finish with a one-sentence assessment of the exam's " +
    "coverage and balance. Reply in the SAME language as the materials, with ONLY the JSON report.";
  const itemsText = exam.items
    .map((it, i) => `${(i + 1).toString()}. [${it.difficulty}/${it.type}] (${it.concept}) ${it.question}`)
    .join("\n");
  const prompt = `Exam: ${exam.title}\n\nItems:\n${itemsText}\n\nCourse materials:\n${grounding.slice(0, 8000)}`;
  const { text } = await provider.complete({
    system,
    prompt,
    json: true,
    jsonSchema: COVERAGE_SCHEMA,
    signal,
  });
  let parsed: Partial<CoverageReport> = {};
  try {
    parsed = JSON.parse(extractJson(text)) as Partial<CoverageReport>;
  } catch {
    /* malformed JSON → empty report */
  }
  return {
    concepts: (parsed.concepts ?? []).slice(0, 40).map((c) => ({
      concept: String(c.concept || "").slice(0, 120),
      tested: !!c.tested,
      itemCount: Math.max(0, Math.min(99, Math.trunc(Number(c.itemCount) || 0))),
    })),
    untaught: (parsed.untaught ?? []).slice(0, 20).map((u) => ({
      question: String(u.question || "").slice(0, 300),
      reason: String(u.reason || "").slice(0, 300),
    })),
    summary: String(parsed.summary || "").slice(0, 600),
  };
}

/** Count items by difficulty — for the coverage appendix and (later) the UI bars. */
export function difficultyMix(items: ExamItem[]): Record<ExamDifficulty, number> {
  const mix: Record<ExamDifficulty, number> = { "기초": 0, "심화": 0, "응용": 0 };
  for (const it of items) mix[it.difficulty]++;
  return mix;
}

const CHOICE_MARKS = ["①", "②", "③", "④", "⑤", "⑥"];

/** Render the exam as a printable .docx: questions, an answer key (own page),
 *  and a coverage appendix (own page). */
export async function buildExamDocx(exam: Exam, coverage: CoverageReport): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: exam.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "문제", heading: HeadingLevel.HEADING_2 }),
  ];

  exam.items.forEach((it, i) => {
    children.push(
      new Paragraph({
        spacing: { before: 150 },
        children: [
          new TextRun({ text: `${(i + 1).toString()}. `, bold: true }),
          new TextRun(it.question),
          new TextRun({ text: `   [${it.difficulty}]`, italics: true, color: "999999" }),
        ],
      }),
    );
    (it.choices ?? []).forEach((c, j) => {
      children.push(new Paragraph({ text: `${CHOICE_MARKS[j] ?? "·"} ${c}`, indent: { left: 360 } }));
    });
  });

  // Answer key on its own page.
  children.push(new Paragraph({ text: "정답", heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
  exam.items.forEach((it, i) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${(i + 1).toString()}. `, bold: true }), new TextRun(it.answer)],
      }),
    );
  });

  // Coverage appendix on its own page.
  children.push(new Paragraph({ text: "출제 커버리지", heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
  children.push(new Paragraph({ children: [new TextRun(coverage.summary)], spacing: { after: 150 } }));
  const mix = difficultyMix(exam.items);
  children.push(
    new Paragraph({ text: `난이도 분포 — 기초 ${mix["기초"].toString()} · 심화 ${mix["심화"].toString()} · 응용 ${mix["응용"].toString()}` }),
  );
  coverage.concepts.forEach((c) => {
    children.push(new Paragraph({ text: `${c.tested ? "✓" : "✗"} ${c.concept} (${c.itemCount.toString()}문항)` }));
  });
  if (coverage.untaught.length > 0) {
    children.push(new Paragraph({ text: "미설명 개념 출제 경고", heading: HeadingLevel.HEADING_3 }));
    coverage.untaught.forEach((u) => {
      children.push(new Paragraph({ text: `• ${u.question} — ${u.reason}` }));
    });
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
