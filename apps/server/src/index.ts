import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import type { Account, AccessContext } from "@ariadne/shared";
import { PORTS } from "@ariadne/shared";
import logger from "./logger.js";
import { ensureDirs, PATHS, getActiveSettings } from "./config.js";
import { openDb, getDb } from "./db/index.js";
import { dbGetSetting, dbSetSetting } from "./db/repo.js";
import { healthRoutes } from "./routes/health.js";
import { CORE_ROUTES, PUBLIC_ROUTES } from "./routes/registry.js";
import { registerProjectRoutes, projectTemplates } from "./projects/index.js";
import { registerProjectTemplates } from "./runs/templates.js";
import { shutdownAll as shutdownMcp } from "./services/mcpClient.js";
import { detectMarkitdown } from "./services/markitdown.js";
import { detectLibreoffice } from "./services/libreoffice.js";
import { detectPyMuPDF } from "./services/pymupdf.js";
import { startScheduler } from "./services/scheduler.js";
import { seedAdmin, seedGuest } from "./auth/accounts.js";
import { ensureTutorialWorkspace } from "./tutorialWorkspace.js";
import { ensureDemoWorkspace } from "./demoWorkspace.js";
import { validateSession } from "./auth/sessions.js";
import { accessContext } from "./auth/context.js";

// ---------------------------------------------------------------------------
// Extend Fastify request type
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    account: Account;
    accessContext: AccessContext;
    /** Session token (cookie) — present on remote/cookie auth; scopes shared-
     *  account (guest) chats per session. Undefined for local/admin. */
    sessionId?: string;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const WEB_DIST = path.join(REPO_ROOT, "apps", "web", "dist");

const COOKIE_NAME = "ariadne_session";

// ---------------------------------------------------------------------------
// Find the first admin account (used for local-bypass)
// ---------------------------------------------------------------------------

function findAdminAccount(): Account | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM accounts WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row["id"] as string,
    username: row["username"] as string,
    displayName: row["display_name"] as string,
    role: row["role"] as string,
    locale: (row["locale"] as string | null) ?? "en",
    mode: ((row["mode"] as string | null) ?? "standard") as import("@ariadne/shared").AccountMode,
    createdAt: row["created_at"] as string,
    context: (row["context"] as string | null) ?? "",
    contextUpdatedAt: (row["context_updated_at"] as string | null) ?? null,
  };
}

