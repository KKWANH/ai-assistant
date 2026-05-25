/**
 * Workspace memory routes.
 *
 *   GET    /api/workspaces/:id/memory          — list every entry
 *   POST   /api/workspaces/:id/memory          — add a new entry
 *   DELETE /api/workspaces/:id/memory/:memId   — remove one entry
 *
 * No PATCH/PUT: editing is delete + re-add. Keeps the contract tight
 * and the YAML diff trivial to reason about.
 *
 * All routes require `write` access to the workspace — memory is part
 * of the per-workspace config, same gate as actions.yaml / scripts.
 */
import type { FastifyInstance } from "fastify";
import { AddMemorySchema } from "@ariadne/shared";
import {
  listMemories,
  addMemory,
  deleteMemory,
} from "../services/workspaceMemory.js";
import { requireWorkspace } from "./workspaceGuard.js";

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/memory",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "read");
      if (!ws) return;
      return reply.send({ memories: listMemories(ws.rootPath) });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/workspaces/:id/memory",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const parsed = AddMemorySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid input",
          detail: parsed.error.message,
        });
      }
      const entry = addMemory(ws.rootPath, {
        text: parsed.data.text,
        addedBy: req.account.displayName,
        source: parsed.data.source,
      });
      return reply.status(201).send(entry);
    },
  );

  app.delete<{ Params: { id: string; memId: string } }>(
    "/workspaces/:id/memory/:memId",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const removed = deleteMemory(ws.rootPath, req.params.memId);
      if (!removed) {
        return reply.status(404).send({ error: "Memory entry not found" });
      }
      return reply.send({ ok: true as const });
    },
  );
}
