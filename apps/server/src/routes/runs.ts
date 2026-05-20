import type { FastifyInstance } from "fastify";
import { CreateRunSchema, ConfirmContextSchema } from "@ariadne/shared";
import {
  dbGetRun,
  dbListRuns,
  dbGetEvidencePack,
  dbGetLatestSnapshot,
  dbGetWorkspace,
} from "../db/repo.js";
import { createRun, confirmContext, getContextPick } from "../runs/engine.js";
import { readArtifact } from "../ariadneFolder.js";

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/runs?workspaceId=
  app.get<{ Querystring: { workspaceId?: string } }>("/runs", async (req, reply) => {
    const runs = dbListRuns(req.query.workspaceId);
    return reply.send(runs);
  });

  // POST /api/runs
  app.post("/runs", async (req, reply) => {
    const parsed = CreateRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    try {
      const run = await createRun({ ...parsed.data, createdBy: req.account?.id ?? null });
      return reply.status(201).send(run);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  // GET /api/runs/:id
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    return reply.send(run);
  });

  // GET /api/runs/:id/context
  app.get<{ Params: { id: string } }>("/runs/:id/context", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });

    const snapshot = dbGetLatestSnapshot(run.workspaceId);
    const contextPick = getContextPick(run, snapshot);
    return reply.send(contextPick);
  });

  // POST /api/runs/:id/context
  app.post<{ Params: { id: string } }>("/runs/:id/context", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });

    const parsed = ConfirmContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    try {
      const updated = await confirmContext(run.id, parsed.data.selected);
      return reply.send(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  // GET /api/runs/:id/brief
  app.get<{ Params: { id: string } }>("/runs/:id/brief", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    if (!run.artifacts.brief) {
      return reply.status(404).send({ error: "Brief not yet available" });
    }

    const workspace = dbGetWorkspace(run.workspaceId);
    if (!workspace) return reply.status(404).send({ error: "Workspace not found" });

    try {
      const markdown = readArtifact(workspace.rootPath, run.artifacts.brief);
      return reply.send({ markdown });
    } catch {
      return reply.status(404).send({ error: "Brief file not found" });
    }
  });

  // GET /api/runs/:id/evidence
  app.get<{ Params: { id: string } }>("/runs/:id/evidence", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });

    const pack = dbGetEvidencePack(run.id);
    return reply.send(pack);
  });

  // GET /api/runs/:id/diff
  app.get<{ Params: { id: string } }>("/runs/:id/diff", async (req, reply) => {
    const run = dbGetRun(req.params.id);
    if (!run) return reply.status(404).send({ error: "Run not found" });
    if (!run.artifacts.diff) {
      return reply.status(404).send({
        error: "Diff not available",
        detail: run.previousRunId ? "Diff may still be computing" : "No previous run to diff against",
      });
    }

    const workspace = dbGetWorkspace(run.workspaceId);
    if (!workspace) return reply.status(404).send({ error: "Workspace not found" });

    // Return the stored diff markdown wrapped in a RunDiff-shaped object
    // Full RunDiff is stored in evidence; serve the markdown for display
    try {
      const markdown = readArtifact(workspace.rootPath, run.artifacts.diff);
      return reply.send({ runId: run.id, previousRunId: run.previousRunId, markdown });
    } catch {
      return reply.status(404).send({ error: "Diff file not found" });
    }
  });
}
