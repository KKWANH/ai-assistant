import OpenAI from "openai";
import type { ProviderId } from "@ariadne/shared";
import type { AiProvider, ProviderUsage, CompleteRequest, CompleteWithImagesRequest } from "./index.js";
import { extractJson, processThinkBlocks } from "./index.js";

export class OpenAIProvider implements AiProvider {
  readonly id: ProviderId = "openai";
  protected client: OpenAI;
  protected model: string;

  constructor(model: string, opts?: ConstructorParameters<typeof OpenAI>[0]) {
    this.model = model;
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...opts });
  }

  async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    // Prefer json_schema (guided decoding) when caller supplied a schema —
    // OpenAI's json_schema mode constrains generation so parse failures
    // are impossible. vLLM honors the same flag via xgrammar. Fall back
    // to json_object when only `json: true` is set; some old endpoints
    // (older Moonshot, some Ollama models) don't accept either, so the
    // outer try/catch in callers handles those by relying on
    // `extractJson` to salvage the raw text.
    const wantsJson = req.json || !!req.jsonSchema;
    const responseFormat = req.jsonSchema
      ? { type: "json_schema" as const, json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } }
      : req.json
        ? { type: "json_object" as const }
        : undefined;
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }, { signal: req.signal });
    const raw = res.choices[0]?.message.content ?? "";
    const usage = res.usage
      ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
      : undefined;
    return { text: wantsJson ? extractJson(raw) : raw, usage };
  }

  async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      stream: true,
      stream_options: { include_usage: true },
    }, { signal: req.signal });

    let fullText = "";
    let inThink = false;
    let thinkBuf = "";
    let usage: ProviderUsage | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        const { emitted, buffered, nowInThink } = processThinkBlocks(
          delta, fullText, inThink, thinkBuf, onStatus,
        );
        inThink = nowInThink;
        thinkBuf = buffered;
        fullText += delta;
        if (emitted) onDelta(emitted);
      }
      // usage arrives on the final chunk
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }

    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text: req.json ? extractJson(cleaned) : cleaned, usage };
  }

  async completeWithImages(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = req.images.map((img) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mediaType};base64,${img.dataBase64}`,
      },
    }));

    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text" as const, text: req.prompt },
          ],
        },
      ],
    }, { signal: req.signal });
    const raw = res.choices[0]?.message.content ?? "";
    const usage = res.usage
      ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
      : undefined;
    return { text: req.json ? extractJson(raw) : raw, usage };
  }
}

/** Moonshot / Kimi — OpenAI-compatible.
 *
 *  Three independent platforms (per Kimi docs); keys cannot be mixed.
 *  Pick by where the key was issued:
 *    - platform.kimi.ai  / platform.moonshot.ai  (international API) → api.moonshot.ai/v1
 *    - platform.kimi.com / platform.moonshot.cn  (China API)         → api.moonshot.cn/v1
 *    - kimi.com → Kimi Code (membership-bundled) console              → api.kimi.com/coding/v1
 *
 *  Both API platforms issue both `sk-` and `ak-` prefixed keys, so the
 *  prefix is NOT a reliable platform signal. Kimi Code uses its own
 *  console and only accepts model id `kimi-for-coding`.
 *
 *  Selection priority:
 *    1. MOONSHOT_BASE_URL — direct override
 *    2. MOONSHOT_PLATFORM = "kimi-code" | "china" | "international"
 *    3. model id matches `/^kimi-for-coding/` → kimi-code endpoint
 *    4. default → international (api.moonshot.ai/v1) */
export class MoonshotProvider extends OpenAIProvider {
  override readonly id: ProviderId = "moonshot";

  constructor(model: string, apiKey?: string) {
    const key = apiKey ?? process.env.MOONSHOT_API_KEY ?? "dummy";
    const platform = (process.env.MOONSHOT_PLATFORM ?? "").toLowerCase();
    const baseURL =
      process.env.MOONSHOT_BASE_URL
      ?? (platform === "kimi-code" || /^kimi-for-coding/i.test(model)
        ? "https://api.kimi.com/coding/v1"
        : platform === "china" || platform === "cn"
          ? "https://api.moonshot.cn/v1"
          : "https://api.moonshot.ai/v1");
    super(model, { apiKey: key, baseURL });
  }
}

/** Ollama local — OpenAI-compatible, local base URL. */
export class OllamaProvider extends OpenAIProvider {
  override readonly id: ProviderId = "ollama";
  private readonly nativeBase: string;

  constructor(model: string) {
    const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    super(model, {
      apiKey: "ollama", // Ollama doesn't check the key
      baseURL: `${base}/v1`,
    });
    this.nativeBase = base;
  }

  /**
   * Reasoning models (qwen3 etc.) emit a long `<think>` block before the answer
   * — 15–60s even for "say ok". The OpenAI-compatible `/v1` endpoint can't turn
   * it off (every documented knob — `/no_think`, a system message,
   * `chat_template_kwargs.enable_thinking`, `think` — is ignored there), but
   * Ollama's native `/api/chat` honors `think: false`. Callers that want a
   * direct answer (instant mode, title generation) set `req.noThink` to get a
   * sub-2s reply; every other call — and anything needing JSON/guided decoding
   * — keeps the `/v1` path (image support, `<think>` interception, schema).
   */
  private nativeThinkOff(req: CompleteRequest): boolean {
    return !!req.noThink && !req.json && !req.jsonSchema;
  }

  /** POST the native `/api/chat` with thinking disabled. Shared by both paths. */
  private nativeChat(req: CompleteRequest, stream: boolean): Promise<Response> {
    return fetch(`${this.nativeBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        think: false,
        stream,
      }),
      signal: req.signal,
    });
  }

  override async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    if (!this.nativeThinkOff(req)) return super.complete(req);
    try {
      const res = await this.nativeChat(req, false);
      if (!res.ok) throw new Error(`ollama /api/chat → ${res.status}`);
      const obj = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: obj.message?.content ?? "",
        usage: { inputTokens: obj.prompt_eval_count ?? 0, outputTokens: obj.eval_count ?? 0 },
      };
    } catch (err) {
      if (req.signal?.aborted) throw err;
      return super.complete(req);
    }
  }

  override async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    if (!this.nativeThinkOff(req)) return super.completeStream(req, onDelta, onStatus);
    try {
      const res = await this.nativeChat(req, true);
      if (!res.ok || !res.body) throw new Error(`ollama /api/chat → ${res.status}`);

      let text = "";
      let usage: ProviderUsage | undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let obj: {
            message?: { content?: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          const delta = obj.message?.content ?? "";
          if (delta) {
            text += delta;
            onDelta(delta);
          }
          if (obj.done) {
            usage = {
              inputTokens: obj.prompt_eval_count ?? 0,
              outputTokens: obj.eval_count ?? 0,
            };
          }
        }
      }
      return { text, usage };
    } catch (err) {
      // A genuine cancellation propagates; any other failure (Ollama too old to
      // accept `think`, network blip) degrades to the /v1 path so instant still
      // answers — just with thinking on.
      if (req.signal?.aborted) throw err;
      return super.completeStream(req, onDelta, onStatus);
    }
  }
}

