import path from "node:path";
import fs from "node:fs";
import { resolvePaths, DEFAULT_MODELS, PROVIDER_LABELS, MODEL_CHOICES, PROVIDERS } from "@ariadne/shared";
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

/** Whether a provider can be used without further setup (API key present, or keyless). */
export function isProviderConfigured(id: ProviderId): boolean {
  switch (id) {
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai": return !!process.env.OPENAI_API_KEY;
    case "gemini": return !!process.env.GEMINI_API_KEY;
    case "moonshot": return !!process.env.MOONSHOT_API_KEY;
    case "ollama": return true; // local — always potentially available
    case "vllm": return !!process.env.VLLM_BASE_URL; // off unless the user pointed at a vLLM server
    case "mock": return true;
    default: return false;
  }
}
