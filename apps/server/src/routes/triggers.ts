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
      return reply.send(dbListTriggersForWorkspace(req.params.workspaceId));
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
      try {
        const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
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
