/**
 * Ollama model discovery.
 *
 * Ariadne is local-first: rather than asking the user to type a model name,
 * it uses whatever models are already installed on the machine. These helpers
 * query the local Ollama daemon and resolve the active model to one that
 * actually exists.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = 8000;
const MODEL_LIST_TTL_MS = 10_000;

let cachedModels: { at: number; list: string[] } | null = null;

/** Names of every model installed in the local Ollama daemon (empty if down). */
export async function listOllamaModels(): Promise<string[]> {
  // Hot path: every chat turn calls resolveOllamaModel → here. A short TTL
  // avoids a localhost round-trip on back-to-back turns while still picking
  // up newly-installed models within ~10s.
  const now = Date.now();
  if (cachedModels && now - cachedModels.at < MODEL_LIST_TTL_MS) {
    return cachedModels.list;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const list = (data.models ?? []).map((m) => m.name).filter((n) => n.length > 0);
    cachedModels = { at: now, list };
    return list;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the active Ollama model to one that is actually installed.
 * Keeps the preferred model if present; otherwise falls back to whatever is
 * on the machine. If Ollama is unreachable the preference is returned as-is
 * (the caller surfaces the connection error).
 */
export async function resolveOllamaModel(preferred: string): Promise<string> {
  const installed = await listOllamaModels();
  if (installed.length === 0) return preferred;
  if (installed.includes(preferred)) return preferred;
  return installed[0] ?? preferred;
}
