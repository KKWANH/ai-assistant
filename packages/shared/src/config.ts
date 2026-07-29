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
  /** Where to GET an API key — the provider's console/key page. Surfaced as a
   *  "Get a key →" link next to the key field so setup is one click, not a
   *  search. Omit for keyless providers. */
  keyUrl?: string;
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
    id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", envKey: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-5",
    // Pricing USD/1M tokens, list price (platform.claude.com, ~2026-07).
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet", traitKey: "model.trait.sonnet", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 3, outUsd: 15 } },
      { id: "claude-opus-4-8", label: "Claude Opus", traitKey: "model.trait.opus", speed: "slow", costTier: "premium", vision: true, pricing: { inUsd: 5, outUsd: 25 } },
      { id: "claude-haiku-4-5", label: "Claude Haiku", traitKey: "model.trait.haiku", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 1, outUsd: 5 } },
      // Prior generation — hidden from the picker, kept so historical usage still costs out.
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", traitKey: "model.trait.sonnet", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 3, outUsd: 15 }, hidden: true },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", traitKey: "model.trait.opus", speed: "slow", costTier: "premium", vision: true, pricing: { inUsd: 5, outUsd: 25 }, hidden: true },
    ],
  },
  openai: {
    id: "openai", label: "OpenAI", kind: "openai", envKey: "OPENAI_API_KEY", keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5.4",
    // Pricing USD/1M tokens, list price (platform.openai.com, ~2026-07).
    models: [
      { id: "gpt-5.4", label: "GPT-5.4", traitKey: "model.trait.gpt4o", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 2.5, outUsd: 15 } },
      { id: "gpt-5.4-nano", label: "GPT-5.4 nano", traitKey: "model.trait.gpt4oMini", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.2, outUsd: 1.25 } },
      // Prior generation — hidden from the picker, kept so historical usage still costs out.
      { id: "gpt-4o", label: "GPT-4o", traitKey: "model.trait.gpt4o", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 2.5, outUsd: 10 }, hidden: true },
      { id: "gpt-4o-mini", label: "GPT-4o mini", traitKey: "model.trait.gpt4oMini", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.15, outUsd: 0.6 }, hidden: true },
      { id: "o3-mini", label: "o3-mini", traitKey: "model.trait.o3mini", speed: "normal", costTier: "low", pricing: { inUsd: 1.1, outUsd: 4.4 }, hidden: true },
    ],
  },
  gemini: {
    id: "gemini", label: "Google Gemini", kind: "gemini", envKey: "GEMINI_API_KEY", keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-3.5-flash",
    // Pricing USD/1M tokens, list price (ai.google.dev, ~2026-07).
    models: [
      { id: "gemini-3.5-flash", label: "Gemini Flash", traitKey: "model.trait.geminiFlash", speed: "fast", costTier: "mid", vision: true, pricing: { inUsd: 1.5, outUsd: 9 } },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", traitKey: "model.trait.geminiFlash", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.3, outUsd: 2.5 } },
      { id: "gemini-3.1-flash-lite", label: "Gemini Flash-Lite", traitKey: "model.trait.geminiFlashLite", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.25, outUsd: 1.5 } },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", traitKey: "model.trait.geminiFlash", speed: "normal", costTier: "premium", vision: true, pricing: { inUsd: 2, outUsd: 12 } },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", traitKey: "model.trait.geminiFlash", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 1.25, outUsd: 10 }, hidden: true },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", traitKey: "model.trait.geminiFlashLite", speed: "fast", costTier: "low", vision: true, pricing: { inUsd: 0.1, outUsd: 0.4 }, hidden: true },
    ],
  },
  moonshot: {
    id: "moonshot", label: "Moonshot / Kimi", kind: "openai", envKey: "MOONSHOT_API_KEY", keyUrl: "https://platform.kimi.ai/console/api-keys",
    defaultModel: "kimi-k3",
    // Pricing USD/1M tokens, list cache-miss input (platform.kimi.ai, ~2026-07). Cached input is far cheaper.
    models: [
      // K3 (API live 2026-07-16): 2.8T MoE, native vision, 1M context, always-on
      // max reasoning — the reasoning trace is billed at the OUTPUT rate, so a
      // chatty think can cost more than the visible answer. Pricier than K2.6.
      { id: "kimi-k3", label: "Kimi K3", traitKey: "model.trait.kimi", speed: "normal", costTier: "mid", vision: true, pricing: { inUsd: 3, outUsd: 15 } },
      { id: "kimi-k2.6", label: "Kimi K2.6", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", vision: true, pricing: { inUsd: 0.95, outUsd: 4 } },
      { id: "kimi-k2.5", label: "Kimi K2.5", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.6, outUsd: 3 } },
      { id: "kimi-for-coding", label: "Kimi for Coding", traitKey: "model.trait.kimiCoding", speed: "normal", costTier: "low", pricing: { inUsd: 0, outUsd: 0 } },
      // Legacy / preview — hidden, kept so historical usage still costs out.
      { id: "moonshot-v1-128k", label: "Moonshot v1 128k", traitKey: "model.trait.kimi", speed: "normal", costTier: "mid", pricing: { inUsd: 1.63, outUsd: 6.53 }, hidden: true },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.81, outUsd: 3.26 }, hidden: true },
      { id: "kimi-k2-0711-preview", label: "Kimi K2 (preview)", traitKey: "model.trait.kimi", speed: "normal", costTier: "low", pricing: { inUsd: 0.6, outUsd: 2.5 }, hidden: true },
    ],
  },
  minimax: {
    id: "minimax", label: "MiniMax", kind: "openai-compatible", envKey: "MINIMAX_API_KEY", keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    baseURL: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M3",
    // Pricing USD/1M tokens, list price (platform.minimax.io, ~2026-07). M3 is the
    // current flagship (≤512k context); older M2.x kept hidden for historical cost.
    models: [
      { id: "MiniMax-M3", label: "MiniMax M3", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.3, outUsd: 1.2 } },
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.3, outUsd: 1.2 } },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.15, outUsd: 1.15 }, hidden: true },
      { id: "MiniMax-M2.1", label: "MiniMax M2.1", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.15, outUsd: 1.15 }, hidden: true },
      { id: "MiniMax-M2", label: "MiniMax M2", traitKey: "model.trait.minimax", speed: "normal", costTier: "low", pricing: { inUsd: 0.26, outUsd: 1.0 }, hidden: true },
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
 *
 * `cache` accounts for prompt caching: Anthropic reports cached tokens
 * separately from `inputTokens` (which excludes them), so we price cache reads
 * at ~0.1x the input rate and cache writes at ~1.25x. These fields are only
 * populated by the Anthropic adapter, so its multipliers apply. Omitting `cache`
 * keeps the original two-arg behaviour for every other caller.
 */
