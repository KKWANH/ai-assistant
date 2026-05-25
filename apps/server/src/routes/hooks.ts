/**
 * Workspace hooks routes.
 *
 *   GET /api/workspaces/:id/hooks            list parsed hooks + raw source + recent logs
 *   PUT /api/workspaces/:id/hooks            replace `.ariadne/hooks.yaml` (local-only)
 *   GET /api/workspaces/:id/hooks/:hookId/log  raw log tail (~8 KB)
 *
 * The runtime triggers (staged_apply, post_scan, memory_added) fire
 * directly from the services that own those events — see
 * services/stagedEdits.ts, routes/workspaces.ts, services/workspaceMemory.ts.
 * This route file only manages the *configuration* + log inspection.
 *
 * EDIT is local-only because a hook is "run this command on my
 * machine." Granting remote sessions the ability to write hooks would
 * be an immediate code-execution vector.
 */
import type { FastifyInstance } from "fastify";
import { PutHooksSchema } from "@ariadne/shared";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";
import { loadHooks } from "../services/hooks.js";
import {
  readHooksYaml,
  writeHooksYaml,
  readHookLogTail,
} from "../ariadneFolder.js";

export async function hooksRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/workspaces/:id/hooks", async (req, reply) => {
    const ws = await requireWorkspace(req.params.id, req, reply, "read");
    if (!ws) return;
    const hooks = loadHooks(ws.rootPath);
    const source = readHooksYaml(ws.rootPath) ?? "";
    return reply.send({ hooks, source });
  });

  app.put<{ Params: { id: string } }>("/workspaces/:id/hooks", async (req, reply) => {
    if (await rejectRemoteAccess("Hook editing is local-only", req, reply)) return;
    const ws = await requireWorkspace(req.params.id, req, reply, "write");
    if (!ws) return;
    const parsed = PutHooksSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    writeHooksYaml(ws.rootPath, parsed.data.source);
    const hooks = loadHooks(ws.rootPath);
    return reply.send({ hooks, source: parsed.data.source });
  });

  app.get<{ Params: { id: string; hookId: string } }>(
    "/workspaces/:id/hooks/:hookId/log",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "read");
      if (!ws) return;
      const log = readHookLogTail(ws.rootPath, req.params.hookId);
      return reply.send({ log: log ?? "" });
    },
  );
}