/** vLLM self-hosted — OpenAI-compatible server (`vllm serve …`).
 *
 *  Mac mini caveat: stock vLLM is Linux + CUDA. Apple-Silicon plugins
 *  (vllm-metal, vllm-mlx) are sub-v1.0 + text-only as of May 2026.
 *  This provider exists for users with a
 *  Linux/GPU box reachable on the LAN. Mac-mini-only users should
 *  stay on Ollama.
 *
 *  Where it wins:
 *   - Agent loop bursts hit prefix caching → noticeably lower TTFT
 *     on the planner + synthesis after the first turn
 *   - Eval harness `--concurrency=N` (AD2) packs concurrent cases
 *     into the same forward pass via continuous batching
 *   - Guided decoding (AC4.2) already routes through OpenAIProvider,
 *     so vLLM's xgrammar enforces the planner schema for free
 *
 *  Selection: VLLM_BASE_URL env, defaults to localhost:8000. The
 *  model id must match what vLLM was launched with (`vllm serve
 *  <model>`); vLLM does not hot-swap models in one process. */
export class VllmProvider extends OpenAIProvider {
  override readonly id: ProviderId = "vllm";

  constructor(model: string) {
    const base = process.env.VLLM_BASE_URL ?? "http://localhost:8000";
    super(model, {
      apiKey: process.env.VLLM_API_KEY ?? "vllm", // vLLM checks only when --api-key was set
      baseURL: `${base}/v1`,
    });
  }
}

/** Generic OpenAI-compatible provider — driven entirely by a base URL + key
 *  from the provider registry. A new OpenAI-compatible API (MiniMax, DeepSeek,
 *  …) needs NO bespoke class: add a PROVIDER_REGISTRY entry with
 *  kind:"openai-compatible" + baseURL, and getProvider() routes here. */
export class OpenAICompatibleProvider extends OpenAIProvider {
  override readonly id: ProviderId;
  constructor(id: ProviderId, model: string, baseURL: string, apiKey?: string) {
    super(model, { apiKey: apiKey || "dummy", baseURL });
    this.id = id;
  }
}
