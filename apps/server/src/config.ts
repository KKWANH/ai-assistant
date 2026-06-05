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
 * own machine). The desktop build moves this to the OS keychain
 * (DESKTOP_APP_PLAN §4.4) — keep key reads going through here so that swap
 * stays local to this function.
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
