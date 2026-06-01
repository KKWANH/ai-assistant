import type { ProviderId, Settings } from "@ariadne/shared";
import { PROVIDER_REGISTRY } from "@ariadne/shared";
import { resolveProviderKey } from "../config.js";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderImage {
  mediaType: string;
  dataBase64: string;
}

export interface CompleteRequest {
  system: string;
  prompt: string;
  json?: boolean;
  /**
   * If supplied, enforce a JSON schema on the response. Providers that
   * support guided/constrained decoding (OpenAI `response_format:
   * json_schema`, vLLM xgrammar) restrict token choices to the schema
   * → parse failures become impossible. Providers that don't (Anthropic,
   * Gemini, Ollama, Moonshot's older endpoints) fall back to `json:
   * true` and the same downstream `extractJson` + `JSON.parse` path.
   * Implies `json: true`.
   *
   * Shape: a JSON Schema draft-07 object (without the `$schema` line
   * unless the provider needs it). Example:
   *   { type: "object", required: ["steps"], properties: { steps:
   *     { type: "array", items: { type: "object", ... } } } }
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Abort signal — cancels the underlying provider call when triggered. */
  signal?: AbortSignal;
}

export interface CompleteWithImagesRequest extends CompleteRequest {
  images: ProviderImage[];
}

export interface AiProvider {
  id: ProviderId;
  complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }>;
  /** Optional — if undefined the provider does not support vision. */
  completeWithImages?(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }>;
  /**
   * Stream a completion, calling `onDelta` for each text chunk.
   * `<think>…</think>` blocks are intercepted: their content is NOT emitted as
   * deltas; instead `onStatus` is called with "Thinking…" and they are stripped
   * from the final returned text.
   */
  completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }>;
}

/**
 * Process a streaming chunk for <think>…</think> blocks.
 * Returns the portion that should be emitted as a delta, plus updated state.
 */
export function processThinkBlocks(
  chunk: string,
  _fullTextSoFar: string,
  inThink: boolean,
  thinkBuf: string,
  onStatus?: (s: string) => void,
): { emitted: string; buffered: string; nowInThink: boolean; statusFired: boolean } {
  let emitted = "";
  let buffered = thinkBuf;
  let nowInThink = inThink;
  let statusFired = false;

  // Process character by character for correctness
  let i = 0;
  while (i < chunk.length) {
    if (!nowInThink) {
      const thinkStart = chunk.indexOf("<think>", i);
      if (thinkStart === -1) {
        emitted += chunk.slice(i);
        break;
      }
      // Emit everything before <think>
      emitted += chunk.slice(i, thinkStart);
      nowInThink = true;
      statusFired = true;
      if (onStatus) onStatus("Thinking…");
      i = thinkStart + 7; // skip "<think>"
      buffered = "";
    } else {
      const thinkEnd = chunk.indexOf("</think>", i);
      if (thinkEnd === -1) {
        buffered += chunk.slice(i);
        break;
      }
      // End of think block — discard buffer
      buffered = "";
      nowInThink = false;
      i = thinkEnd + 8; // skip "</think>"
    }
  }

  return { emitted, buffered, nowInThink, statusFired };
}

/** Strip markdown code fences and extract the first valid JSON object or array. */
export function extractJson(raw: string): string {
  // Remove ```json...``` or ```...``` fences
  let s = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();

  // Find the first { or [
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");

  let start = -1;
  if (objStart === -1 && arrStart === -1) return s;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);

  s = s.slice(start);

  // Find matching closing bracket
  const open = s[0] ?? "";
  const close = open === "{" ? "}" : "]";
  if (open !== "{" && open !== "[") return s;
  let depth = 0;
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  return end === -1 ? s : s.slice(0, end + 1);
}

/**
 * Per-process provider instance cache, keyed by `${id}|${model}`.
 *
 * Without this, every chat message instantiates a fresh SDK client; the
 * underlying HTTPS keep-alive pool then has to warm up from scratch for the
 * first request. Caching the provider keeps that pool hot across turns and
 * shaves a measurable slice off TTFT on warm processes.
 */
const providerCache = new Map<string, AiProvider>();

export async function getProvider(settings: Pick<Settings, "provider" | "model">): Promise<AiProvider> {
  const { provider, model } = settings;
  const key = `${provider}|${model}`;
  const cached = providerCache.get(key);
  if (cached) return cached;

  let instance: AiProvider;
  switch (provider) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      instance = new AnthropicProvider(model, resolveProviderKey("anthropic"));
      break;
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      instance = new OpenAIProvider(model, { apiKey: resolveProviderKey("openai") });
      break;
    }
    case "moonshot": {
      const { MoonshotProvider } = await import("./openai.js");
      instance = new MoonshotProvider(model, resolveProviderKey("moonshot"));
      break;
    }
    case "ollama": {
      const { OllamaProvider } = await import("./openai.js");
      instance = new OllamaProvider(model);
      break;
    }
    case "vllm": {
      const { VllmProvider } = await import("./openai.js");
      instance = new VllmProvider(model);
      break;
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini.js");
      instance = new GeminiProvider(model, resolveProviderKey("gemini"));
      break;
    }
    case "mock": {
      const { MockProvider } = await import("./mock.js");
      instance = new MockProvider();
      break;
    }
    default: {
      // Registry-driven: any openai-compatible provider (e.g. minimax) needs
      // no bespoke case — the generic client is driven by its descriptor's
      // { baseURL, envKey }. Falls back to mock for anything unrecognised.
      const desc = PROVIDER_REGISTRY[provider];
      if (desc?.kind === "openai-compatible" && desc.baseURL) {
        const { OpenAICompatibleProvider } = await import("./openai.js");
        instance = new OpenAICompatibleProvider(provider, model, desc.baseURL, resolveProviderKey(provider));
      } else {
        const { MockProvider } = await import("./mock.js");
        instance = new MockProvider();
      }
      break;
    }
  }
  providerCache.set(key, instance);
  return instance;
}
