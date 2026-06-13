/**
 * Git routes (P3 IDE) — status / diff / commit on the workspace's OWN repo.
 *
 * Read ops (status, diff) require a workspace the caller can view. Commit is a
 * write to the user's repository, so it is LOCAL-only (rejectRemoteAccess) and
 * needs owner/write access — the same posture as direct file edits.
 */
import type { FastifyInstance } from "fastify";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";
import { gitStatus, gitDiff, gitCommit } from "../services/repoGit.js";

export async function gitRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces/:id/git/status
  app.get<{ Params: { id: string } }>("/workspaces/:id/git/status", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;
    return reply.send(await gitStatus(workspace.rootPath));
  });

  // GET /api/workspaces/:id/git/diff?path=<rel>&staged=<0|1>
  app.get<{ Params: { id: string }; Querystring: { path?: string; staged?: string } }>(
    "/workspaces/:id/git/diff",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;
      const relPath = req.query.path;
      if (!relPath) return reply.status(400).send({ error: "path is required" });
      const staged = req.query.staged === "1" || req.query.staged === "true";
      const diff = await gitDiff(workspace.rootPath, relPath, staged);
      if (diff === null) return reply.status(400).send({ error: "Not a git repository" });
      return reply.send({ diff });
    },
  );

  // POST /api/workspaces/:id/git/commit  { message, paths }
  app.post<{ Params: { id: string }; Body: { message?: string; paths?: string[] } }>(
    "/workspaces/:id/git/commit",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Committing is not permitted from remote access. Connect locally to commit.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const message = typeof req.body?.message === "string" ? req.body.message : "";
      const paths = Array.isArray(req.body?.paths)
        ? req.body.paths.filter((p): p is string => typeof p === "string")
        : [];
      const result = await gitCommit(workspace.rootPath, message, paths);
      if (!result.ok) return reply.status(400).send({ error: result.error });
      return reply.send(result);
    },
  );
}
