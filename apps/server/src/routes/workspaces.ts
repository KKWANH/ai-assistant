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
import { fireHooksDetached } from "../services/hooks.js";
import { buildSurface } from "../services/surfaceBuild.js";
import { exportWorkspaceTemplate } from "../services/workspaceTemplate.js";
import { retrieveWithMeta } from "../services/retrieval.js";
import * as portfolioStarter from "../surface/portfolioStarter.js";
import { seedPortfolioV2Surface } from "../surface/portfolioV2Template.js";
import * as budgetStarter from "../surface/budgetStarter.js";
import * as readingStarter from "../surface/readingStarter.js";
import * as chefbookStarter from "../surface/chefbookStarter.js";
import * as codeStarter from "../surface/codeStarter.js";
import * as decisionsStarter from "../surface/decisionsStarter.js";
import * as papersStarter from "../surface/papersStarter.js";
import logger from "../logger.js";
import { canViewWorkspace, requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

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
      // v1 compatibility — the current surface still reads these.
      "holdings.csv": portfolioStarter.HOLDINGS_CSV,
      "fx_rates.csv": portfolioStarter.FX_RATES_CSV,
      "history.csv": portfolioStarter.HISTORY_CSV,
      // v2 layout — see docs/PORTFOLIO_STARTER_V2.md. The actions
      // already read from this v2 layout; the surface upgrade is
      // Phase 2.
      "accounts/_index.yaml":          portfolioStarter.ACCOUNTS_INDEX_YAML,
      "positions/current.csv":         portfolioStarter.POSITIONS_CURRENT_CSV,
      "positions/watchlist.csv":       portfolioStarter.POSITIONS_WATCHLIST_CSV,
      "cash/_index.yaml":              portfolioStarter.CASH_INDEX_YAML,
      "assets/precious_metals.yaml":   portfolioStarter.ASSETS_PRECIOUS_METALS_YAML,
      "assets/funds.yaml":             portfolioStarter.ASSETS_FUNDS_YAML,
      "analysis/macro/sample.md":      portfolioStarter.ANALYSIS_MACRO_SAMPLE_MD,
      "analysis/meso/sample.md":       portfolioStarter.ANALYSIS_MESO_SAMPLE_MD,
      "analysis/micro/AAPL-2026-01.md": portfolioStarter.ANALYSIS_MICRO_AAPL_MD,
      "goals/2026-allocation.md":      portfolioStarter.GOALS_2026_ALLOCATION_MD,
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
  code: {
    files: {
      "README.md": codeStarter.README_MD,
      "package.json": codeStarter.PACKAGE_JSON,
      "src/index.ts": codeStarter.INDEX_TS,
      "src/utils.ts": codeStarter.UTILS_TS,
    },
    surface: codeStarter.SURFACE_TSX,
    actions: codeStarter.ACTIONS_YAML,
  },
  decisions: {
    files: {
      "README.md": decisionsStarter.DECISIONS_README,
      "prd/workspace-search.md": decisionsStarter.PRD_SAMPLE,
      "decisions/ADR-001-sqlite.md": decisionsStarter.ADR_001,
      "decisions/ADR-002-tree-sitter.md": decisionsStarter.ADR_002,
      "open-questions.md": decisionsStarter.OPEN_QUESTIONS,
    },
    surface: decisionsStarter.SURFACE_TSX,
    actions: decisionsStarter.ACTIONS_YAML,
  },
  papers: {
    files: {
      "README.md": papersStarter.PAPERS_README,
      "papers/notes/Smith24-rag-survey.md": papersStarter.NOTES_SMITH24,
      "papers/notes/Park23-hybrid-retrieval.md": papersStarter.NOTES_PARK23,
      "papers/notes/Lee24-graph-rag.md": papersStarter.NOTES_LEE24,
      "references.bib": papersStarter.REFERENCES_BIB,
      "reading-queue.md": papersStarter.READING_QUEUE,
    },
    surface: papersStarter.SURFACE_TSX,
    actions: papersStarter.ACTIONS_YAML,
  },
};

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces — uses the read predicate so public workspaces
  // (visibility="public") show up in the list for any authenticated
  // account, not just the owner. Owner/admin-only operations on those
  // public rows are still gated at the per-route level via mode="write".
  app.get("/workspaces", async (req, reply) => {
    const all = dbListWorkspaces();
    const visible = all.filter((w) => canViewWorkspace(w, req.account));
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
      code: "code",
      decisions: "decisions",
      papers: "research",
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
          const filePath = path.join(rootPath, filename);
          // mkdirp the parent so starters can ship nested paths
          // (e.g. the code starter's src/index.ts).
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, "utf-8");
        }
        // Portfolio starter ships the v2 multi-file surface folder
        // (AI1). Other starters keep their single-file surface for
        // now — they're smaller and don't need the split.
        if (starter === "portfolio") {
          seedPortfolioV2Surface(rootPath);
        } else {
          writeSurface(rootPath, starterDef.surface);
        }
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
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;
    return reply.send(workspace);
  });

  // GET /api/workspaces/:id/export — download the workspace as a portable
  // .ariadne.tar template (BL1): manifest + surface + actions + any
  // author-listed seed files. No personal data unless the author opted in
  // via .ariadne/template.yaml seedFiles.
  app.get<{ Params: { id: string } }>("/workspaces/:id/export", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;
    const { manifest, tar } = await exportWorkspaceTemplate(workspace.rootPath, workspace.name);
    const safeName = (manifest.name || "workspace").replace(/[^\w.-]+/g, "_") || "workspace";
    reply.header("content-type", "application/x-tar");
    reply.header("content-disposition", `attachment; filename="${safeName}.ariadne.tar"`);
    return reply.send(tar);
  });

  // GET /api/workspaces/:id/history — list recent commits in the
  // workspace's .ariadne/ git repo (auto-versioned per run). Commit
  // rows are decorated with an `applyRunId` field when they correspond
  // to an `apply` step (so the UI can offer Rewind only where it works).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/workspaces/:id/history",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;
      const { listWorkspaceHistory } = await import("../services/workspaceGit.js");
      const { listAppliedCommits } = await import("../services/stagedEdits.js");
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const commits = await listWorkspaceHistory(workspace.rootPath, limit);
      const applies = listAppliedCommits(workspace.id);
      const applyBySha = new Map(applies.map((a) => [a.sha, a]));
      // Annotate so the front-end knows which rows can be rewound.
      const decorated = commits.map((c) => ({
        ...c,
        applyRunId: applyBySha.get(c.sha)?.runId ?? null,
      }));
      return reply.send(decorated);
    },
  );

  // GET /api/workspaces/:id/history/:sha — single commit with each
  // file's before/after bodies, for the per-commit diff UI.
  app.get<{ Params: { id: string; sha: string } }>(
    "/workspaces/:id/history/:sha",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;
      // Sha sanity guard — accept short or full hex; service double-checks.
      if (!/^[a-f0-9]{7,40}$/i.test(req.params.sha)) {
        return reply.status(400).send({ error: "Invalid sha" });
      }
      const { getCommitDetail } = await import("../services/workspaceGit.js");
      const detail = await getCommitDetail(workspace.rootPath, req.params.sha);
      if (!detail) return reply.status(404).send({ error: "Commit not found" });
      return reply.send(detail);
    },
  );

  // POST /api/workspaces/:id/history/rewind — restore the workspace to
  // its state immediately BEFORE the given commit. Only `apply` commits
  // can be rewound (the staged tree they reference has to still exist).
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/workspaces/:id/history/rewind",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;
      const body = (req.body ?? {}) as { sha?: unknown };
      const sha = typeof body.sha === "string" ? body.sha : "";
      if (!sha) return reply.status(400).send({ error: "sha is required" });
      try {
        const { rewindApply } = await import("../services/stagedEdits.js");
        const result = await rewindApply(workspace.id, sha);
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
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
      // Fire post_scan hooks detached — don't block the response on
      // whatever the user told us to do after a scan completes.
      fireHooksDetached("post_scan", workspace.rootPath, {
        fileCount: snapshot.fileCount,
        snapshotId: snapshot.id,
      });
      return reply.send(snapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Scan failed", detail: msg });
    }
  });

  // GET /api/workspaces/:id/snapshot
  app.get<{ Params: { id: string } }>("/workspaces/:id/snapshot", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;

    const snapshot = dbGetLatestSnapshot(req.params.id);
    if (!snapshot) return reply.status(404).send({ error: "No snapshot found — run a scan first" });

    return reply.send(snapshot);
  });

  // AY — SSE stream for workspace-scoped push events. Client opens
  // `EventSource('/api/workspaces/:id/events')` and receives JSON-line
  // pushes when a scan finishes, the markdown cache warms, etc.
  // Avoids the "scan twice to see the md badge" UX wart from AX.
  app.get<{ Params: { id: string } }>("/workspaces/:id/events", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;
    const { subscribeWorkspace, subscriberCount } = await import("../services/workspaceEvents.js");
    const { Readable } = await import("node:stream");

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Subscribers": String(subscriberCount(workspace.id) + 1),
    });
    // SSE comment line — opens the stream so the client's onopen fires
    // immediately, before any real event.
    reply.raw.write(`: connected\n\n`);

    const stream = new Readable({ read() { /* push-driven */ } });
    stream.pipe(reply.raw);

    const unsubscribe = subscribeWorkspace(workspace.id, (event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event.data ?? {})}\n\n`);
    });

    // Heartbeat every 25s so proxies don't drop the connection as idle.
    const heartbeat = setInterval(() => {
      try { reply.raw.write(`: heartbeat\n\n`); } catch { /* socket dead */ }
    }, 25_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      try { reply.raw.end(); } catch { /* */ }
    };
    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);
  });

  // GET /api/workspaces/:id/search?q=…&topK=N
  // The chat path's retrieveRelevantChunks engine, exposed as a standalone
  // surface so the UI's /workspaces/:id/search page can rank workspace
  // chunks by the same semantic + keyword + symbol-boost pipeline that
  // grounds the chat answers. /api/search (root-level) was always a *web*
  // search; this is the workspace counterpart.
  app.get<{ Params: { id: string }; Querystring: { q?: string; topK?: string } }>(
    "/workspaces/:id/search",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;

      const query = (req.query.q ?? "").trim();
      if (!query) {
        return reply.send({ query: "", chunks: [], indexed: false });
      }
      const topK = Math.min(Math.max(parseInt(req.query.topK ?? "10", 10) || 10, 1), 50);

      const snapshot = dbGetLatestSnapshot(workspace.id);
      if (!snapshot) {
        return reply
          .status(404)
          .send({ error: "No snapshot found — run a scan first" });
      }

      const result = await retrieveWithMeta(
        workspace.rootPath,
        snapshot.files,
        query,
        { workspaceId: workspace.id, topK },
      );
      // Honest fields. `indexed` is "an embedding index was actually used",
      // *not* "any result came back". `strategy` says which path ran, so
      // the UI can render "Semantic match" / "Keyword + symbol boost" /
      // "Keyword only" without lying. `warnings` surfaces things like
      // "index provider X ≠ active Y — reindex needed".
      return reply.send({
        query,
        chunks: result.chunks,
        strategy: result.strategy,
        indexed: result.hasEmbeddingIndex,
        embeddingProvider: result.embeddingProvider,
        candidateCount: result.candidateCount,
        warnings: result.warnings,
        fileCount: snapshot.files.length,
      });
    },
  );
}
