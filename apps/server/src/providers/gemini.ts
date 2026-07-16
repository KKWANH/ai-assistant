import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import type { AiProvider, ProviderUsage, CompleteRequest, CompleteWithImagesRequest } from "./index.js";
import { extractJson, processThinkBlocks } from "./index.js";
import logger from "../logger.js";

/**
 * Gemini's responseSchema is a SUBSET of JSON Schema and rejects some keys —
 * notably `additionalProperties`, which OpenAI-style structured-output schemas
 * set to `false`. Sending it back fails the whole request ("Unknown name
 * 'additionalProperties'"). Recursively drop it (everything else — type,
 * properties, required, items, enum — Gemini supports) so one shared schema can
 * constrain Gemini and OpenAI alike instead of 400ing the moment a key is added.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === "additionalProperties") continue;
      out[key] = toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  private client: GoogleGenAI;
  private model: string;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env.GEMINI_API_KEY ?? "" });
  }

  // We never declare tools on these calls, yet Gemini sometimes decides to emit
  // a function call anyway and then discards the WHOLE response with
  // finishReason=MALFORMED_FUNCTION_CALL — deterministically on certain
  // system-prompt + short-question shapes (empty answer streamed, thinking
  // tokens still billed). Explicitly forbidding function calls makes that
  // failure mode impossible.
  private static readonly NO_TOOLS: GenerateContentConfig["toolConfig"] = {
    functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
  };

  async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    // @google/genai takes model params under `config` — the legacy
    // `generationConfig` key is silently dropped by this SDK, so the schema must
    // go here to actually constrain the output. Schema-constrained JSON via
    // responseSchema, mime-type JSON when only `json` is set, plus the abort
    // signal so a cancelled request actually stops the upstream call (+ billing).
    const wantsJson = req.json || !!req.jsonSchema;
    const config: GenerateContentConfig = { toolConfig: GeminiProvider.NO_TOOLS };
    if (req.jsonSchema) {
      config.responseMimeType = "application/json";
      config.responseSchema = toGeminiSchema(req.jsonSchema.schema) as GenerateContentConfig["responseSchema"];
    } else if (req.json) {
      config.responseMimeType = "application/json";
    }
    if (req.signal) config.abortSignal = req.signal;
    const call = () =>
      this.client.models.generateContent({
        model: this.model,
        contents: [
          { role: "user", parts: [{ text: `${req.system}\n\n${req.prompt}` }] },
        ],
        config,
      });
    let result = await call();
    let raw = result.text ?? "";
    let inTok = result.usageMetadata?.promptTokenCount ?? 0;
    let outTok = (result.usageMetadata?.candidatesTokenCount ?? 0) + (result.usageMetadata?.thoughtsTokenCount ?? 0);
    // Gemini occasionally returns a thinking-only/empty response (billed thought
    // tokens, zero candidates — e.g. a spurious MALFORMED_FUNCTION_CALL). It's
    // flaky, so one retry almost always recovers a real answer; usage sums both
    // attempts so metering stays honest.
    if (!raw.trim() && !req.signal?.aborted) {
      logger.warn(
        { model: this.model, finishReason: result.candidates?.[0]?.finishReason },
        "gemini returned no text — retrying once",
      );
      result = await call();
      raw = result.text ?? "";
      inTok += result.usageMetadata?.promptTokenCount ?? 0;
      outTok += (result.usageMetadata?.candidatesTokenCount ?? 0) + (result.usageMetadata?.thoughtsTokenCount ?? 0);
    }
    return { text: wantsJson ? extractJson(raw) : raw, usage: { inputTokens: inTok, outputTokens: outTok } };
  }

  async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    const config: GenerateContentConfig = { toolConfig: GeminiProvider.NO_TOOLS };
    if (req.signal) config.abortSignal = req.signal;
    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents: [
        { role: "user", parts: [{ text: `${req.system}\n\n${req.prompt}` }] },
      ],
      config,
    });

    let fullText = "";
    let inThink = false;
    let thinkBuf = "";
    let usage: ProviderUsage | undefined;
    let lastFinish: string | undefined;

    for await (const chunk of response) {
      const delta = chunk.text ?? "";
      if (delta) {
        const { emitted, buffered, nowInThink } = processThinkBlocks(
          delta, fullText, inThink, thinkBuf, onStatus,
        );
        inThink = nowInThink;
        thinkBuf = buffered;
        fullText += delta;
        if (emitted) onDelta(emitted);
      }
      const fr = chunk.candidates?.[0]?.finishReason;
      if (fr) lastFinish = String(fr);
      const meta = chunk.usageMetadata;
      if (meta) {
        usage = {
          inputTokens: meta.promptTokenCount ?? 0,
          outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
        };
      }
    }

    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    let finalText = req.json ? extractJson(cleaned) : cleaned;
    // Same flake as complete(): a stream can end with thinking-only output and
    // zero visible text (spurious MALFORMED_FUNCTION_CALL and kin) — the user
    // saw a silent empty answer. Retry once, non-streaming, emit the recovered
    // answer as a single delta, and sum usage so metering bills both attempts.
    if (!finalText.trim() && !req.signal?.aborted) {
      logger.warn(
        { model: this.model, finishReason: lastFinish, outputTokens: usage?.outputTokens },
        "gemini stream ended with no text — retrying once non-streaming",
      );
      const retry = await this.complete(req);
      if (retry.text.trim()) {
        onDelta(retry.text);
        finalText = retry.text;
      }
      if (retry.usage) {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + retry.usage.inputTokens,
          outputTokens: (usage?.outputTokens ?? 0) + retry.usage.outputTokens,
        };
      }
    }
    return { text: finalText, usage };
  }

  async completeWithImages(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const imageParts = req.images.map((img) => ({
      inlineData: {
        mimeType: img.mediaType,
        data: img.dataBase64,
      },
    }));

    const config: GenerateContentConfig = { toolConfig: GeminiProvider.NO_TOOLS };
    if (req.signal) config.abortSignal = req.signal;
    const result = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            ...imageParts,
            { text: `${req.system}\n\n${req.prompt}` },
          ],
        },
      ],
      config,
    });

    const raw = result.text ?? "";
    const meta = result.usageMetadata;
    const usage = meta
      ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) }
      : undefined;
    return { text: req.json ? extractJson(raw) : raw, usage };
  }
}
