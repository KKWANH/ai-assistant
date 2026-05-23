/**
 * Embedding providers — one cheap, focused interface so the retriever
 * doesn't need to know what's behind it.
 *
 * v1 ships two adapters:
 *   - OllamaEmbedding — default, no API key, talks to the user's local
 *     Ollama daemon. Requires an embedding model installed
 *     (`ollama pull nomic-embed-text` or `mxbai-embed-large`).
 *   - OpenAIEmbedding — used when OPENAI_API_KEY is set. text-embedding-3-small.
 *
 * The chooser respects the same precedence as the chat providers but
 * defaults to Ollama because embeddings shouldn't quietly start billing
 * a user who never opted in.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

const OLLAMA_TIMEOUT_MS = 20_000;
const OPENAI_TIMEOUT_MS = 20_000;

/** Embedding models we'll auto-pick if present, in preference order. */
const OLLAMA_PREFERRED_MODELS = [
  "nomic-embed-text",
  "mxbai-embed-large",
  "nomic-embed-text:latest",
  "mxbai-embed-large:latest",
];

export interface EmbeddingProvider {
  id: string;
  /** Vector length the model produces — stored once so the retriever can
   *  reject mismatched indexes after a model swap. */
  dimensions: number;
  embed(text: string): Promise<number[]>;
  /** Batch embed; can be parallel or use a native batch endpoint. */
  embedMany(texts: string[]): Promise<number[][]>;
}

// ── Ollama adapter ──────────────────────────────────────────────────────────

class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private model: string;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
    this.id = `ollama:${model}`;
  }

  async embed(text: string): Promise<number[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), OLLAMA_TIMEOUT_MS);
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`Ollama /api/embeddings ${res.status.toString()}`);
      const data = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
        throw new Error("Ollama returned an empty embedding");
      }
      return data.embedding;
    } finally {
      clearTimeout(timer);
    }
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    // Ollama doesn't batch in this endpoint — sequential calls with a
    // small concurrency cap so we don't open dozens of sockets.
    const out: number[][] = new Array<number[]>(texts.length);
    const CONCURRENCY = 4;
    let next = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const i = next++;
        if (i >= texts.length) return;
        const text = texts[i];
        if (text === undefined) continue;
        out[i] = await this.embed(text);
      }
    });
    await Promise.all(workers);
    return out;
  }
}

/** Probe Ollama for a usable embedding model. Returns null if Ollama is
 *  down or has no embedding-capable model installed. */
async function tryOllamaEmbedding(): Promise<EmbeddingProvider | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const installed = (data.models ?? []).map((m) => m.name);
    const pick = OLLAMA_PREFERRED_MODELS.find((m) => installed.includes(m));
    if (!pick) return null;

    // Probe once to learn the dimension — model registries lie about
    // this and the only honest source is a single live call.
    const probe = new OllamaEmbeddingProvider(pick, 0);
    const sample = await probe.embed("dimension probe");
    return new OllamaEmbeddingProvider(pick, sample.length);
  } catch {
    return null;
  }
}

// ── OpenAI adapter ──────────────────────────────────────────────────────────

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai:text-embedding-3-small";
  readonly dimensions = 1536;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const out = await this.embedMany([text]);
    const first = out[0];
    if (!first) throw new Error("OpenAI returned no embedding");
    return first;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAI /embeddings ${res.status.toString()}`);
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vectors = (data.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== texts.length) {
      throw new Error(`OpenAI returned ${vectors.length.toString()} vectors for ${texts.length.toString()} inputs`);
    }
    return vectors;
  }
}

// ── Chooser ──────────────────────────────────────────────────────────────────

let cached: EmbeddingProvider | null = null;
let probed = false;

/**
 * Resolve a usable embedding provider — Ollama first (local, free),
 * OpenAI second (only when the key is present). Returns null if neither
 * is reachable. The result is cached for the lifetime of the process.
 */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
  if (probed) return cached;
  probed = true;

  // 1. Ollama — preferred because it's free and local.
  const ollama = await tryOllamaEmbedding();
  if (ollama) {
    cached = ollama;
    return ollama;
  }

  // 2. OpenAI — only when the user explicitly set the key.
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    cached = new OpenAIEmbeddingProvider(openaiKey);
    return cached;
  }

  return null;
}

/** Force the next call to re-probe. Used in tests; not normally needed. */
export function resetEmbeddingProviderCache(): void {
  cached = null;
  probed = false;
}
