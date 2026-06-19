import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelevantWithinBudget } from "./retrieval.js";

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
