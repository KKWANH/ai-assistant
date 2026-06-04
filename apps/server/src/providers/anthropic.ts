import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, ProviderUsage, CompleteRequest, CompleteWithImagesRequest } from "./index.js";
import { extractJson, processThinkBlocks } from "./index.js";

// Anthropic prompt caching (R1). A large, stable system prefix (instructions +
// workspace metadata + memory) is re-sent every turn; marking it
// `cache_control: ephemeral` lets turn 2+ read it from cache instead of
// re-billing it (~90% cheaper input, lower TTFT). Caching is transparent — the
// output is identical. Anthropic ignores cache_control below its ~1024-token
// minimum, so we only wrap the prefix once it's comfortably large (~4096
// chars ≈ 1024 tokens); smaller prefixes are sent as a plain string (no-op, no
// wasted cache write).
const CACHE_MIN_CHARS = 4096;

function systemParam(system: string): string | Anthropic.TextBlockParam[] {
  if (system.length < CACHE_MIN_CHARS) return system;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

function readUsage(u: AnthropicUsage | null | undefined): ProviderUsage | undefined {
  if (!u) return undefined;
  const usage: ProviderUsage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
  if (u.cache_creation_input_tokens != null) usage.cacheCreationTokens = u.cache_creation_input_tokens;
  if (u.cache_read_input_tokens != null) usage.cacheReadTokens = u.cache_read_input_tokens;
  return usage;
}

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
  private client: Anthropic;
  private model: string;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async complete(req: CompleteRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    // Anthropic has no `response_format` knob, but tool-use input_schema
    // is enforced server-side — so we forge a single one-tool call when
    // a jsonSchema is supplied. The tool's input becomes the structured
    // response. Falls back to plain text + extractJson when no schema.
    const useTool = !!req.jsonSchema;
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemParam(req.system),
      messages: [{ role: "user", content: req.prompt }],
      ...(useTool ? {
        tools: [{
          name: req.jsonSchema!.name,
          description: "Return the structured response.",
          input_schema: req.jsonSchema!.schema as Anthropic.Tool.InputSchema,
        }],
        tool_choice: { type: "tool" as const, name: req.jsonSchema!.name },
      } : {}),
    }, { signal: req.signal });

    const wantsJson = req.json || useTool;
    let raw = "";
    if (useTool) {
      const toolUse = msg.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        raw = JSON.stringify(toolUse.input);
      }
    } else {
      const content = msg.content[0];
      raw = content?.type === "text" ? content.text : "";
    }
    const usage = readUsage(msg.usage);
    return { text: wantsJson ? extractJson(raw) : raw, usage };
  }

  async completeStream(
    req: CompleteRequest,
    onDelta: (delta: string) => void,
    onStatus?: (status: string) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemParam(req.system),
      messages: [{ role: "user", content: req.prompt }],
    }, { signal: req.signal });

    let fullText = "";
    let inThink = false;
    let thinkBuf = "";

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const chunk = event.delta.text;
        // processThinkBlocks already fires onStatus("Thinking…") when it enters
        // a <think> block — do not re-fire it here.
        const { emitted, buffered, nowInThink } = processThinkBlocks(
          chunk, fullText, inThink, thinkBuf, onStatus,
        );
        inThink = nowInThink;
        thinkBuf = buffered;
        fullText += chunk;
        if (emitted) onDelta(emitted);
      }
    }

    const finalMsg = await stream.finalMessage();
    const usage = readUsage(finalMsg.usage);

    // Strip <think> blocks from final text
    const cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text: req.json ? extractJson(cleaned) : cleaned, usage };
  }

  async completeWithImages(req: CompleteWithImagesRequest): Promise<{ text: string; usage?: ProviderUsage }> {
    const imageBlocks: Anthropic.ImageBlockParam[] = req.images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: img.dataBase64,
      },
    }));

    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemParam(req.system),
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text" as const, text: req.prompt },
          ],
        },
      ],
    }, { signal: req.signal });

    const content = msg.content[0];
    const raw = content?.type === "text" ? content.text : "";
    const usage = readUsage(msg.usage);
    return { text: req.json ? extractJson(raw) : raw, usage };
  }
}
