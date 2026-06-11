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
import { requireWorkspace } from "@ariadne/server/src/routes/workspaceGuard.js";
import { getLectureStructure, scaffoldLectureFolder, getCourseMemo, setCourseMemo } from "./lecturePrep.js";
import { getWorkspaceContext } from "@ariadne/server/src/services/workspaceContext.js";
import type { Deck } from "../types.js";
import { generateDeckOutline, buildPptx } from "./deckGen.js";
import { generateScript, buildScriptDocx } from "./scriptGen.js";
import { generateExam, checkCoverage, buildExamDocx } from "./examGen.js";
import { retrieveRelevantChunks, formatChunksForPrompt } from "@ariadne/server/src/services/retrieval.js";
import { dbGetLatestSnapshot } from "@ariadne/server/src/db/repo.js";
import { resolveTierSettings } from "@ariadne/server/src/config.js";
import { getProvider } from "@ariadne/server/src/providers/index.js";
import { resolveOllamaModel } from "@ariadne/server/src/services/ollamaModels.js";
import { safeResolveUnderRoot } from "@ariadne/server/src/security/pathGuard.js";

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
      // Project context (general, all workspaces) + the course's own memo —
      // both steer generation so the deck/script stays consistent with the
      // user's standing brief and the course's thread.
      const courseMemo = [
        getWorkspaceContext(ws.rootPath),
        req.body?.course ? getCourseMemo(ws.rootPath, req.body.course) : "",
      ]
        .filter((s) => s.trim())
        .join("\n\n");

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

      // Deck outlines lean on art-history knowledge the local model is thin on,
      // so route generation to the frontier rung — Gemini Flash when a key is
      // configured, transparently falling back to local otherwise.
      const settings = resolveTierSettings("frontier");
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

  // Rebuild a deck's .pptx from an edited outline — used after the lecturer
  // picks per-slide images, so the saved file embeds them. Write-gated; it
  // overwrites the same-named .pptx. buildPptx fetches each picked image
  // (SSRF-guarded, size-capped) and embeds it beside the bullets.
  app.post<{ Params: { id: string }; Body: { deck?: Deck } }>(
    "/workspaces/:id/deck-rebuild",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const deck = req.body?.deck;
      if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
        return reply.status(400).send({ error: "deck is required" });
      }
      try {
        const pptx = await buildPptx(deck);
        const fileName = deckFileName(deck.title);
        const dest = safeResolveUnderRoot(path.resolve(ws.rootPath), fileName);
        if (!dest) return reply.status(400).send({ error: "Unsafe file name" });
        fs.writeFileSync(dest, pptx);
        return reply.send({ fileName });
      } catch (err) {
        return reply.status(500).send({ error: "Deck rebuild failed", detail: String(err) });
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
      // Project context (general, all workspaces) + the course's own memo —
      // both steer generation so the deck/script stays consistent with the
      // user's standing brief and the course's thread.
      const courseMemo = [
        getWorkspaceContext(ws.rootPath),
        req.body?.course ? getCourseMemo(ws.rootPath, req.body.course) : "",
      ]
        .filter((s) => s.trim())
        .join("\n\n");
      // Same rung as the deck: the spoken script needs the same scholarship,
      // so it rides the frontier tier (Gemini Flash if keyed, else local).
      const settings = resolveTierSettings("frontier");
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

  // Generate an exam from a course/week's materials, then audit its coverage.
  // Two tiers working together (the model-routing scaffold's first real payoff):
  // items on the workhorse model (F), the coverage audit on the strong one (F+).
  // Writes a printable .docx and returns exam + coverage for the preview.
  // Download reuses /deck-file (it already serves .docx).
  app.post<{ Params: { id: string }; Body: { course?: string; week?: string; count?: number } }>(
    "/workspaces/:id/exam",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const scope =
        [req.body?.course, req.body?.week].map((s) => s?.trim()).filter(Boolean).join(" · ") || "시험";
      const courseMemo = [
        getWorkspaceContext(ws.rootPath),
        req.body?.course ? getCourseMemo(ws.rootPath, req.body.course) : "",
      ]
        .filter((s) => s.trim())
        .join("\n\n");

      // Ground the exam in the course's own materials (scoped to the week when
      // given) — the same retrieval the deck uses, so a test covers what was taught.
      let grounding = "";
      const snapshot = dbGetLatestSnapshot(req.params.id);
      if (snapshot && snapshot.files.length > 0) {
        try {
          const chunks = await retrieveRelevantChunks(ws.rootPath, snapshot.files, scope, {
            workspaceId: ws.id,
            topK: req.body?.week ? 25 : 12,
          });
          const week = req.body?.week;
          const scoped = week
            ? chunks.filter((c) => c.path.startsWith(`${week.replace(/\/$/, "")}/`))
            : chunks;
          grounding = formatChunksForPrompt((scoped.length > 0 ? scoped : chunks).slice(0, 10));
        } catch {
          /* fall through to the no-materials guard below */
        }
      }
      if (!grounding.trim()) {
        return reply.status(400).send({ error: "No indexed materials to build an exam from" });
      }

      const count = Math.max(3, Math.min(20, Math.trunc(Number(req.body?.count) || 8)));
      try {
        // Items: workhorse tier (F → Gemini Flash when keyed, else local).
        const itemSettings = resolveTierSettings("frontier");
        const itemModel =
          itemSettings.provider === "ollama" ? await resolveOllamaModel(itemSettings.model) : itemSettings.model;
        const itemProvider = await getProvider({ provider: itemSettings.provider, model: itemModel });
        const exam = await generateExam(scope, grounding, courseMemo, itemProvider, count);
        if (exam.items.length === 0) {
          return reply.status(422).send({ error: "Materials were too thin to generate an exam" });
        }

        // Coverage audit: strong tier (F+ → Gemini Pro when keyed, else local).
        const auditSettings = resolveTierSettings("frontier-strong");
        const auditModel =
          auditSettings.provider === "ollama" ? await resolveOllamaModel(auditSettings.model) : auditSettings.model;
        const auditProvider = await getProvider({ provider: auditSettings.provider, model: auditModel });
        const coverage = await checkCoverage(exam, grounding, auditProvider);

        const docx = await buildExamDocx(exam, coverage);
        const fileName = `${scope.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "시험"} 문제.docx`;
        const dest = safeResolveUnderRoot(path.resolve(ws.rootPath), fileName);
        if (!dest) return reply.status(400).send({ error: "Unsafe file name" });
        fs.writeFileSync(dest, docx);
        return reply.send({ exam, coverage, fileName });
      } catch (err) {
        return reply.status(500).send({ error: "Exam generation failed", detail: String(err) });
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
