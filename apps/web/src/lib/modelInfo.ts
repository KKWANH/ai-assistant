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
import { PROVIDER_REGISTRY, PROVIDERS } from "@ariadne/shared";

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

// Derived from the shared PROVIDER_REGISTRY — the single source of truth for
// models. Add a model there, not here. (traitKey is a plain string in the
// registry; the keys all exist in the i18n dictionaries, so the cast is safe.)
const KNOWN: Record<string, ModelInfo> = Object.fromEntries(
  PROVIDERS.flatMap((pid) =>
    PROVIDER_REGISTRY[pid].models.map((m): [string, ModelInfo] => [
      m.id,
      { label: m.label, traitKey: m.traitKey as TranslationKey, speed: m.speed, costTier: m.costTier },
    ]),
  ),
);

/**
 * Exact API list prices, USD per 1M tokens — derived from PROVIDER_REGISTRY.
 * Models with no `pricing` entry (Ollama, vLLM, mock, unknown) run free.
 */
const MODEL_PRICING: Record<string, ModelPrice> = Object.fromEntries(
  PROVIDERS.flatMap((pid) =>
    PROVIDER_REGISTRY[pid].models
      .filter((m) => m.pricing)
      .map((m): [string, ModelPrice] => [m.id, m.pricing!]),
  ),
);

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
