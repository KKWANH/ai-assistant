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

  constructor(model: string) {
    const key = process.env.MOONSHOT_API_KEY ?? "dummy";
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

  constructor(model: string) {
    const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    super(model, {
      apiKey: "ollama", // Ollama doesn't check the key
      baseURL: `${base}/v1`,
    });
  }
}
