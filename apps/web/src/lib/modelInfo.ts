/**
 * Friendly display info for AI models — used by the model picker and its
 * hover tooltip.
 *
 * `modelInfo()` returns a friendly label, an i18n trait key, and relative
 * speed / cost tiers. `modelPrice()` returns the exact API list price.
 * Human-readable descriptions live in the i18n dictionaries; this module only
 * holds keys and identifiers so it stays language-neutral.
 */
import type { TranslationKey } from "./i18n/en";

export type ModelSpeed = "fast" | "normal" | "slow";
export type ModelCostTier = "low" | "mid" | "premium";

export interface ModelInfo {
  /** Friendly brand name, e.g. "Claude Opus" — a proper noun, not translated. */
  label: string;
  /** i18n key for the one-line characteristic. */
  traitKey: TranslationKey;
  /** Relative response speed. */
  speed: ModelSpeed;
  /** Relative cost tier — shown in easy mode instead of an exact price. */
  costTier: ModelCostTier;
}

/** Exact API list price, USD per 1M tokens. Both 0 → free (runs locally). */
export interface ModelPrice {
  inUsd: number;
  outUsd: number;
}

const KNOWN: Record<string, ModelInfo> = {
  // Anthropic Claude
  "claude-opus-4-7":   { label: "Claude Opus",   traitKey: "model.trait.opus",   speed: "slow",   costTier: "premium" },
  "claude-sonnet-4-6": { label: "Claude Sonnet", traitKey: "model.trait.sonnet", speed: "normal", costTier: "mid" },
  "claude-haiku-4-5":  { label: "Claude Haiku",  traitKey: "model.trait.haiku",  speed: "fast",   costTier: "low" },
  // OpenAI
  "gpt-4o":      { label: "GPT-4o",      traitKey: "model.trait.gpt4o",     speed: "normal", costTier: "mid" },
  "gpt-4o-mini": { label: "GPT-4o mini", traitKey: "model.trait.gpt4oMini", speed: "fast",   costTier: "low" },
  "o3-mini":     { label: "o3-mini",     traitKey: "model.trait.o3mini",    speed: "normal", costTier: "low" },
  // Google Gemini
  "gemini-3.5-flash":      { label: "Gemini Flash",      traitKey: "model.trait.geminiFlash",     speed: "fast", costTier: "mid" },
  "gemini-3.1-flash-lite": { label: "Gemini Flash-Lite", traitKey: "model.trait.geminiFlashLite", speed: "fast", costTier: "low" },
  // Moonshot / Kimi
  "kimi-k2.6":       { label: "Kimi K2",       traitKey: "model.trait.kimi",       speed: "normal", costTier: "low" },
  "kimi-for-coding": { label: "Kimi for Coding", traitKey: "model.trait.kimiCoding", speed: "normal", costTier: "low" },
  // Ollama (local)
  "qwen3:8b":   { label: "Qwen 3 (8B)",   traitKey: "model.trait.qwen8b",  speed: "normal", costTier: "low" },
  "qwen3:4b":   { label: "Qwen 3 (4B)",   traitKey: "model.trait.qwen4b",  speed: "fast",   costTier: "low" },
  "qwen3:0.6b": { label: "Qwen 3 (0.6B)", traitKey: "model.trait.qwen06b", speed: "fast",   costTier: "low" },
  // Mock
  mock: { label: "Mock", traitKey: "model.trait.mock", speed: "fast", costTier: "low" },
};

/**
 * Exact API list prices, USD per 1M tokens (input / output).
 * From official pricing pages, checked 2026-05-22:
 *   Anthropic — platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI    — openai.com/api/pricing
 *   Google    — ai.google.dev/gemini-api/docs/pricing
 *   Moonshot  — kimi.com (Kimi K2.6)
 * Local Ollama models and the mock provider run for free → { 0, 0 }.
 * When adding a new model, look up its current price on the provider's page.
 */
const MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-opus-4-7":       { inUsd: 5,    outUsd: 25 },
  "claude-sonnet-4-6":     { inUsd: 3,    outUsd: 15 },
  "claude-haiku-4-5":      { inUsd: 1,    outUsd: 5 },
  "gpt-4o":                { inUsd: 2.5,  outUsd: 10 },
  "gpt-4o-mini":           { inUsd: 0.15, outUsd: 0.6 },
  "o3-mini":               { inUsd: 1.1,  outUsd: 4.4 },
  "gemini-3.5-flash":      { inUsd: 1.5,  outUsd: 9 },
  "gemini-3.1-flash-lite": { inUsd: 0.25, outUsd: 1.5 },
  "kimi-k2.6":             { inUsd: 0.6,  outUsd: 2.5 },
  // Kimi Code: bundled in Kimi membership ($8-19/mo) with quota-window
  // billing, not per-token. Display as 0 so the cost UI doesn't lie.
  "kimi-for-coding":       { inUsd: 0,    outUsd: 0 },
  "qwen3:8b":   { inUsd: 0, outUsd: 0 },
  "qwen3:4b":   { inUsd: 0, outUsd: 0 },
  "qwen3:0.6b": { inUsd: 0, outUsd: 0 },
  mock:         { inUsd: 0, outUsd: 0 },
};

/** Derive info for a model not in the table (e.g. a user-installed Ollama model).
 *  The size token in the name, if any, gives a rough speed hint. */
function derive(id: string): ModelInfo {
  const sizeMatch = id.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (sizeMatch && sizeMatch[1]) {
    const n = parseFloat(sizeMatch[1]);
    if (n >= 30) return { label: id, traitKey: "model.trait.deriveLarge", speed: "slow", costTier: "low" };
    if (n >= 7) return { label: id, traitKey: "model.trait.deriveMid", speed: "normal", costTier: "low" };
    return { label: id, traitKey: "model.trait.deriveSmall", speed: "fast", costTier: "low" };
  }
  return { label: id, traitKey: "model.trait.deriveGeneric", speed: "normal", costTier: "low" };
}

/** Friendly display info for a model id. Never throws. */
export function modelInfo(id: string): ModelInfo {
  return KNOWN[id] ?? derive(id);
}

/**
 * Exact price for a model, or null when unknown. Any unlisted Ollama-style id
 * (`name:tag`) is treated as a free local model.
 */
export function modelPrice(id: string): ModelPrice | null {
  return MODEL_PRICING[id] ?? (id.includes(":") ? { inUsd: 0, outUsd: 0 } : null);
}
