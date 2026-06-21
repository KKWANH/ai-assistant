import path from "node:path";
import fs from "node:fs";
import { resolvePaths, DEFAULT_MODELS, PROVIDER_LABELS, MODEL_CHOICES, PROVIDERS, PROVIDER_REGISTRY } from "@ariadne/shared";
import type { Settings, ProviderStatus, ProviderId } from "@ariadne/shared";
import { dbGetSetting, dbSetSetting } from "./db/repo.js";

// ---------------------------------------------------------------------------
// Root + paths
// ---------------------------------------------------------------------------

/** The repo root — two levels up from apps/server/src/. */
export const REPO_ROOT = path.resolve(new URL("../../../", import.meta.url).pathname);

export const PATHS = resolvePaths(REPO_ROOT);

/** Ensure all runtime directories exist. */
export function ensureDirs(): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  fs.mkdirSync(PATHS.logs, { recursive: true });
  fs.mkdirSync(PATHS.archive, { recursive: true });
  fs.mkdirSync(PATHS.run, { recursive: true });
}

/**
 * GitHub repo (owner/name) used to build pre-filled "new issue" URLs when an
 * admin files a reviewed user report. Override with the GITHUB_REPO env var.
 */
export const GITHUB_REPO = process.env.GITHUB_REPO ?? "KKWANH/ai-assistant";

// ---------------------------------------------------------------------------
// Active provider/model — persisted in the DB settings table
// ---------------------------------------------------------------------------

function resolveDefaultProvider(): ProviderId {
  const env = process.env.ARIADNE_PROVIDER;
  if (env && PROVIDERS.includes(env as ProviderId)) return env as ProviderId;
  // Local-first: a fresh install runs on the machine's own Ollama models.
  return "ollama";
}

export function getActiveSettings(): Settings {
  const provider = (dbGetSetting("provider") ?? resolveDefaultProvider()) as ProviderId;
  const model = dbGetSetting("model") ?? DEFAULT_MODELS[provider];
  return buildSettings(provider, model);
}

/**
 * Triage tier (Tier-1 routing). Pre-flight classifiers (agent / web-search /
 * action-intent / title) are easy classification work, so they can run on a
 * fast, cheap model rather than the reasoning model — the FrugalGPT cascade
 * idea: triage on the cheap tier, reason on the strong one.
 *
 * Routing is OPT-IN via an explicit `triageProvider` (+ optional `triageModel`)
 * setting, so a configured cloud key never silently sends message snippets to a
 * vendor the user didn't pick for triage. With no setting (or one whose
 * provider is no longer configured) triage falls back to the active reasoning
 * model — pre-flight calls are still fused into one round-trip; they just run on
 * the active model instead of a faster tier.
 */
export function getTriageSettings(): Settings {
  const tp = dbGetSetting("triageProvider");
  if (tp && PROVIDERS.includes(tp as ProviderId) && isProviderConfigured(tp as ProviderId)) {
    const model = dbGetSetting("triageModel") ?? DEFAULT_MODELS[tp as ProviderId];
    return buildSettings(tp as ProviderId, model);
  }
  return getActiveSettings();
}

/**
 * Model tiers (MW0 — the routing scaffold the heavy lecture actions ride on).
 *
 * Three rungs, cheapest-capable first:
 *   - "local"           → the machine's own model (qwen3:8b via Ollama). Free,
 *                         private, always available; the default for chat.
 *   - "frontier"        → a cheap cloud workhorse (Gemini 2.5 Flash). The quality
 *                         floor for deliverables — deck outlines, scripts — where
 *                         the local model's scholarship runs thin.
 *   - "frontier-strong" → a strong cloud model (Gemini 2.5 Pro), reserved for the
 *                         few steps that need real reasoning (exam coverage
 *                         checks, a "정밀" escalation). Used sparingly — it's an
 *                         order of magnitude pricier than the workhorse.
 *
 * The point is cost control: send each action to the cheapest rung that clears
 * its quality bar, not everything to the strong model. Resolution is provider-
 * agnostic — the first CONFIGURED cloud provider (Gemini preferred) backs the
 * frontier rungs, and with NO cloud key at all every tier degrades to local, so
 * the features keep working key-less (just on the weaker model).
 */
