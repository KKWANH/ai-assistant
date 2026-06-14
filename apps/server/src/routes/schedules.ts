/**
 * Action schedule routes — manage recurring runs of a workspace action.
 *
 * Routes are scoped to the calling account (a user only sees/edits
 * schedules they created). The scheduler service (`services/scheduler.ts`)
 * is what actually fires them every 60s.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateScheduleSchema, UpdateScheduleSchema } from "@ariadne/shared";
import type { ActionSchedule } from "@ariadne/shared";
import {
  dbInsertSchedule,
  dbGetSchedule,
  dbListSchedulesForWorkspace,
  dbUpdateSchedule,
  dbDeleteSchedule,
  dbGetWorkspace,
} from "../db/repo.js";
import { canModifyWorkspace } from "./workspaceGuard.js";
import { computeFirstRunAt, computeNextRunAt } from "../services/scheduler.js";
import { loadActionDefs } from "../services/actions.js";

function now(): string {
  return new Date().toISOString();
}

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  // List every schedule on a workspace the caller can access.
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/schedules",
    async (req, reply) => {
      const ws = dbGetWorkspace(req.params.workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });
      if (!canModifyWorkspace(ws, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      return reply.send(dbListSchedulesForWorkspace(req.params.workspaceId));
    },
  );

  // Create a schedule. We validate the actionId exists in the
  // workspace's actions.yaml so an orphan schedule can't slip in.
  app.post<{ Params: { workspaceId: string }; Body: unknown }>(
    "/workspaces/:workspaceId/schedules",
    async (req, reply) => {
      if (!req.account) return reply.status(401).send({ error: "Sign in required" });
      const ws = dbGetWorkspace(req.params.workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });
      if (!canModifyWorkspace(ws, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const parsed = CreateScheduleSchema.safeParse(req.body);
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

      const nowDate = new Date();
      const sched: ActionSchedule = {
        id: crypto.randomUUID(),
        workspaceId: parsed.data.workspaceId,
        actionId: parsed.data.actionId,
        accountId: req.account.id,
        frequency: parsed.data.frequency,
        enabled: true,
        lastRunAt: null,
        nextRunAt: computeFirstRunAt(parsed.data.frequency, nowDate),
        createdAt: now(),
      };
      dbInsertSchedule(sched);
      return reply.status(201).send(sched);
    },
  );

  // Partial update — pause/resume, or switch cadence (recomputes next_run_at).
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/schedules/:id",
    async (req, reply) => {
      if (!req.account) return reply.status(401).send({ error: "Sign in required" });
      const existing = dbGetSchedule(req.params.id);
      if (!existing) return reply.status(404).send({ error: "Schedule not found" });
      if (existing.accountId !== req.account.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const parsed = UpdateScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
      }
      const patch: {
        frequency?: import("@ariadne/shared").ScheduleFrequency;
        enabled?: boolean;
        nextRunAt?: string;
      } = {};
      if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
      if (parsed.data.frequency && parsed.data.frequency !== existing.frequency) {
        patch.frequency = parsed.data.frequency;
        // Cadence change re-anchors next_run_at from "now" — otherwise
        // switching from monthly→hourly leaves the next tick a month away.
        patch.nextRunAt = computeNextRunAt(parsed.data.frequency, new Date());
      }
      const updated = dbUpdateSchedule(req.params.id, patch);
      return reply.send(updated);
    },
  );

  app.delete<{ Params: { id: string } }>("/schedules/:id", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    const existing = dbGetSchedule(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Schedule not found" });
    if (existing.accountId !== req.account.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    dbDeleteSchedule(req.params.id);
    return reply.send({ ok: true });
  });
}
