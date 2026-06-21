import { test } from "node:test";
import assert from "node:assert/strict";
import type { Settings } from "@ariadne/shared";
import { resolveEscalation } from "../config.js";

// resolveEscalation only reads provider + model off the settings, so a minimal
// stand-in is enough to exercise the local + premium-guard branches (the cloud
// branch delegates to resolveTierSettings, which depends on configured keys).
const S = (provider: string, model: string): Settings =>
  ({ provider, model } as unknown as Settings);

const INSTALLED = ["qwen3:0.6b", "qwen3:4b", "qwen3:8b", "nomic-embed-text:latest"];

test("no escalation when the task isn't hard", () => {
  assert.equal(resolveEscalation(S("ollama", "qwen3:4b"), false, INSTALLED), null);
});

test("local user → biggest installed local model on a hard task (free, private)", () => {
  const esc = resolveEscalation(S("ollama", "qwen3:4b"), true, INSTALLED);
  assert.equal(esc?.provider, "ollama");
  assert.equal(esc?.model, "qwen3:8b");
});

test("local escalation ignores embedding models (no size tag)", () => {
  const esc = resolveEscalation(S("ollama", "qwen3:4b"), true, ["nomic-embed-text:latest", "qwen3:4b"]);
  assert.equal(esc, null);
});

test("local user already on the biggest local model → no escalation", () => {
  assert.equal(resolveEscalation(S("ollama", "qwen3:8b"), true, INSTALLED), null);
});

test("a premium model is never escalated, even on a hard task", () => {
  assert.equal(resolveEscalation(S("anthropic", "claude-opus-4-7"), true, INSTALLED), null);
});