export type ModelTier = "local" | "frontier" | "frontier-strong";

// Which cloud provider backs the frontier rungs: the first configured one wins,
// so adding only a Gemini key routes all heavy work to Gemini. (Order is the
// project's house preference, not a quality ranking.)
const FRONTIER_PROVIDER_ORDER: ProviderId[] = ["gemini", "anthropic", "openai", "moonshot", "minimax"];

// Explicit model per rung for providers where we've picked specific ids. Gemini
// is the configured choice: 2.5 Flash as the workhorse, 2.5 Pro for escalation.
// An id absent from the provider's registry models is ignored (see pickTierModel),
// so a registry rename degrades gracefully instead of 400ing the vendor API.
const TIER_MODELS: Partial<Record<ProviderId, { frontier: string; strong: string }>> = {
  gemini: { frontier: "gemini-2.5-flash", strong: "gemini-2.5-pro" },
};

/**
 * The model id for a provider's frontier rung: the explicit pick if it's still a
 * valid choice, else a metadata fallback — strong → the provider's own default,
 * frontier → its cheapest non-hidden model (so an unmapped provider still lands
 * on a sane workhorse rather than its premium model).
 */
function pickTierModel(id: ProviderId, rung: "frontier" | "strong"): string {
  // Validate against the full registry (which includes `hidden` models) — the
  // explicit Gemini 2.5 ids are off-menu but still valid for API calls.
  const models = PROVIDER_REGISTRY[id].models;
  const pref = TIER_MODELS[id]?.[rung];
  if (pref && models.some((m) => m.id === pref)) return pref;
  if (rung === "strong") return DEFAULT_MODELS[id];
  const rank: Record<string, number> = { low: 0, mid: 1, premium: 2 };
  const cheapest = [...models]
    .filter((m) => !m.hidden)
    .sort((a, b) => (rank[a.costTier] ?? 9) - (rank[b.costTier] ?? 9) || (a.pricing?.inUsd ?? 9) - (b.pricing?.inUsd ?? 9))[0];
  return cheapest?.id ?? DEFAULT_MODELS[id];
}

/**
 * Resolve a tier to concrete provider/model settings. Heavy actions call this
 * instead of getActiveSettings() so they ride the right rung regardless of the
 * user's chat default. Falls back to local when no cloud provider is configured,
 * so nothing breaks key-less — it just runs on the local model.
 */
export function resolveTierSettings(tier: ModelTier): Settings {
  if (tier === "local") {
    const active = getActiveSettings();
    return PROVIDER_REGISTRY[active.provider].local
      ? active
      : buildSettings("ollama", DEFAULT_MODELS.ollama);
  }
  const provider = FRONTIER_PROVIDER_ORDER.find(
    (id) => !PROVIDER_REGISTRY[id].local && isProviderConfigured(id),
  );
  if (!provider) return resolveTierSettings("local");
  return buildSettings(provider, pickTierModel(provider, tier === "frontier-strong" ? "strong" : "frontier"));
}

/** Parse a local model's parameter size from its tag — the last "Nb" token:
 *  "qwen3:8b" → 8, "qwen3:0.6b" → 0.6, "llama3.1:70b" → 70. 0 when there's no
 *  size tag (e.g. an embedding model), so those never win the "biggest" pick. */
function localParamSize(model: string): number {
  const matches = [...model.matchAll(/(\d+(?:\.\d+)?)\s*b\b/gi)];
  const last = matches[matches.length - 1];
  return last ? Number.parseFloat(last[1]!) : 0;
}

