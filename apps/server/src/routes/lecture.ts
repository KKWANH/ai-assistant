/**
 * Lecture-prep routes — read a semester workspace as courses → weeks →
 * materials, and scaffold new course/week folders.
 *
 *   GET  /api/workspaces/:id/lecture          — the folder structure
 *   POST /api/workspaces/:id/lecture/folder   — create a course (and week)
 *
 * Both gate on the same workspace access as the rest of the workspace API:
 * read for the structure, write to scaffold.
 */
import type { FastifyInstance } from "fastify";
import { requireWorkspace } from "./workspaceGuard.js";
import { getLectureStructure, scaffoldLectureFolder } from "../services/lecturePrep.js";

export async function lectureRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/workspaces/:id/lecture", async (req, reply) => {
    const ws = await requireWorkspace(req.params.id, req, reply, "read");
    if (!ws) return;
    return reply.send(getLectureStructure(ws.rootPath));
  });

  app.post<{ Params: { id: string }; Body: { course?: string; week?: string } }>(
    "/workspaces/:id/lecture/folder",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const course = req.body?.course?.trim();
      const week = req.body?.week?.trim() || undefined;
      if (!course) return reply.status(400).send({ error: "course is required" });
      try {
        const result = scaffoldLectureFolder(ws.rootPath, course, week);
        return reply.status(201).send(result);
      } catch (err) {
        return reply.status(400).send({ error: "Could not create folder", detail: String(err) });
      }
    },
  );
}
