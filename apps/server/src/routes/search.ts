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

    const result = await searchImages(parsed.data.query);
    return reply.send(result);
  });
}
