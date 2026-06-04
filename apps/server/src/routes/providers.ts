/**
 * Provider status + API-key management.
 *
 * GET    /api/providers/status   — availability per provider
 *                                  ({ id, label, configured, models }).
 * PUT    /api/providers/:id/key  — save an API key into the settings table
 *                                  (body { key }); an empty key clears it.
 * DELETE /api/providers/:id/key  — clear a saved key (revert to the env var).
 *
 * Keys are write-only over the wire: no GET ever returns a key, only the
 * derived `configured` boolean. ollama is probed live; mock is always on.
 * `configured`/key resolution lives in config.ts so the env-var ↔ settings ↔
 * (future) keychain precedence stays in one place.
 */

import type { FastifyInstance } from "fastify";
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_REGISTRY } from "@ariadne/shared";
import type { ProviderId, ProviderStatus } from "@ariadne/shared";
import { isProviderConfigured } from "../config.js";
import { evictProviderCache } from "../providers/index.js";
import { dbSetSetting } from "../db/repo.js";
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

function statusOf(id: ProviderId): ProviderStatus {
  return { id, label: PROVIDER_LABELS[id], configured: isProviderConfigured(id), models: [] };
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/providers/status
  app.get("/providers/status", async (_req, reply) => {
    const statuses = await Promise.all(
      PROVIDERS.map(async (id): Promise<ProviderStatus> => {
        if (id === "ollama") return checkOllama();
        return statusOf(id);
      }),
    );
    return reply.send(statuses);
  });

  // PUT /api/providers/:id/key — save (empty body.key clears) the API key.
  app.put<{ Params: { id: string }; Body: { key?: string } }>(
    "/providers/:id/key",
    async (req, reply) => {
      if (req.account.role !== "admin") {
        return reply.status(403).send({ error: "Forbidden", detail: "Admin only — provider keys are a global setting." });
      }
      const id = req.params.id as ProviderId;
      if (!PROVIDERS.includes(id)) return reply.status(404).send({ error: "Unknown provider" });
      if (!PROVIDER_REGISTRY[id].envKey) {
        return reply.status(400).send({ error: "This provider does not use an API key" });
      }
      // Plaintext in the local settings table for now — see resolveProviderKey()
      // for the keychain migration note. Empty string = clear → env fallback.
      dbSetSetting(`providerKey:${id}`, (req.body?.key ?? "").trim());
      evictProviderCache(id); // rebuild the client with the new key on next use
      return reply.send({ ok: true, configured: isProviderConfigured(id) });
    },
  );

  // DELETE /api/providers/:id/key — clear a saved key (revert to env var).
  app.delete<{ Params: { id: string } }>("/providers/:id/key", async (req, reply) => {
    if (req.account.role !== "admin") {
      return reply.status(403).send({ error: "Forbidden", detail: "Admin only — provider keys are a global setting." });
    }
    const id = req.params.id as ProviderId;
    if (!PROVIDERS.includes(id)) return reply.status(404).send({ error: "Unknown provider" });
    dbSetSetting(`providerKey:${id}`, "");
    evictProviderCache(id);
    return reply.send({ ok: true, configured: isProviderConfigured(id) });
  });
}
