/**
 * Web search route: POST /api/search { query }
 *
 * The actual search logic lives in services/search.ts (shared with the chat
 * context builder). This file is the thin Fastify adapter.
 */

import type { FastifyInstance } from "fastify";
import { SearchSchema } from "@ariadne/shared";
import { performSearch } from "../services/search.js";
import { searchImages } from "../services/imageSearch.js";
import { getActiveSettings } from "../config.js";
import { getProvider } from "../providers/index.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import logger from "../logger.js";

/**
 * The museum/art catalogs index in English, so a Korean (or other non-Latin)
 * query like "단원 김홍도" finds nothing. Translate non-ASCII queries to concise
 * English art-search terms first; ASCII queries pass through untouched (no LLM
 * call). Best-effort — falls back to the raw query on any failure.
 */
async function toEnglishImageQuery(query: string): Promise<string> {
  // ASCII-only query → no translation needed.
  if (![...query].some((c) => c.charCodeAt(0) > 127)) return query;
  try {
    const settings = getActiveSettings();
    const model =
      settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
    const provider = await getProvider({ provider: settings.provider, model });
    const { text } = await provider.complete({
      system:
        "Translate the user's art/image search query into concise ENGLISH search terms for a " +
        "museum image catalog. Romanize artist and place names (e.g. 김홍도 → Kim Hong-do), use the " +
        "common English title of known works, keep it short. Reply with ONLY the search terms.",
      prompt: query,
      noThink: true,
    });
    const out = text.trim().split("\n")[0]?.trim().replace(/^["']|["']$/g, "");
    return out && out.length > 0 ? out : query;
  } catch (err) {
    logger.warn({ err: String(err) }, "image query translation failed");
    return query;
  }
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>("/search", async (req, reply) => {
    const parsed = SearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const result = await performSearch(parsed.data.query);
    return reply.send(result);
  });

  // Image search — real images with citable sources (art/museum collections).
  app.post<{ Body: unknown }>("/images/search", async (req, reply) => {
    const parsed = SearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const q = await toEnglishImageQuery(parsed.data.query);
    const result = await searchImages(q);
    return reply.send(result);
  });
}
