/**
 * Event-trigger routes — fire a workspace action from an external webhook.
 *
 *   GET    /api/workspaces/:id/triggers   — list (owner sees the secret URL)
 *   POST   /api/workspaces/:id/triggers   — create (returns a fresh secret)
 *   DELETE /api/triggers/:id              — remove
 *   POST   /api/triggers/:secret          — FIRE (public; the secret is the auth)
 *
 * The fire route is allow-listed in the /api auth hook (index.ts) so an
 * external system can POST to it without a session cookie — the unguessable
 * secret is what authorises the run. The request body is bound to the action's
 * `payload` input so an ask_ai block can reference it.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateTriggerSchema } from "@ariadne/shared";
import type { ActionTrigger } from "@ariadne/shared";
import {
  dbInsertTrigger,
  dbGetTrigger,
  dbGetTriggerBySecret,
  dbListTriggersForWorkspace,
  dbTouchTrigger,
  dbDeleteTrigger,
  dbGetWorkspace,
} from "../db/repo.js";
import { canAccessWorkspace } from "./workspaceGuard.js";
import { loadActionDefs } from "../services/actions.js";
import { createActionRun } from "../runs/actionEngine.js";
import logger from "../logger.js";

function now(): string {
  return new Date().toISOString();
}

// Per-trigger rate limit for the public fire route. The secret authorises the
// run, but a leaked/abused secret could hammer the endpoint and drain LLM
// budget — so cap fires to a sliding window per trigger. In-memory is fine for
// a self-hosted single process; this is best-effort abuse control, not billing.
const FIRE_MAX = 10;
const FIRE_WINDOW_MS = 60_000;
const FIRE_PAYLOAD_MAX = 32_000;
const fireTimestamps = new Map<string, number[]>();

function fireRateLimited(triggerId: string): boolean {
  const cutoff = Date.now() - FIRE_WINDOW_MS;
  const recent = (fireTimestamps.get(triggerId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= FIRE_MAX) {
    fireTimestamps.set(triggerId, recent);
    return true;
  }
  recent.push(Date.now());
  fireTimestamps.set(triggerId, recent);
  return false;
}

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  // List every trigger on a workspace the caller can access.
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/triggers",
    async (req, reply) => {
      const ws = dbGetWorkspace(req.params.workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });
      if (!canAccessWorkspace(ws, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      // A trigger secret is a credential. On a shared/built-in/public workspace
      // canAccessWorkspace is true for other accounts, so only return the
      // caller's OWN triggers — otherwise listing would leak someone else's
      // webhook secret (caught in review).
      const mine = dbListTriggersForWorkspace(req.params.workspaceId).filter(
        (tr) => tr.accountId === req.account?.id,
      );
      return reply.send(mine);
    },
  );

  // Create a trigger with a fresh secret. Validates the action exists so an
  // orphan trigger can't slip in (mirrors schedule creation).
  app.post<{ Params: { workspaceId: string }; Body: unknown }>(
    "/workspaces/:workspaceId/triggers",
    async (req, reply) => {
      if (!req.account) return reply.status(401).send({ error: "Sign in required" });
      const ws = dbGetWorkspace(req.params.workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });
      if (!canAccessWorkspace(ws, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const parsed = CreateTriggerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
      }
      if (parsed.data.workspaceId !== req.params.workspaceId) {
        return reply.status(400).send({ error: "workspaceId in body must match URL" });
      }
      const { actions } = loadActionDefs(ws.rootPath);
      if (!actions.some((a) => a.id === parsed.data.actionId)) {
        return reply.status(404).send({ error: "Action not found in workspace" });
      }

      const trigger: ActionTrigger = {
        id: crypto.randomUUID(),
        secret: crypto.randomBytes(24).toString("base64url"),
        workspaceId: parsed.data.workspaceId,
        actionId: parsed.data.actionId,
        accountId: req.account.id,
        lastFiredAt: null,
        createdAt: now(),
      };
      dbInsertTrigger(trigger);
      return reply.status(201).send(trigger);
    },
  );

  // Delete a trigger (creator only).
  app.delete<{ Params: { id: string } }>("/triggers/:id", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    const existing = dbGetTrigger(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Trigger not found" });
    if (existing.accountId !== req.account.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    dbDeleteTrigger(req.params.id);
    return reply.send({ ok: true });
  });

  // FIRE — public (allow-listed in the /api auth hook). The secret is the auth.
  // Runs the bound action with the POST body bound as the `payload` input.
  app.post<{ Params: { secret: string }; Body: unknown }>(
    "/triggers/:secret",
    async (req, reply) => {
      const trigger = dbGetTriggerBySecret(req.params.secret);
      if (!trigger) return reply.status(404).send({ error: "Unknown trigger" });
      if (fireRateLimited(trigger.id)) {
        return reply.status(429).send({ error: "Rate limit exceeded — slow down" });
      }
      try {
        const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
        if (payload.length > FIRE_PAYLOAD_MAX) {
          return reply.status(413).send({ error: "Payload too large" });
        }
        const run = await createActionRun({
          workspaceId: trigger.workspaceId,
          actionId: trigger.actionId,
          createdBy: trigger.accountId,
          input: { payload },
        });
        dbTouchTrigger(trigger.id, now());
        logger.info({ triggerId: trigger.id, actionId: trigger.actionId, runId: run.id }, "trigger fired");
        return reply.status(202).send({ ok: true, runId: run.id });
      } catch (err) {
        logger.warn({ triggerId: trigger.id, err }, "trigger failed to start");
        return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to start action" });
      }
    },
  );
}
