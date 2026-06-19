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
  dbGetWorkspaceUsage,
} from "../db/repo.js";
import { scanWorkspace } from "../workspace/scanner.js";
import { ensureAriadneFolder, writeSurface } from "../ariadneFolder.js";
import { fireHooksDetached } from "../services/hooks.js";
import { buildSurface } from "../services/surfaceBuild.js";
import { exportWorkspaceTemplate } from "../services/workspaceTemplate.js";
import { retrieveWithMeta } from "../services/retrieval.js";
import { getWorkspaceContext, setWorkspaceContext } from "../services/workspaceContext.js";
import * as portfolioStarter from "../surface/portfolioStarter.js";
import { seedPortfolioV2Surface } from "../surface/portfolioV2Template.js";
import type { ProjectStarter } from "@ariadne/shared";
import { projectStarters } from "../projects/index.js";
import logger from "../logger.js";
import { canViewWorkspace, requireWorkspace, rejectRemoteAccess, rejectGuest } from "./workspaceGuard.js";

/**
 * The full starter set for the create flow. The example projects come from
 * the registry (`projects/<name>/`); portfolio still lives in core because a
 * dedicated session owns it (see projects/README.md — Phase 3 moves it). Each
 * entry is a ProjectStarter: files + surface (+ actions) scaffolded into the
 * new workspace, and a category that scopes its templates.
 */
const STARTERS: Record<string, ProjectStarter> = {
  ...projectStarters(),
  portfolio: {
    id: "portfolio",
    category: "finance",
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
    if (await rejectGuest(req, reply)) return;
    // A workspace's rootPath can point anywhere on the host, and its owner can
    // then read every file beneath it (GET .../file, snapshot, RAG, …). Choosing
    // that root is a privileged host-level action, so creation is restricted to
    // admins or local (loopback) sessions. Without this, a remote non-admin
    // could root a workspace at "/" and turn it into an arbitrary host-file read.
    if (req.accessContext === "remote" && req.account?.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        detail: "Creating a workspace must be done from the local app or by an admin.",
      });
    }
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

    // Category scopes which templates the workspace surfaces — taken from the
    // starter's own definition (a registry project, or core portfolio).
    const category =
      !starter || starter === "blank" ? null : STARTERS[starter]?.category ?? null;

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
      homeView: null,
      defaultProvider: null,
      defaultModel: null,
      defaultSkillId: null,
    };

    dbInsertWorkspace(workspace);
    ensureAriadneFolder(rootPath);

    // Scaffold a starter template if requested (best-effort; failures are non-fatal)
    const starterDef = starter && starter !== "blank" ? STARTERS[starter] : undefined;
    if (starterDef) {
      try {
        for (const [filename, content] of Object.entries(starterDef.files ?? {})) {
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
        } else if (starterDef.surface) {
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

  // Token usage attributed to this workspace (its chats + runs), same shape as
  // the global GET /usage.
  app.get<{ Params: { id: string } }>("/workspaces/:id/usage", async (req, reply) => {
    const ws = await requireWorkspace(req.params.id, req, reply, "read");
    if (!ws) return;
    return reply.send(dbGetWorkspaceUsage(ws.id));
  });

  // GET/PUT the project context — user-authored standing instructions for the
  // workspace (`.ariadne/context.md`), injected into every chat + generation.
  app.get<{ Params: { id: string } }>("/workspaces/:id/context", async (req, reply) => {
    const ws = await requireWorkspace(req.params.id, req, reply, "read");
    if (!ws) return;
    return reply.send({ context: getWorkspaceContext(ws.rootPath) });
  });
  app.put<{ Params: { id: string }; Body: { context?: string } }>(
    "/workspaces/:id/context",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      try {
        setWorkspaceContext(ws.rootPath, req.body?.context ?? "");
        return reply.send({ ok: true as const });
      } catch (err) {
        return reply.status(400).send({ error: "Could not save context", detail: String(err) });
      }
    },
  );

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

    // Wipe transient staged trees on disk before the row (and rootPath) are gone.
    const { clearAllStaged } = await import("../services/stagedEdits.js");
    clearAllStaged(req.params.id);
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