/**
 * Difficulty-aware escalation (D). Given the user's current chat settings and
 * triage's `hard` verdict, return STRONGER settings to answer with — or null to
 * leave the answer on the user's model. Safe by construction:
 *   - Already on a premium model → null (nothing stronger to reach for).
 *   - Local (Ollama) user → escalate WITHIN local to the biggest installed model
 *     (free, private). Never auto-jumps a local user onto a paid cloud model
 *     they didn't pick for chat.
 *   - Cheaper cloud user → escalate to the strong cloud rung (frontier-strong),
 *     when that's a genuine upgrade (not a degrade-to-local, not the same model).
 *   - Nothing genuinely stronger available → null.
 * `installedLocal` is the list from listOllamaModels() (pass [] off the hot path).
 */
export function resolveEscalation(
  current: Settings,
  hard: boolean,
  installedLocal: string[],
): { provider: ProviderId; model: string } | null {
  if (!hard) return null;

  // Already premium → there's nothing above it to escalate to.
  const curMeta = PROVIDER_REGISTRY[current.provider].models.find((m) => m.id === current.model);
  if (curMeta?.costTier === "premium") return null;

  // Local user → biggest installed local model (free + private). Respect the
  // choice to stay local; never escalate them onto a paid cloud model here.
  if (PROVIDER_REGISTRY[current.provider].local) {
    const curSize = localParamSize(current.model);
    const biggest = installedLocal
      .filter((m) => localParamSize(m) > 0)
      .sort((a, b) => localParamSize(b) - localParamSize(a))[0];
    return biggest && localParamSize(biggest) > curSize
      ? { provider: current.provider, model: biggest }
      : null;
  }

  // Cheaper cloud user → the strong cloud rung, when it's a real upgrade.
  const strong = resolveTierSettings("frontier-strong");
  if (strong.provider === current.provider && strong.model === current.model) return null;
  // frontier-strong degrades to local with no cloud key — don't push a cloud
  // user down onto a local model and call it an escalation.
  if (PROVIDER_REGISTRY[strong.provider].local) return null;
  return { provider: strong.provider, model: strong.model };
}

export function saveSettings(provider: ProviderId, model: string): Settings {
  dbSetSetting("provider", provider);
  dbSetSetting("model", model);
  return buildSettings(provider, model);
}

function buildSettings(provider: ProviderId, model: string): Settings {
  const providers: ProviderStatus[] = PROVIDERS.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    configured: isProviderConfigured(id),
    models: MODEL_CHOICES[id],
  }));

  return { provider, model, providers };
}

/**
 * Resolve a provider's API key: an in-app key saved to the settings table
 * (`providerKey:<id>`) wins over the env var, so desktop / non-technical
 * users can paste a key in Settings instead of exporting a shell var.
 * Returns undefined for keyless providers (ollama/vllm/mock) or when neither
 * source is set.
 *
 * Interim storage: settings table, plaintext (local-first DB on the user's
 * own machine). A desktop build would later move key storage to the OS
 * keychain; keeping all key reads behind this one function keeps that swap
 * local.
 */
export function resolveProviderKey(id: ProviderId): string | undefined {
  const envKey = PROVIDER_REGISTRY[id].envKey;
  if (!envKey) return undefined;
  const stored = dbGetSetting(`providerKey:${id}`);
  if (stored && stored.trim()) return stored.trim();
  const fromEnv = process.env[envKey];
  return fromEnv && fromEnv.trim() ? fromEnv : undefined;
}

/** Whether a provider can be used without further setup (API key present, or keyless). */
export function isProviderConfigured(id: ProviderId): boolean {
  const d = PROVIDER_REGISTRY[id];
  if (d.local) {
    // vLLM needs a server URL; ollama/mock are always potentially available.
    if (id === "vllm") return !!process.env.VLLM_BASE_URL;
    return true;
  }
  return !!resolveProviderKey(id);
}
