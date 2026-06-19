import path from "node:path";

/** AI providers Ariadne can route to. v0.1 picks one at a time.
 *  ADD A PROVIDER: append its id here AND add an entry to PROVIDER_REGISTRY
 *  below. For an OpenAI-compatible API that is the whole job — the server
 *  factory, Settings UI, model choices, pricing and vision flags all derive
 *  from the registry. */
export const PROVIDERS = [
  "anthropic",
  "openai",
  "gemini",
  "moonshot",
  "minimax",
  "ollama",
  "vllm",
  "mock",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** How the server instantiates a provider. "openai-compatible" needs no
 *  bespoke class — the generic OpenAICompatibleProvider drives it from the
 *  descriptor's { baseURL, envKey }. */
export type ProviderKind =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openai-compatible"
  | "ollama"
  | "vllm"
  | "mock";

export interface ModelEntry {
  /** Model string passed to the provider API. */
  id: string;
  /** Friendly brand label (proper noun, not translated). */
  label: string;
  /** i18n key for the one-line trait shown in the model picker. */
  traitKey: string;
  speed: "fast" | "normal" | "slow";
  costTier: "low" | "mid" | "premium";
  /** Accepts image input. Default false. */
  vision?: boolean;
  /** API list price, USD per 1M tokens. Omit for free/local. */
  pricing?: { inUsd: number; outUsd: number };
  /** Keep out of the picker but still resolve cost for historical usage. */
  hidden?: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Env var holding the API key; also the settings-table key id
   *  (`providerKey:<id>`). Omit for keyless providers (ollama/mock). */
  envKey?: string;
  /** Base URL for openai-compatible providers. */
  baseURL?: string;
  /** Runs on the user's own machine/network — no API-key billing. */
  local?: boolean;
  /** Hide from user-facing provider pickers (kept in PROVIDERS so it still
   *  validates + works as an internal fallback). Used for `mock`. */
  hidden?: boolean;
  defaultModel: string;
  models: ModelEntry[];
}

/**
 * SINGLE SOURCE OF TRUTH for every provider + model. The tables below
 * (labels, defaults, choices, pricing, vision) are DERIVED from this — do not
 * hand-maintain them. Pricing is USD per 1M tokens from public list prices
 * (2025–2026); `hidden` models are off-menu but kept so historical usage
 * still costs correctly. The vllm/ollama defaults are hints — the server
 * resolves Ollama to an installed model, and vLLM serves whatever it was
 * launched with.
 */
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDescriptor> = {
  anthropic: {
    id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet", traitKey: "model.trait.sonnet", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 3, outUsd: 15 } },
      { id: "claude-opus-4-7", label: "Claude Opus", traitKey: "model.trait.opus", speed: "slow", costTier: "premium", vision: true, pricing: { inUsd: 15, outUsd: 75 } },
      { id: "claude-haiku-4-5", label: "Claude Haiku", traitKey: "model.trait.haiku", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.8, outUsd: 4 } },
    ],
  },
  openai: {
    id: "openai", label: "OpenAI", kind: "openai", envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o", label: "GPT-4o", traitKey: "model.trait.gpt4o", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 2.5, outUsd: 10 } },
      { id: "gpt-4o-mini", label: "GPT-4o mini", traitKey: "model.trait.gpt4oMini", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.15, outUsd: 0.6 } },
      { id: "o3-mini", label: "o3-mini", traitKey: "model.trait.o3mini", speed: "normal", costTier: "low", pricing: { inUsd: 1.1, outUsd: 4.4 } },
    ],
  },
  gemini: {
    id: "gemini", label: "Google Gemini", kind: "gemini", envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-3.5-flash",
    models: [
      { id: "gemini-3.5-flash", label: "Gemini Flash", traitKey: "model.trait.geminiFlash", speed: "fast", costTier: "mid", vision: true, pricing: { inUsd: 1.5, outUsd: 9 } },
      { id: "gemini-3.1-flash-lite", label: "Gemini Flash-Lite", traitKey: "model.trait.geminiFlashLite", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.1, outUsd: 0.4 } },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", traitKey: "model.trait.geminiFlash", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.15, outUsd: 0.6 }, hidden: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", traitKey: "model.trait.geminiFlash", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 1.25, outUsd: 10 }, hidden: true },
    ],
  },
  moonshot: {
    id: "moonshot", label: "Moonshot / Kimi", kind: "openai", envKey: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2.6",
    models: [
      { id: "kimi-k2.6", label: "Kimi K2", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.55, outUsd: 2.65 } },
      { id: "moonshot-v1-128k", label: "Moonshot v1 128k", traitKey: "model.trait.kimi", speed: "normal", costTier: "mid", pricing: { inUsd: 1.63, outUsd: 6.53 } },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.81, outUsd: 3.26 } },
      { id: "kimi-for-coding", label: "Kimi for Coding", traitKey: "model.trait.kimiCoding", speed: "normal", costTier: "low", pricing: { inUsd: 0, outUsd: 0 } },
      { id: "kimi-k2-0711-preview", label: "Kimi K2 (preview)", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.6, outUsd: 2.5 }, hidden: true },
    ],
  },
  minimax: {
    id: "minimax", label: "MiniMax", kind: "openai-compatible", envKey: "MINIMAX_API_KEY",
    baseURL: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M2.5",
    // Pricing USD/1M tokens (minimax.io, 2026): M2.5 = 0.15/1.15 and M2 =
    // 0.26/1.00 are confirmed list prices; M3/M2.7/M2.1 are approximated to the
    // M2.5 tier (verify on the pricing page if exact cost reporting matters for
    // those). Without an entry costOf() would report $0 for this paid provider.
    models: [
      { id: "MiniMax-M2.5", label: "MiniMax M2.5", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.15, outUsd: 1.15 } },
      { id: "MiniMax-M3", label: "MiniMax M3", traitKey: "model.trait.minimax", speed: "normal", costTier: "mid", pricing: { inUsd: 0.15, outUsd: 1.15 } },
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.15, outUsd: 1.15 } },
      { id: "MiniMax-M2.1", label: "MiniMax M2.1", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.15, outUsd: 1.15 } },
      { id: "MiniMax-M2", label: "MiniMax M2", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.26, outUsd: 1.0 } },
    ],
  },
  ollama: {
    id: "ollama", label: "Ollama (local)", kind: "ollama", local: true,
    defaultModel: "qwen3:8b",
    models: [
      { id: "qwen3:8b", label: "Qwen 3 (8B)", traitKey: "model.trait.qwen8b", speed: "normal", costTier: "low" },
      { id: "qwen3:4b", label: "Qwen 3 (4B)", traitKey: "model.trait.qwen4b", speed: "fast", costTier: "low" },
      { id: "qwen3:0.6b", label: "Qwen 3 (0.6B)", traitKey: "model.trait.qwen06b", speed: "fast", costTier: "low" },
    ],
  },
  vllm: {
    id: "vllm", label: "vLLM (self-hosted)", kind: "vllm", local: true,
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    models: [
      { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen 2.5 7B (vLLM)", traitKey: "model.trait.vllm", speed: "fast", costTier: "low" },
      { id: "Qwen/Qwen2.5-14B-Instruct", label: "Qwen 2.5 14B (vLLM)", traitKey: "model.trait.vllm", speed: "normal", costTier: "low" },
      { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B (vLLM)", traitKey: "model.trait.vllm", speed: "fast", costTier: "low" },
    ],
  },
  mock: {
    id: "mock", label: "Mock (no API key)", kind: "mock", local: true, hidden: true,
    defaultModel: "mock",
    models: [
      { id: "mock", label: "Mock", traitKey: "model.trait.mock", speed: "fast", costTier: "low", vision: true },
    ],
  },
};

const REGISTRY_LIST: ProviderDescriptor[] = PROVIDERS.map((id) => PROVIDER_REGISTRY[id]);

/** Human labels for the Settings UI. (derived — edit PROVIDER_REGISTRY) */
export const PROVIDER_LABELS: Record<ProviderId, string> = Object.fromEntries(
  REGISTRY_LIST.map((p) => [p.id, p.label]),
) as Record<ProviderId, string>;

/** Default model per provider. (derived) */
export const DEFAULT_MODELS: Record<ProviderId, string> = Object.fromEntries(
  REGISTRY_LIST.map((p) => [p.id, p.defaultModel]),
) as Record<ProviderId, string>;

/** Providers offered in user-facing pickers — everything except `hidden` ones
 *  (mock). `PROVIDERS` still includes them so they validate + work internally. */
export const SELECTABLE_PROVIDERS: ProviderId[] = PROVIDERS.filter(
  (p) => !PROVIDER_REGISTRY[p].hidden,
);

/** Suggested model choices surfaced in the Settings UI. (derived; hidden excluded) */
export const MODEL_CHOICES: Record<ProviderId, string[]> = Object.fromEntries(
  REGISTRY_LIST.map((p) => [p.id, p.models.filter((m) => !m.hidden).map((m) => m.id)]),
) as Record<ProviderId, string[]>;

/**
 * Pricing table: USD per 1 million tokens (input / output). (derived)
 * Ollama, mock, vLLM and any unlisted model have no entry → treated as free.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = Object.fromEntries(
  REGISTRY_LIST.flatMap((p) =>
    p.models
      .filter((m) => m.pricing)
      .map((m) => [m.id, { input: m.pricing!.inUsd, output: m.pricing!.outUsd }]),
  ),
);

/**
 * Compute USD cost for a given model and token counts.
 * If the model is not in the pricing table it is treated as free (returns 0).
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Known-vision-capable models. The composer uses this to guard image
 * attachments — without the guard, a user attaches a photo to a chat
 * with qwen3:8b active, the model cheerfully accepts and then replies
 * "I cannot view images" which reads as a broken app (non-dev report N4).
 *
 * Keep this list manually for the named hosted models. For Ollama
 * (and other unknown locals) we infer from the model id: anything
 * containing "vision", "llava", "bakllava", or "moondream" is treated
 * as vision-capable. Everything else returns false — safer to false-
 * negative an obscure vision model (user picks a different one) than
 * false-positive a text model (user hits the dead-end).
 */
const VISION_CAPABLE_MODELS = new Set<string>(
  REGISTRY_LIST.flatMap((p) => p.models.filter((m) => m.vision).map((m) => m.id)),
);

export function modelHasVision(model: string): boolean {
  if (VISION_CAPABLE_MODELS.has(model)) return true;
  return /vision|llava|bakllava|moondream/i.test(model);
}

/**
 * Read an env var safely. This module is imported by the browser bundle too,
 * where `process` does not exist — so every access must be guarded.
 */
function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

/** Resolved network ports. Overridable by env so the daemon can relocate. */
export const PORTS = {
  server: Number(env("ARIADNE_PORT") ?? 4319),
  admin: Number(env("ARIADNE_ADMIN_PORT") ?? 7459),
};

/** Default file globs for a new workspace. */
export const DEFAULT_INCLUDE = [
  "**/*.md",
  "**/*.txt",
  "**/*.csv",
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.pdf",
  "**/*.docx",
  "**/*.xlsx",
];
export const DEFAULT_EXCLUDE = [
  ".git/**",
  "node_modules/**",
  ".ariadne/**",
  "*.env",
];

/** Id of the built-in, non-deletable tutorial workspace seeded on first boot. */
export const TUTORIAL_WORKSPACE_ID = "ariadne-tutorial";

/** Id of the built-in, non-deletable demo workspace (the Portfolio showcase). */
export const DEMO_WORKSPACE_ID = "ariadne-demo-portfolio";

/** Whether a workspace id is one of the built-in (seeded, non-deletable) ones. */
export function isBuiltinWorkspace(id: string): boolean {
  return id === TUTORIAL_WORKSPACE_ID || id === DEMO_WORKSPACE_ID;
}

/** Sensitive path patterns excluded by default. */
export const SENSITIVE_PATTERNS = [
  "*.env",
  "*secret*",
  "*password*",
  "credentials.*",
  "private_key.*",
  "id_rsa",
  ".ssh/**",
  "bank/**",
  "tax/**",
  "passport/**",
  "visa/**",
];

export interface AriadnePaths {
  /** Repo / install root. */
  root: string;
  /** App data home (registry DB lives here). */
  home: string;
  /** Central SQLite registry + metadata index. */
  db: string;
  /** Active log directory. */
  logs: string;
  /** Rotated-log archive directory. */
  archive: string;
  /** PID files + tunnel URL. */
  run: string;
}

/**
 * Resolve all runtime paths from an install root. The daemon control script
 * exports ARIADNE_HOME / ARIADNE_LOG_DIR / ARIADNE_RUN_DIR; defaults sit
 * inside the repo so a bare `npm run` also works.
 */
export function resolvePaths(root: string): AriadnePaths {
  const logs = env("ARIADNE_LOG_DIR") ?? path.join(root, "logs");
  const home = env("ARIADNE_HOME") ?? path.join(root, "data");
  return {
    root,
    home,
    db: path.join(home, "ariadne.db"),
    logs,
    archive: path.join(logs, "archive"),
    run: env("ARIADNE_RUN_DIR") ?? path.join(root, "run"),
  };
}
