import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelevantWithinBudget, extractRelevantWithinBudgetSemantic } from "./retrieval.js";

// A long document whose relevant passage sits PAST the budget cutoff — exactly
// the case where head-truncation keeps the front matter and loses the answer.
const filler = Array.from(
  { length: 200 },
  (_, i) => `Paragraph ${i.toString()} covers unrelated background material and general prose.`,
).join("\n\n");
const needle = "\n\nKey finding: the migration timeout regression is caused by the zebra connection-pool setting.";
const doc = filler + needle;
const BUDGET = 1500;

test("under budget → returns the document unchanged", () => {
  assert.equal(extractRelevantWithinBudget("a short note", "anything", 1000), "a short note");
});

test("over budget → keeps the relevant passage that head-truncation would drop", () => {
  // Precondition: plain head-truncation does NOT reach the needle.
  assert.ok(!doc.slice(0, BUDGET).includes("zebra"));
  const out = extractRelevantWithinBudget(doc, "zebra connection pool timeout", BUDGET);
  assert.ok(out.includes("zebra"), "extraction should surface the relevant passage");
  assert.ok(out.length <= BUDGET, "extraction must stay within budget");
});

test("empty query → falls back to head-truncation (nothing to rank against)", () => {
  assert.equal(extractRelevantWithinBudget(doc, "", BUDGET), doc.slice(0, BUDGET));
});

test("no query term occurs anywhere → falls back to head-truncation", () => {
  assert.equal(extractRelevantWithinBudget(doc, "platypus", BUDGET), doc.slice(0, BUDGET));
});

// Semantic extractor guards (all return null BEFORE any embedder call, so the
// caller falls back to the instant keyword extractor — no hot-path embed storm).
test("semantic: whitespace query → null (→ keyword fallback)", async () => {
  assert.equal(await extractRelevantWithinBudgetSemantic(doc, "   ", BUDGET), null);
});

test("semantic: document fits the budget → null (no extraction needed)", async () => {
  assert.equal(await extractRelevantWithinBudgetSemantic("short note", "query", 1000), null);
});

test("semantic: very large document → null (caps embedding work)", async () => {
  // > SEMANTIC_MAX_CHUNKS chunks; the cap returns null before touching the
  // embedder, so a huge attachment never triggers hundreds of sequential embeds.
  const huge = Array.from({ length: 150 }, (_, i) =>
    `Section ${i.toString()}: ` +
    "filler sentence with several words to occupy roughly one chunk of space. ".repeat(12),
  ).join("\n\n");
  assert.equal(await extractRelevantWithinBudgetSemantic(huge, "anything specific", 3000), null);
});