export function costOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: { readTokens?: number; creationTokens?: number },
): number {
  const price = MODEL_PRICING[model] ?? { input: 0, output: 0 };
  const cacheRead = (cache?.readTokens ?? 0) * price.input * 0.1;
  const cacheWrite = (cache?.creationTokens ?? 0) * price.input * 1.25;
  return (inputTokens * price.input + outputTokens * price.output + cacheRead + cacheWrite) / 1_000_000;
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

/** User-facing workspace groupings shown as collapsible sidebar sections — the
 *  user's areas of work. A workspace's `section` field holds one of these ids;
 *  null = ungrouped (rendered under a trailing "기타 / Other" group). The order
 *  here is the sidebar order. Labels are i18n keys (resolved in the web app). */
export const WORKSPACE_SECTIONS = [
  { id: "lecture", labelKey: "section.lecture" },
  { id: "thesis", labelKey: "section.thesis" },
  { id: "investment", labelKey: "section.investment" },
  { id: "writing", labelKey: "section.writing" },
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]["id"];

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

/** Id of the built-in, public "자산 현황" sample workspace — a copy of the real
 *  net-worth dashboard view with fully fabricated data (no real finances), so
 *  logged-out visitors and guests can explore the data-driven dashboard +
 *  in-place editing. */
export const ASSETS_SAMPLE_WORKSPACE_ID = "ariadne-sample-assets";

/** Whether a workspace id is one of the built-in (seeded, non-deletable) ones. */
export function isBuiltinWorkspace(id: string): boolean {
  return (
    id === TUTORIAL_WORKSPACE_ID ||
    id === DEMO_WORKSPACE_ID ||
    id === ASSETS_SAMPLE_WORKSPACE_ID
  );
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
