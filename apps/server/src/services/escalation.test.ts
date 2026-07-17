import { test } from "node:test";
import assert from "node:assert/strict";
import type { Settings } from "@ariadne/shared";
import { resolveEscalation } from "../config.js";

// resolveEscalation only reads provider + model off the settings, so a minimal
// stand-in is enough. The cloud branch now resolves the strong rung of the
// user's OWN provider via pickTierModel (registry-only, no configured keys),
// so it's testable here too.
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

test("cloud user escalates WITHIN their own provider — never cross-vendor (privacy)", () => {
  // An Anthropic user on a low-tier model escalates to Anthropic's strong rung,
  // NOT to some other configured vendor — their data stays with the vendor they
  // picked. (Regression guard for the cross-vendor escalation bug.)
  const esc = resolveEscalation(S("anthropic", "claude-haiku-4-5"), true, []);
  assert.equal(esc?.provider, "anthropic");
});

test("no escalation when the provider's strong rung equals the current model", () => {
  // claude-sonnet-5 IS Anthropic's resolvable strong rung (its default) → nothing
  // higher to reach for on this provider.
  assert.equal(resolveEscalation(S("anthropic", "claude-sonnet-5"), true, []), null);
});

test("MoE size tag parses as total params, not the active-expert suffix", () => {
  // qwen3:30b-a3b is a 30B model (3B active) — it must outrank a dense 8B.
  const esc = resolveEscalation(S("ollama", "qwen3:8b"), true, ["qwen3:8b", "qwen3:30b-a3b"]);
  assert.equal(esc?.model, "qwen3:30b-a3b");
});

test("a non-Ollama local provider (vLLM) is never handed an Ollama model", () => {
  // Regression: vLLM is local:true, but installedLocal is listOllamaModels() — the
  // local branch must be Ollama-only, or a vLLM user would escalate to a qwen3 tag
  // their server can't serve. vLLM has no strong rung above its default → null.
  assert.equal(resolveEscalation(S("vllm", "Qwen/Qwen2.5-7B-Instruct"), true, ["qwen3:8b"]), null);
});