async function bootstrap(): Promise<void> {
  // Ensure runtime directories and open the database
  ensureDirs();
  openDb(PATHS.db);

  // Seed the admin account + the built-in tutorial and demo workspaces
  seedAdmin();
  seedGuest();
  ensureTutorialWorkspace();
  await ensureDemoWorkspace();

  // Retrieve or generate cookie signing secret
  let cookieSecret = dbGetSetting("cookie_secret");
  if (!cookieSecret) {
    cookieSecret = randomBytes(32).toString("hex");
    dbSetSetting("cookie_secret", cookieSecret);
    logger.info("Generated new cookie signing secret");
  }

  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 /* 30 MB */ });

  // Register cookie plugin with signing secret
  await app.register(fastifyCookie, {
    secret: cookieSecret,
    parseOptions: {},
  });

  // WebSocket support (the workspace terminal). Registered on the root app so
  // the /api child scope inherits it; the terminal route itself is local-only.
  await app.register(fastifyWebsocket);

  // --- Health (outside /api prefix) ---
  await app.register(healthRoutes);

  // --- API routes ---
  await app.register(
    async (api) => {
      // Auth hook: protect all /api/* except login / logout / reset.
      // `/auth/reset` is the self-heal path users hit when their cookie
      // is broken — it MUST be reachable without a valid cookie.
      api.addHook("onRequest", async (req, reply) => {
        const url = req.url;
        const isAuthOpen =
          url === "/api/auth/login" || url === "/api/auth/logout" || url === "/api/auth/reset" ||
          url === "/api/auth/guest" ||
          url.endsWith("/auth/login") || url.endsWith("/auth/logout") || url.endsWith("/auth/reset") ||
          url.endsWith("/auth/guest");
        // Webhook fire (POST /api/triggers/:secret) authenticates by its secret,
        // not a cookie — let it through the gate. The pattern is START-ANCHORED
        // so it matches ONLY /api/triggers/<secret> and can NOT match nested
        // routes such as /workspaces/:id/actions/triggers/run or
        // /scripts/triggers/run (those must stay behind auth — an unanchored
        // /triggers/ match was an auth-bypass, caught in review). Management
        // routes (POST /workspaces/:id/triggers, DELETE /triggers/:id) also stay
        // protected: the former has no trailing segment, the latter isn't POST.
        const firePath = url.split("?")[0] ?? url;
        const isTriggerFire =
          req.method === "POST" && /^\/(?:api\/)?triggers\/[^/]+$/.test(firePath);
        if (isAuthOpen || isTriggerFire) return;

        const ctx = accessContext(req);
        req.accessContext = ctx;

        if (ctx === "local") {
          // Local access: resolve identity as the seeded admin (no login needed)
          const admin = findAdminAccount();
          if (!admin) {
            return reply.status(503).send({ error: "Server not yet initialised" });
          }
          req.account = admin;
          return;
        }

        // Remote: require a valid session cookie. If the cookie is
        // present but bad (signature fail, missing session row), clear
        // it on the way out — otherwise the browser keeps presenting
        // the same broken cookie forever and the user is stuck in a
        // 401 loop. The recovery path on the FE only needs one good
        // 401-without-stuck-cookie response to render LoginView cleanly.
        const rawCookie = req.cookies[COOKIE_NAME] ?? "";
        if (!rawCookie) {
          return reply.status(401).send({ error: "Authentication required" });
        }
        const unsigned = req.unsignCookie(rawCookie);
        if (!unsigned.valid || !unsigned.value) {
          void reply.clearCookie(COOKIE_NAME, { path: "/" });
          return reply.status(401).send({ error: "Authentication required" });
        }

        const account = validateSession(unsigned.value);
        if (!account) {
          void reply.clearCookie(COOKIE_NAME, { path: "/" });
          return reply.status(401).send({ error: "Authentication required" });
        }

        req.account = account;
        // Per-session scoping for shared-account (guest) chats — the cookie
        // token uniquely identifies this browser session.
        req.sessionId = unsigned.value;
      });

      // Register every core API route from the registry — index.ts no longer
      // names them one by one. Add a route by writing routes/<domain>.ts and
      // appending ONE entry to CORE_ROUTES (see routes/registry.ts).
      for (const m of CORE_ROUTES) await api.register(m.register);

      // Example projects (projects/<name>/) contribute run templates + routes
      // through the project registry — generic, no vertical named here.
      registerProjectTemplates(projectTemplates());
      await registerProjectRoutes(api);
    },
    { prefix: "/api" }
  );

  // Unauthenticated routes — OUTSIDE the /api auth scope (e.g. the sandboxed
  // surface-host shell). Registered from the registry; add one by appending to
  // PUBLIC_ROUTES. Must run before the SPA static fallback below.
  for (const m of PUBLIC_ROUTES) await app.register(m.register);

  // --- SPA / static files ---
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: non-/api GET requests → index.html.
    //
    // 404 cases that must NOT fall through to index.html:
    //   /api/*       — JSON 404 (existing)
    //   /assets/*    — hashed static. If missing, the client is
    //                  asking for a stale build. Returning HTML here
    //                  causes "Failed to load module script: …MIME
    //                  type of 'text/html'" because the browser tries
    //                  to parse the SPA shell as a JS module. Return
    //                  404 so the browser drops cached index.html and
    //                  refetches.
    //   *.js/.css/etc — same reasoning as /assets/*.
    app.setNotFoundHandler(async (req, reply) => {
      const url = req.url;
      if (url.startsWith("/api")) {
        return reply.status(404).send({ error: "Not found" });
      }
      // Static-asset extension or /assets/ path → 404, don't fall back.
      if (url.startsWith("/assets/") || /\.(js|css|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico|json|wasm)(\?|$)/i.test(url)) {
        return reply.status(404).send({ error: "Not found" });
      }
      // True SPA route → serve the shell. Mark no-cache so stale
      // hash-references don't outlive a build.
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return reply.sendFile("index.html");
    });
  } else {
    // No web build — serve a tiny inline placeholder so the server still starts
    const placeholder = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Ariadne</title></head>
<body style="font-family:sans-serif;padding:2rem">
  <h1>Ariadne</h1>
  <p>Server is running. The web UI has not been built yet.</p>
  <p>Run <code>npm run build:web</code> from the repo root, then restart the server.</p>
  <p><a href="/healthz">/healthz</a></p>
</body>
</html>`;

    app.get("/", async (_req, reply) => {
      return reply.type("text/html").send(placeholder);
    });

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.type("text/html").send(placeholder);
    });
  }

  const settings = getActiveSettings();

  // Bind to loopback by default — reachable only from this machine and the
  // local cloudflared tunnel. Opt into LAN/all-interfaces exposure with
  // ARIADNE_BIND=0.0.0.0. The socket-based local-admin check in auth/context
  // means a 0.0.0.0 bind no longer auto-admins anything sending Host: localhost.
  const bindHost = process.env["ARIADNE_BIND"] ?? "127.0.0.1";
  await app.listen({ port: PORTS.server, host: bindHost });
  if (!["127.0.0.1", "localhost", "::1"].includes(bindHost)) {
    logger.warn(
      { bindHost },
      "Bound to a non-loopback interface — the port is reachable from the network; remote clients still require login",
    );
  }

  // AW/AY/AZ — probe for external file-handling binaries once at boot.
  // Cached for the process lifetime; routes gate on the result. Awaited
  // but non-fatal — missing tools should not block the server from
  // starting. Probes run in parallel since they're independent.
  await Promise.all([detectMarkitdown(), detectLibreoffice(), detectPyMuPDF()]);

  // Start the in-process action scheduler — ticks every 60s, fires
  // recurring action runs declared in the action_schedules table.
  startScheduler();

  // Tear down MCP child processes on supervisor stop so we don't
  // leak `npx @modelcontextprotocol/server-*` workers across restarts.
  const shutdownHandler = (): void => {
    void shutdownMcp().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdownHandler);
  process.once("SIGINT", shutdownHandler);

  logger.info(
    {
      url: `http://${bindHost}:${PORTS.server.toString()}`,
      provider: settings.provider,
      model: settings.model,
      webDist: fs.existsSync(WEB_DIST) ? WEB_DIST : "(not built)",
    },
    "Ariadne server started"
  );
}

bootstrap().catch((err) => {
  logger.error(err, "Fatal startup error");
  process.exit(1);
});
