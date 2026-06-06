/**
 * Eval-case promotion route.
 *
 * Lets a logged-in account turn a bad chat answer or bad search result
 * into a permanent retrieval eval case. The case lands on disk under:
 *
 *   apps/server/src/eval/cases/user-promoted/<workspaceId>/<ts>-<hash>.yaml
 *
 * and is picked up by `npm run eval:retrieval:promoted`. This is the
 * promotion-style learning pattern — the model doesn't change, the surrounding system gets smarter.
 *
 * Auth: requires a workspace the caller can modify (same gate as edits).
 * Mutation: write-only — never deletes existing cases. Removal is a
 * follow-up (probably a "Promoted cases" tab in workspace settings).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import yaml from "yaml";
import { PromoteEvalCaseSchema, type PromoteEvalCaseInput } from "@ariadne/shared";
import { requireWorkspace } from "./workspaceGuard.js";
import { userPromotedCasesRoot } from "../eval/cases.js";
import logger from "../logger.js";

interface PromotedCaseFile {
  cases: PromotedCase[];
}

interface PromotedCase {
  id: string;
  workspace: string;
  query: string;
  mustHit?: { path: string; contains?: string }[];
  shouldNotHit?: string[];
  // Annotations — the loader ignores these but humans can read them.
  promotedBy: string | null;
  promotedByName: string | null;
  promotedAt: string;
  source: { kind: PromoteEvalCaseInput["source"]; ref?: string };
  note?: string;
}

/** Short, filesystem-safe id for a case. 8 random hex chars = ~4B keyspace,
 *  plenty for human-promoted cases. The timestamp prefix gives ordering. */
function newCaseId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `promoted-${ts}-${rand}`;
}

export async function evalCaseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/eval-cases/promote", async (req, reply) => {
    const parsed = PromoteEvalCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid input",
        detail: parsed.error.message,
      });
    }
    const input = parsed.data;

    const workspace = await requireWorkspace(input.workspaceId, req, reply, "write");
    if (!workspace) return; // requireWorkspace already sent the response

    const dir = path.join(userPromotedCasesRoot(), workspace.id);
    fs.mkdirSync(dir, { recursive: true });

    // Write/refresh workspace.yaml so the runner can find the actual disk
    // root without DB access. Captures the root at promotion time — if the
    // user moves the folder later, the runner skips with a warning.
    const metaPath = path.join(dir, "workspace.yaml");
    fs.writeFileSync(
      metaPath,
      yaml.stringify({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceRoot: workspace.rootPath,
      }),
      "utf-8",
    );

    const caseId = newCaseId();
    const now = new Date().toISOString();
    const account = req.account;

    const yamlCase: PromotedCase = {
      id: caseId,
      workspace: workspace.id,
      query: input.query,
      promotedBy: account.id,
      promotedByName: account.displayName,
      promotedAt: now,
      source: {
        kind: input.source,
        ...(input.sourceRef ? { ref: input.sourceRef } : {}),
      },
    };
    if (input.mustHitPath) {
      yamlCase.mustHit = [
        {
          path: input.mustHitPath,
          ...(input.mustHitContains ? { contains: input.mustHitContains } : {}),
        },
      ];
    }
    if (input.shouldNotHitPath) {
      yamlCase.shouldNotHit = [input.shouldNotHitPath];
    }
    if (input.note) {
      yamlCase.note = input.note;
    }

    const fileBody: PromotedCaseFile = { cases: [yamlCase] };
    const header =
      `# Promoted by ${account.displayName} on ${now}\n` +
      `# Source: ${input.source}` +
      (input.sourceRef ? ` (${input.sourceRef})` : "") +
      `\n` +
      (input.note ? `# Note: ${input.note}\n` : "");
    const savedPath = path.join(dir, `${caseId}.yaml`);
    fs.writeFileSync(savedPath, header + yaml.stringify(fileBody), "utf-8");

    logger.info(
      {
        workspaceId: workspace.id,
        caseId,
        source: input.source,
        accountId: account.id,
      },
      "Promoted eval case",
    );

    return reply.status(201).send({
      ok: true as const,
      caseId,
      // Return a repo-relative path so the response is portable across
      // dev machines.
      savedPath: path.relative(process.cwd(), savedPath),
    });
  });
}
