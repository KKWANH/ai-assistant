/**
 * Provider status routes.
 *
 * GET /api/providers/status — live reachability check for each provider.
 *   - ollama: fetches /api/tags from OLLAMA_BASE_URL with a ~2s timeout.
 *   - anthropic/openai/gemini/moonshot: checks whether the API key env var is set.
 *   - mock: always available.
 */

import type { FastifyInstance } from "fastify";
import { PROVIDERS, PROVIDER_LABELS } from "@ariadne/shared";
import type { ProviderId } from "@ariadne/shared";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

interface ProviderLiveStatus {
  id: ProviderId;
  label: string;
  reachable: boolean;
  models?: string[];
  detail?: string;
}

async function checkOllama(): Promise<ProviderLiveStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { id: "ollama", label: PROVIDER_LABELS["ollama"], reachable: false, detail: `HTTP ${res.status.toString()}` };
    }
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models: string[] = (data.models ?? []).map((m) => m.name);
    return { id: "ollama", label: PROVIDER_LABELS["ollama"], reachable: true, models };
  } catch (err) {
    clearTimeout(timer);
    const detail = err instanceof Error ? err.message : String(err);
    return { id: "ollama", label: PROVIDER_LABELS["ollama"], reachable: false, detail };
  }
}

function checkKeyProvider(id: ProviderId): ProviderLiveStatus {
  const envMap: Partial<Record<ProviderId, string>> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
  };
  const envKey = envMap[id];
  const configured = envKey ? !!process.env[envKey] : false;
  return {
    id,
    label: PROVIDER_LABELS[id],
    reachable: configured,
  };
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/providers/status
  app.get("/providers/status", async (_req, reply) => {
    const statuses = await Promise.all(
      PROVIDERS.map(async (id): Promise<ProviderLiveStatus> => {
        switch (id) {
          case "ollama":
            return checkOllama();
          case "mock":
            return { id: "mock", label: PROVIDER_LABELS["mock"], reachable: true };
          default:
            return checkKeyProvider(id);
        }
      })
    );
    return reply.send(statuses);
  });
}
