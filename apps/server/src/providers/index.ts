import type { ProviderId, Settings } from "@ariadne/shared";

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

export async function getProvider(settings: Pick<Settings, "provider" | "model">): Promise<AiProvider> {
  const { provider } = settings;

  switch (provider) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(settings.model);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(settings.model);
    }
    case "moonshot": {
      const { MoonshotProvider } = await import("./openai.js");
      return new MoonshotProvider(settings.model);
    }
    case "ollama": {
      const { OllamaProvider } = await import("./openai.js");
      return new OllamaProvider(settings.model);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini.js");
      return new GeminiProvider(settings.model);
    }
    case "mock":
    default: {
      const { MockProvider } = await import("./mock.js");
      return new MockProvider();
    }
  }
}
