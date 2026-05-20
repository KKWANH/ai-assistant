/**
 * Custom workspace action routes.
 *
 * GET /api/workspaces/:id/actions   → { source, actions, error }
 * PUT /api/workspaces/:id/actions   → save raw YAML (LOCAL access only)
 *
 * The PUT endpoint mirrors the scripts gating: remote access is forbidden.
 * The GET endpoint respects the workspace visibility guard.
 */

import type { FastifyInstance } from "fastify";
import { ActionsPutSchema } from "@ariadne/shared";
import { ensureAriadneFolder, writeActionsYaml } from "../ariadneFolder.js";
import { loadWorkspaceActions } from "../services/actions.js";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces/:id/actions
  app.get<{ Params: { id: string } }>("/workspaces/:id/actions", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const result = loadWorkspaceActions(workspace.rootPath);
    return reply.send(result);
  });

  // PUT /api/workspaces/:id/actions — LOCAL access only
  app.put<{ Params: { id: string } }>("/workspaces/:id/actions", async (req, reply) => {
    if (
      await rejectRemoteAccess(
        "Editing actions is not permitted from remote access. Connect locally to manage actions.",
        req,
        reply,
      )
    )
      return;

    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    const parsed = ActionsPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    ensureAriadneFolder(workspace.rootPath);
    try {
      writeActionsYaml(workspace.rootPath, parsed.data.source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to write actions.yaml", detail: msg });
    }

    // Return the parsed result so the client knows if there are validation errors
    const result = loadWorkspaceActions(workspace.rootPath);
    return reply.send(result);
  });
}
