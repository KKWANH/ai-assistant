/**
 * Report routes — the user-feedback → GitHub-issue pipeline.
 *
 * Any signed-in account may submit a report. Each report is auto-triaged by
 * the LLM in the background, then waits in a queue for an admin (the repo
 * manager) to review. On "file" the server records a pre-filled GitHub
 * "new issue" URL — the admin opens it and submits on GitHub themselves; the
 * app never posts public content on its own.
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateReportSchema, ReportDecisionSchema } from "@ariadne/shared";
import type { Report, ReportStatus, ChatAttachment } from "@ariadne/shared";
import {
  dbInsertReport,
  dbListReports,
  dbGetReport,
  dbSetReportTriage,
  dbDecideReport,
} from "../db/repo.js";
import { saveUpload } from "../services/uploads.js";
import { getProvider } from "../providers/index.js";
import { triageReport } from "../services/triage.js";
import { getActiveSettings, isProviderConfigured, GITHUB_REPO } from "../config.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import logger from "../logger.js";

function now(): string {
  return new Date().toISOString();
}

/** Build a pre-filled GitHub "new issue" URL from a (possibly triaged) report. */
function githubIssueUrl(report: Report): string {
  const title = (report.triage?.suggestedTitle || report.title).slice(0, 120);
  let body = report.triage?.suggestedBody || report.description;
  // Keep the URL well within practical limits — Korean text triples when
  // percent-encoded. The admin sees the full report in Ariadne regardless.
  if (body.length > 1500) body = body.slice(0, 1500) + "\n\n…(truncated)";
  body +=
    "\n\n---\n_Filed via an Ariadne in-app report" +
    (report.createdByName ? " by " + report.createdByName : "") +
    "._";
  const params = new URLSearchParams({ title, body });
  const label =
    report.type === "bug" ? "bug" : report.type === "suggestion" ? "enhancement" : "";
  if (label) params.set("labels", label);
  return "https://github.com/" + GITHUB_REPO + "/issues/new?" + params.toString();
}

/** Auto-triage a report in the background. Best-effort — never throws. */
async function triageInBackground(reportId: string): Promise<void> {
  const report = dbGetReport(reportId);
  if (!report) return;
  try {
    const settings = getActiveSettings();
    if (!isProviderConfigured(settings.provider)) return; // no model — leave untriaged
    const model =
      settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
    const provider = await getProvider({ provider: settings.provider, model });
    const triage = await triageReport(
      provider,
      report.type,
      report.title,
      report.description,
      new AbortController().signal,
    );
    dbSetReportTriage(reportId, triage, now());
  } catch (err) {
    logger.warn({ err, reportId }, "Report triage failed");
  }
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/reports — any signed-in account may submit a report.
  app.post("/reports", async (req, reply) => {
    const parsed = CreateReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    // Persist any uploaded images, mirroring the chat-attachment flow.
    const attachments: ChatAttachment[] = [];
    for (const att of parsed.data.attachments ?? []) {
      const uploadId = crypto.randomUUID();
      const meta = saveUpload(uploadId, att.name, att.mediaType, att.dataBase64);
      attachments.push({
        id: uploadId,
        name: att.name,
        mediaType: att.mediaType,
        kind: meta.kind,
        size: meta.size,
      });
    }
    const report: Report = {
      id: crypto.randomUUID(),
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      createdBy: req.account?.id ?? null,
      createdByName: req.account?.displayName ?? null,
      createdAt: now(),
      status: "pending",
      triage: null,
      triagedAt: null,
      decidedBy: null,
      decidedAt: null,
      githubUrl: null,
      attachments,
    };
    dbInsertReport(report);
    setImmediate(() => void triageInBackground(report.id));
    return reply.status(201).send(dbGetReport(report.id));
  });

  // GET /api/reports?status= — admin only: the review queue.
  app.get<{ Querystring: { status?: string } }>("/reports", async (req, reply) => {
    if (req.account.role !== "admin") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const s = req.query.status;
    const status: ReportStatus | undefined =
      s === "pending" || s === "rejected" || s === "filed" ? s : undefined;
    return reply.send(dbListReports(status));
  });

  // GET /api/reports/:id — admin only.
  app.get<{ Params: { id: string } }>("/reports/:id", async (req, reply) => {
    if (req.account.role !== "admin") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const report = dbGetReport(req.params.id);
    if (!report) return reply.status(404).send({ error: "Report not found" });
    return reply.send(report);
  });

  // POST /api/reports/:id/decision — admin files or rejects a pending report.
  app.post<{ Params: { id: string } }>("/reports/:id/decision", async (req, reply) => {
    if (req.account.role !== "admin") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const parsed = ReportDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    const report = dbGetReport(req.params.id);
    if (!report) return reply.status(404).send({ error: "Report not found" });
    if (report.status !== "pending") {
      return reply.status(409).send({ error: "Report has already been decided" });
    }

    if (parsed.data.decision === "reject") {
      return reply.send(dbDecideReport(report.id, "rejected", req.account.id, now(), null));
    }

    // "file": record the pre-filled issue URL. The admin opens it to actually
    // create the issue on GitHub — the app never publishes on its own.
    const url = githubIssueUrl(report);
    return reply.send(dbDecideReport(report.id, "filed", req.account.id, now(), url));
  });
}
