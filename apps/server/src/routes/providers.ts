/**
 * Provider status route.
 *
 * GET /api/providers/status — live availability for each provider, as the
 * shared `ProviderStatus` contract ({ id, label, configured, models }):
 *   - ollama: fetches /api/tags from OLLAMA_BASE_URL. The timeout is generous
 *     because a busy Ollama (loading or running a large model) can be slow to
 *     answer even when perfectly healthy — a short timeout caused false
 *     "not running" reports.
 *   - anthropic/openai/gemini/moonshot: API key env var present?
 *   - mock: always available.
 */

import type { FastifyInstance } from "fastify";
import { PROVIDERS, PROVIDER_LABELS } from "@ariadne/shared";
import type { ProviderId, ProviderStatus } from "@ariadne/shared";
import { listOllamaModels } from "../services/ollamaModels.js";

async function checkOllama(): Promise<ProviderStatus> {
  // listOllamaModels() returns [] when the daemon is unreachable, so a
  // non-empty list is the signal that Ollama is up and has usable models.
  const models = await listOllamaModels();
  return {
    id: "ollama",
    label: PROVIDER_LABELS["ollama"],
    configured: models.length > 0,
    models,
  };
}

const KEY_ENV: Partial<Record<ProviderId, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
};

function checkKeyProvider(id: ProviderId): ProviderStatus {
  const envKey = KEY_ENV[id];
  return {
    id,
    label: PROVIDER_LABELS[id],
    configured: envKey ? !!process.env[envKey] : false,
    models: [],
  };
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/providers/status
  app.get("/providers/status", async (_req, reply) => {
    const statuses = await Promise.all(
      PROVIDERS.map(async (id): Promise<ProviderStatus> => {
        if (id === "ollama") return checkOllama();
        if (id === "mock") {
          return { id: "mock", label: PROVIDER_LABELS["mock"], configured: true, models: [] };
        }
        return checkKeyProvider(id);
      })
    );
    return reply.send(statuses);
  });
}
