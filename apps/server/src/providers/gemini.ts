import { GoogleGenAI } from "@google/genai";
import type { AiProvider, ProviderUsage, CompleteRequest, CompleteWithImagesRequest } from "./index.js";
import { extractJson, processThinkBlocks } from "./index.js";

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  private client: GoogleGenAI;
  private model: string;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env.GEMINI_API_KEY ?? "" });
  }

  async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    // Gemini supports schema-constrained JSON via responseSchema —
    // server-side validation, no parse failures. Falls back to mime-type
    // JSON when only `json: true` is set.
    const wantsJson = req.json || !!req.jsonSchema;
    const generationConfig = req.jsonSchema
      ? { responseMimeType: "application/json", responseSchema: req.jsonSchema.schema }
      : req.json
        ? { responseMimeType: "application/json" }
        : undefined;
    const result = await this.client.models.generateContent({
      model: this.model,
      contents: [
        { role: "user", parts: [{ text: `${req.system}\n\n${req.prompt}` }] },
      ],
      ...(generationConfig ? { generationConfig } : {}),
    });
    const raw = result.text ?? "";
    const meta = result.usageMetadata;
    const usage = meta
      ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
      : undefined;
    return { text: wantsJson ? extractJson(raw) : raw, usage };
  }

  async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents: [
        { role: "user", parts: [{ text: `${req.system}\n\n${req.prompt}` }] },
      ],
    });

    let fullText = "";
    let inThink = false;
    let thinkBuf = "";
    let usage: ProviderUsage | undefined;

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
      const meta = chunk.usageMetadata;
      if (meta) {
        usage = {
          inputTokens: meta.promptTokenCount ?? 0,
          outputTokens: meta.candidatesTokenCount ?? 0,
        };
      }
    }

    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text: req.json ? extractJson(cleaned) : cleaned, usage };
  }

  async completeWithImages(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const imageParts = req.images.map((img) => ({
      inlineData: {
        mimeType: img.mediaType,
        data: img.dataBase64,
      },
    }));

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
    });

    const raw = result.text ?? "";
    const meta = result.usageMetadata;
    const usage = meta
      ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
      : undefined;
    return { text: req.json ? extractJson(raw) : raw, usage };
  }
}
