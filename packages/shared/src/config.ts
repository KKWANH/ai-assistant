import path from "node:path";

/** AI providers Ariadne can route to. v0.1 picks one at a time. */
export const PROVIDERS = [
  "anthropic",
  "openai",
  "gemini",
  "moonshot",
  "ollama",
  "mock",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Human labels for the Settings UI. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
  moonshot: "Moonshot / Kimi",
  ollama: "Ollama (local)",
  mock: "Mock (no API key)",
};

/**
 * Default model per provider. The Ollama default is sized for a 24GB Mac
 * mini — qwen2.5:14b runs comfortably in unified memory. qwen2.5:32b also
 * fits at q4 but leaves little headroom.
 */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  moonshot: "moonshot-v1-128k",
  ollama: "qwen2.5:14b",
  mock: "mock",
};

/** Suggested model choices surfaced in the Settings UI. */
export const MODEL_CHOICES: Record<ProviderId, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  moonshot: ["moonshot-v1-128k", "moonshot-v1-32k", "kimi-k2-0711-preview"],
  ollama: ["qwen2.5:14b", "qwen2.5:7b", "qwen2.5:32b", "llama3.1:8b"],
  mock: ["mock"],
};

/**
 * Pricing table: USD per 1 million tokens (input / output).
 * Sources: public list prices as of mid-2025.
 * Ollama, mock, and unknown models are free → {input:0, output:0}.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic Claude
  "claude-sonnet-4-6":  { input: 3.00,  output: 15.00 },
  "claude-opus-4-7":    { input: 15.00, output: 75.00 },
  "claude-haiku-4-5":   { input: 0.80,  output: 4.00  },
  // OpenAI
  "gpt-4o":             { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":        { input: 0.15,  output: 0.60  },
  "o3-mini":            { input: 1.10,  output: 4.40  },
  // Google Gemini
  "gemini-2.5-flash":   { input: 0.15,  output: 0.60  },
  "gemini-2.5-pro":     { input: 1.25,  output: 10.00 },
  // Moonshot / Kimi
  "moonshot-v1-128k":   { input: 1.63,  output: 6.53  },
  "moonshot-v1-32k":    { input: 0.81,  output: 3.26  },
  "kimi-k2-0711-preview": { input: 0.60, output: 2.50 },
  // Ollama (local) — free
  "qwen2.5:14b":        { input: 0, output: 0 },
  "qwen2.5:7b":         { input: 0, output: 0 },
  "qwen2.5:32b":        { input: 0, output: 0 },
  "llama3.1:8b":        { input: 0, output: 0 },
  // Mock — free
  "mock":               { input: 0, output: 0 },
};

/**
 * Compute USD cost for a given model and token counts.
 * If the model is not in the pricing table it is treated as free (returns 0).
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
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

/** Default file globs for a new workspace (PRODUCT_PLAN §14.1). */
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

/** Sensitive path patterns excluded by default (PRODUCT_PLAN §12). */
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
