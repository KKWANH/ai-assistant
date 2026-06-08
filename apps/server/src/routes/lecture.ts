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
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireWorkspace } from "./workspaceGuard.js";
import { getLectureStructure, scaffoldLectureFolder, getCourseMemo, setCourseMemo } from "../services/lecturePrep.js";
import type { Deck } from "@ariadne/shared";
import { generateDeckOutline, buildPptx } from "../services/deckGen.js";
import { generateScript, buildScriptDocx } from "../services/scriptGen.js";
import { retrieveRelevantChunks, formatChunksForPrompt } from "../services/retrieval.js";
import { dbGetLatestSnapshot } from "../db/repo.js";
import { getActiveSettings } from "../config.js";
import { getProvider } from "../providers/index.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import { safeResolveUnderRoot } from "../security/pathGuard.js";

/** A filesystem-safe .pptx filename derived from a deck title. */
function deckFileName(title: string): string {
  const base = title.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "deck";
  return `${base}.pptx`;
}

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

  // Set a course's memo (its fixed thread + teaching style + student level),
  // injected into every deck generated for that course.
  app.post<{ Params: { id: string }; Body: { course?: string; memo?: string } }>(
    "/workspaces/:id/lecture/memo",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const course = req.body?.course?.trim();
      if (!course) return reply.status(400).send({ error: "course is required" });
      try {
        setCourseMemo(ws.rootPath, course, req.body?.memo ?? "");
        return reply.send({ ok: true as const });
      } catch (err) {
        return reply.status(400).send({ error: "Could not save memo", detail: String(err) });
      }
    },
  );

  // Generate a .pptx deck for a topic, grounded in the workspace's materials,
  // saved to the workspace root. Returns the outline (for the preview) + the
  // file name (for download). Write-gated — it both generates and saves.
  app.post<{ Params: { id: string }; Body: { topic?: string; course?: string; week?: string } }>(
    "/workspaces/:id/deck",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const topic = req.body?.topic?.trim();
      if (!topic) return reply.status(400).send({ error: "topic is required" });
      const courseMemo = req.body?.course ? getCourseMemo(ws.rootPath, req.body.course) : "";

      let grounding = "";
      const snapshot = dbGetLatestSnapshot(req.params.id);
      if (snapshot && snapshot.files.length > 0) {
        try {
          // Pull a wide set, then — when a week is given — prefer that week's
          // own materials (scope the deck to the week the lecturer is on),
          // falling back to the workspace-wide hits if the week isn't indexed.
          const chunks = await retrieveRelevantChunks(ws.rootPath, snapshot.files, topic, {
            workspaceId: ws.id,
            topK: req.body?.week ? 25 : 8,
          });
          const week = req.body?.week;
          const scoped = week
            ? chunks.filter((c) => c.path.startsWith(`${week.replace(/\/$/, "")}/`))
            : chunks;
          grounding = formatChunksForPrompt((scoped.length > 0 ? scoped : chunks).slice(0, 8));
        } catch {
          /* fall back to topic-only generation */
        }
      }

      const settings = getActiveSettings();
      const model =
        settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
      const provider = await getProvider({ provider: settings.provider, model });

      try {
        const deck = await generateDeckOutline(topic, grounding, provider, undefined, courseMemo);
        const pptx = await buildPptx(deck);
        const fileName = deckFileName(deck.title);
        const dest = safeResolveUnderRoot(path.resolve(ws.rootPath), fileName);
        if (!dest) return reply.status(400).send({ error: "Unsafe file name" });
        fs.writeFileSync(dest, pptx);
        return reply.send({ deck, fileName });
      } catch (err) {
        return reply.status(500).send({ error: "Deck generation failed", detail: String(err) });
      }
    },
  );

  // Generate a lecturer's spoken script (.docx) from a deck.
  app.post<{ Params: { id: string }; Body: { deck?: Deck; course?: string } }>(
    "/workspaces/:id/script",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const deck = req.body?.deck;
      if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
        return reply.status(400).send({ error: "deck is required" });
      }
      const courseMemo = req.body?.course ? getCourseMemo(ws.rootPath, req.body.course) : "";
      const settings = getActiveSettings();
      const model =
        settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
      const provider = await getProvider({ provider: settings.provider, model });
      try {
        const script = await generateScript(deck, courseMemo, provider);
        const docx = await buildScriptDocx(deck.title, script);
        const fileName = `${deckFileName(deck.title).replace(/\.pptx$/, "")} 스크립트.docx`;
        const dest = safeResolveUnderRoot(path.resolve(ws.rootPath), fileName);
        if (!dest) return reply.status(400).send({ error: "Unsafe file name" });
        fs.writeFileSync(dest, docx);
        return reply.send({ script, fileName });
      } catch (err) {
        return reply.status(500).send({ error: "Script generation failed", detail: String(err) });
      }
    },
  );

  // Download a generated file (deck .pptx or script .docx) from the root.
  app.get<{ Params: { id: string }; Querystring: { name?: string } }>(
    "/workspaces/:id/deck-file",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "read");
      if (!ws) return;
      const name = req.query.name?.trim();
      if (!name) return reply.status(400).send({ error: "name is required" });
      const abs = safeResolveUnderRoot(path.resolve(ws.rootPath), name);
      if (!abs || !fs.existsSync(abs)) return reply.status(404).send({ error: "File not found" });
      const mime = abs.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      return reply
        .type(mime)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        )
        .send(fs.readFileSync(abs));
    },
  );
}
