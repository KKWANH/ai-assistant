import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReplanAfterBatch } from "./agent.js";

type Opts = Parameters<typeof shouldReplanAfterBatch>[0];
function opts(over: Partial<Opts>): Opts {
  return {
    testFailure: false,
    anyFailed: false,
    allLowInformation: false,
    isLast: false,
    replansUsed: 0,
    nextStepIndex: 1,
    ...over,
  };
}

// ── The new behaviour: a failing test repairs even as the last step ──────────

test("failing test on the LAST step triggers a repair (fix-until-tests-pass)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ testFailure: true, isLast: true })), true);
});

test("failing test does not repair once the replan budget is exhausted", () => {
  assert.equal(
    shouldReplanAfterBatch(opts({ testFailure: true, isLast: true, replansUsed: 99 })),
    false,
  );
});

test("failing test does not repair when no step room remains", () => {
  assert.equal(
    shouldReplanAfterBatch(opts({ testFailure: true, isLast: true, nextStepIndex: 99 })),
    false,
  );
});

// ── No regression: every pre-existing trigger keeps its old meaning ──────────

test("a generic failure on the LAST step does NOT replan (unchanged)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ anyFailed: true, isLast: true })), false);
});

test("low information on the LAST step does NOT replan (unchanged)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ allLowInformation: true, isLast: true })), false);
});

test("a generic failure mid-plan replans (unchanged)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ anyFailed: true, isLast: false })), true);
});

test("low information mid-plan replans (unchanged)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ allLowInformation: true, isLast: false })), true);
});

test("a failing test mid-plan replans (unchanged)", () => {
  assert.equal(shouldReplanAfterBatch(opts({ testFailure: true, isLast: false })), true);
});

test("nothing triggered → no replan", () => {
  assert.equal(shouldReplanAfterBatch(opts({ isLast: false })), false);
});
