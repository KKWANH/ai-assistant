import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { CreateWorkspaceSchema, UpdateWorkspaceSchema } from "@ariadne/shared";
import { DEFAULT_INCLUDE, DEFAULT_EXCLUDE, isBuiltinWorkspace } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import {
  dbInsertWorkspace,
  dbListWorkspaces,
  dbUpdateWorkspace,
  dbDeleteWorkspace,
  dbGetLatestSnapshot,
} from "../db/repo.js";
import { scanWorkspace } from "../workspace/scanner.js";
import { ensureAriadneFolder, writeSurface } from "../ariadneFolder.js";
import { buildSurface } from "../services/surfaceBuild.js";
import * as portfolioStarter from "../surface/portfolioStarter.js";
import * as budgetStarter from "../surface/budgetStarter.js";
import * as readingStarter from "../surface/readingStarter.js";
import * as chefbookStarter from "../surface/chefbookStarter.js";
import logger from "../logger.js";
import { canAccessWorkspace, requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

/**
 * Sample files + custom surface scaffolded for each non-blank workspace
 * template. Optional `actions` is a YAML string that lands at
 * `.ariadne/actions.yaml` so the workspace ships with usable actions
 * the user can run from the 'Create & Run' tab immediately.
 */
const STARTERS: Record<
  string,
  { files: Record<string, string>; surface: string; actions?: string }
> = {
  portfolio: {
    files: {
      "holdings.csv": portfolioStarter.HOLDINGS_CSV,
      "fx_rates.csv": portfolioStarter.FX_RATES_CSV,
      "history.csv": portfolioStarter.HISTORY_CSV,
    },
    surface: portfolioStarter.SURFACE_TSX,
    actions: portfolioStarter.ACTIONS_YAML,
  },
  budget: {
    files: { "budget.csv": budgetStarter.BUDGET_CSV },
    surface: budgetStarter.SURFACE_TSX,
  },
  reading: {
    files: { "library.csv": readingStarter.LIBRARY_CSV },
    surface: readingStarter.SURFACE_TSX,
  },
  chefbook: {
    files: {
      "ingredients.csv": chefbookStarter.INGREDIENTS_CSV,
      "tools.csv": chefbookStarter.TOOLS_CSV,
      "recipes.csv": chefbookStarter.RECIPES_CSV,
    },
    surface: chefbookStarter.SURFACE_TSX,
  },
};

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces
  app.get("/workspaces", async (req, reply) => {
    const all = dbListWorkspaces();
    const visible = all.filter((w) => canAccessWorkspace(w, req.account));
    return reply.send(visible);
  });

  // POST /api/workspaces
  app.post("/workspaces", async (req, reply) => {
    const parsed = CreateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    const { name, rootPath, include, exclude, starter, visibility } = parsed.data;

    if (!fs.existsSync(rootPath)) {
      return reply.status(400).send({ error: "rootPath does not exist", detail: rootPath });
    }
    if (!fs.statSync(rootPath).isDirectory()) {
      return reply.status(400).send({ error: "rootPath is not a directory", detail: rootPath });
    }

    // Category scopes which templates the workspace surfaces — derived from the
    // starter so a portfolio/budget workspace shows finance templates, etc.
    const categoryByStarter: Record<string, string | null> = {
      portfolio: "finance",
      budget: "finance",
      reading: "research",
      chefbook: "cooking",
      blank: null,
    };
    const category = starter ? categoryByStarter[starter] ?? null : null;

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      rootPath,
      include: include ?? DEFAULT_INCLUDE,
      exclude: exclude ?? DEFAULT_EXCLUDE,
      createdAt: new Date().toISOString(),
      lastScanAt: null,
      fileCount: 0,
      createdBy: req.account?.id ?? null,
      createdByName: req.account?.displayName ?? null,
      visibility: visibility ?? "private",
      category,
    };

    dbInsertWorkspace(workspace);
    ensureAriadneFolder(rootPath);

    // Scaffold a starter template if requested (best-effort; failures are non-fatal)
    const starterDef = starter && starter !== "blank" ? STARTERS[starter] : undefined;
    if (starterDef) {
      try {
        for (const [filename, content] of Object.entries(starterDef.files)) {
          fs.writeFileSync(path.join(rootPath, filename), content, "utf-8");
        }
        writeSurface(rootPath, starterDef.surface);
        if (starterDef.actions) {
          // The .ariadne/ folder already exists from ensureAriadneFolder() above.
          fs.writeFileSync(
            path.join(rootPath, ".ariadne", "actions.yaml"),
            starterDef.actions,
            "utf-8",
          );
        }
        buildSurface(rootPath).catch((err: unknown) => {
          logger.warn({ err, starter }, "Starter surface build failed");
        });
      } catch (err) {
        logger.warn({ err, starter }, "Failed to scaffold starter template files");
      }
    }

    return reply.status(201).send(workspace);
  });

  // GET /api/workspaces/:id
  app.get<{ Params: { id: string } }>("/workspaces/:id", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;
    return reply.send(workspace);
  });

  // GET /api/workspaces/:id/history — list recent commits in the
  // workspace's .ariadne/ git repo (auto-versioned per run).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/workspaces/:id/history",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;
      const { listWorkspaceHistory } = await import("../services/workspaceGit.js");
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const commits = await listWorkspaceHistory(workspace.rootPath, limit);
      return reply.send(commits);
    },
  );

  // PATCH /api/workspaces/:id
  app.patch<{ Params: { id: string } }>("/workspaces/:id", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    const parsed = UpdateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const updated = dbUpdateWorkspace(req.params.id, parsed.data);
    return reply.send(updated);
  });

  // DELETE /api/workspaces/:id — LOCAL access only (workspace files are left intact)
  app.delete<{ Params: { id: string } }>("/workspaces/:id", async (req, reply) => {
    if (
      await rejectRemoteAccess(
        "Deleting a workspace is not permitted from remote access. Connect locally to manage workspaces.",
        req,
        reply,
      )
    )
      return;

    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    if (isBuiltinWorkspace(workspace.id)) {
      return reply
        .status(403)
        .send({ error: "Built-in workspaces cannot be deleted." });
    }

    dbDeleteWorkspace(req.params.id);
    return reply.send({ ok: true });
  });

  // POST /api/workspaces/:id/scan
  app.post<{ Params: { id: string } }>("/workspaces/:id/scan", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    try {
      const snapshot = await scanWorkspace(workspace);
      dbUpdateWorkspace(workspace.id, {
        lastScanAt: snapshot.createdAt,
        fileCount: snapshot.fileCount,
      });
      return reply.send(snapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Scan failed", detail: msg });
    }
  });

  // GET /api/workspaces/:id/snapshot
  app.get<{ Params: { id: string } }>("/workspaces/:id/snapshot", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    const snapshot = dbGetLatestSnapshot(req.params.id);
    if (!snapshot) return reply.status(404).send({ error: "No snapshot found — run a scan first" });

    return reply.send(snapshot);
  });
}
