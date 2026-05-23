import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import type { Account, AccessContext } from "@ariadne/shared";
import { PORTS } from "@ariadne/shared";
import logger from "./logger.js";
import { ensureDirs, PATHS, getActiveSettings } from "./config.js";
import { openDb, getDb } from "./db/index.js";
import { dbGetSetting, dbSetSetting } from "./db/repo.js";
import { healthRoutes } from "./routes/health.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { templateRoutes } from "./routes/templates.js";
import { runRoutes } from "./routes/runs.js";
import { settingsRoutes } from "./routes/settings.js";
import { fsRoutes } from "./routes/fs.js";
import { authRoutes } from "./routes/auth.js";
import { usageRoutes } from "./routes/usage.js";
import { scriptRoutes } from "./routes/scripts.js";
import { searchRoutes } from "./routes/search.js";
import { chatRoutes } from "./routes/chat.js";
import { providerRoutes } from "./routes/providers.js";
import { accountRoutes } from "./routes/account.js";
import { surfaceRoutes } from "./routes/surface.js";
import { surfaceHostRoutes } from "./routes/surfaceHost.js";
import { actionRoutes } from "./routes/actions.js";
import { reportRoutes } from "./routes/reports.js";
import { marketDataRoutes } from "./routes/marketData.js";
import { skillRoutes } from "./routes/skills.js";
import { seedAdmin } from "./auth/accounts.js";
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

  // --- Health (outside /api prefix) ---
  await app.register(healthRoutes);

  // --- API routes ---
  await app.register(
    async (api) => {
      // Auth hook: protect all /api/* except login and logout
      api.addHook("onRequest", async (req, reply) => {
        const url = req.url;
        const isLoginOrLogout =
          url === "/api/auth/login" || url === "/api/auth/logout" ||
          url.endsWith("/auth/login") || url.endsWith("/auth/logout");
        if (isLoginOrLogout) return;

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

        // Remote: require a valid session cookie
        const rawCookie = req.cookies[COOKIE_NAME] ?? "";
        const unsigned = req.unsignCookie(rawCookie);
        if (!unsigned.valid || !unsigned.value) {
          return reply.status(401).send({ error: "Authentication required" });
        }

        const account = validateSession(unsigned.value);
        if (!account) {
          return reply.status(401).send({ error: "Authentication required" });
        }

        req.account = account;
      });

      await api.register(authRoutes);
      await api.register(workspaceRoutes);
      await api.register(templateRoutes);
      await api.register(runRoutes);
      await api.register(settingsRoutes);
      await api.register(fsRoutes);
      await api.register(usageRoutes);
      await api.register(scriptRoutes);
      await api.register(searchRoutes);
      await api.register(chatRoutes);
      await api.register(providerRoutes);
      await api.register(accountRoutes);
      await api.register(surfaceRoutes);
      await api.register(actionRoutes);
      await api.register(reportRoutes);
      await api.register(marketDataRoutes);
      await api.register(skillRoutes);
    },
    { prefix: "/api" }
  );

  // Surface host routes — OUTSIDE /api (unauthenticated, sandboxed iframe shell)
  await app.register(surfaceHostRoutes);

  // --- SPA / static files ---
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: non-/api GET requests → index.html
    app.setNotFoundHandler(async (req, reply) => {
      if (!req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: "Not found" });
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

  await app.listen({ port: PORTS.server, host: "0.0.0.0" });

  logger.info(
    {
      url: `http://0.0.0.0:${PORTS.server.toString()}`,
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
