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
import { ActionsPutSchema, CreateActionRunSchema } from "@ariadne/shared";
import { ensureAriadneFolder, writeActionsYaml } from "../ariadneFolder.js";
import { loadWorkspaceActions, loadActionDefs } from "../services/actions.js";
import { BUILTIN_TEMPLATES } from "../runs/templates.js";
import { createActionRun } from "../runs/actionEngine.js";
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

  // GET /api/workspaces/:id/action-defs — the unified "create & run" list:
  // built-in templates (scoped to the workspace category) + custom actions.
  app.get<{ Params: { id: string } }>("/workspaces/:id/action-defs", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const templates = workspace.category
      ? BUILTIN_TEMPLATES.filter((tmpl) => tmpl.category === workspace.category)
      : BUILTIN_TEMPLATES;
    const { actions, error } = loadActionDefs(workspace.rootPath);
    return reply.send({ templates, actions, error });
  });

  // POST /api/workspaces/:id/actions/:actionId/run — run a block-pipeline action
  app.post<{ Params: { id: string; actionId: string } }>(
    "/workspaces/:id/actions/:actionId/run",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const parsed = CreateActionRunSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
      }

      try {
        const run = await createActionRun({
          workspaceId: workspace.id,
          actionId: req.params.actionId,
          input: parsed.data.input,
          createdBy: req.account?.id ?? null,
        });
        return reply.status(201).send(run);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: "Failed to start action run", detail: msg });
      }
    },
  );
}
