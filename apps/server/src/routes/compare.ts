/**
 * Model comparison — run one prompt against several models concurrently and
 * return every answer. This is the cross-vendor "second opinion" that
 * single-vendor chat UIs (Claude.ai, ChatGPT) structurally can't offer: here
 * you can put a local Ollama model next to Claude next to GPT on the same
 * question, and judge them side by side.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CompareSchema } from "@ariadne/shared";
import { getProvider } from "../providers/index.js";
import { meteringProvider } from "../runs/engine.js";
import { accountOverLimit } from "../services/limits.js";
import { isProviderConfigured } from "../config.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import logger from "../logger.js";

const COMPARE_SYSTEM =
  "You are a helpful assistant. Answer the user's question directly and concisely. " +
  "Reply in the same language the user writes in.";

const PER_MODEL_TIMEOUT_MS = 90_000;

export async function compareRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/compare — one prompt, N models, concurrent answers.
  app.post<{ Body: unknown }>("/compare", async (req, reply) => {
    // Cost guard: compare fans out N model calls, so honour the per-account
    // token cap exactly like chat/runs do.
    if (req.account && accountOverLimit(req.account.id)) {
      return reply.status(429).send({
        error: "Token limit reached",
        detail: "You've hit your usage limit — try again later.",
      });
    }

    const parsed = CompareSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", detail: parsed.error.message });
    }
    const { prompt, models } = parsed.data;
    const accountId = req.account?.id ?? null;

    const results = await Promise.all(
      models.map(async (m) => {
        if (!isProviderConfigured(m.provider)) {
          return { provider: m.provider, model: m.model, text: "", error: "Provider not configured" };
        }
        // Per-model timeout so one hung provider can't block the whole compare.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);
        try {
          const model = m.provider === "ollama" ? await resolveOllamaModel(m.model) : m.model;
          const raw = await getProvider({ provider: m.provider, model });
          // Synthetic runId — compare has no Run, but metering still attributes
          // the tokens to the account so usage limits stay accurate.
          const provider = meteringProvider(raw, crypto.randomUUID(), model, accountId);
          const { text, usage } = await provider.complete({
            system: COMPARE_SYSTEM,
            prompt,
            signal: controller.signal,
          });
          return { provider: m.provider, model, text, usage };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ provider: m.provider, model: m.model, err: msg }, "compare model failed");
          return { provider: m.provider, model: m.model, text: "", error: msg.slice(0, 200) };
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    return reply.send({ results });
  });
}
