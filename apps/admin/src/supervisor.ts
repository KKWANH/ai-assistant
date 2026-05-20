/**
 * Ariadne supervisor — entrypoint.
 *
 * Usage (from repo root):
 *   tsx apps/admin/src/supervisor.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS, resolvePaths } from "@ariadne/shared";
import { rotateLogs } from "./logManager.js";
import { ProcessManager } from "./processManager.js";
import { startDashboard } from "./dashboard.js";

const __filename = fileURLToPath(import.meta.url);
// apps/admin/src/<file> → repo root is three directories up. The control
// script exports ARIADNE_ROOT; prefer it when present.
const repoRoot =
  process.env.ARIADNE_ROOT ?? path.resolve(path.dirname(__filename), "..", "..", "..");
const paths = resolvePaths(repoRoot);

const supervisorStart = new Date();

// ── 1. Rotate logs ─────────────────────────────────────────────────────────

rotateLogs(paths.logs, paths.archive);

function supervisorLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(path.join(paths.logs, "supervisor.log"), line);
}

supervisorLog(`Ariadne supervisor starting (PID ${process.pid})`);

// ── 2. Write PID file ──────────────────────────────────────────────────────

fs.mkdirSync(paths.run, { recursive: true });
const pidFile = path.join(paths.run, "supervisor.pid");
fs.writeFileSync(pidFile, String(process.pid) + "\n");
supervisorLog(`PID file: ${pidFile}`);

// ── 3. Start children ──────────────────────────────────────────────────────

const pm = new ProcessManager({
  repoRoot,
  logsDir: paths.logs,
  runDir: paths.run,
  serverPort: PORTS.server,
  onLog: (name, line) => {
    // Forward child log lines to supervisor stdout so nohup captures them
    process.stdout.write(`[${name}] ${line}\n`);
  },
  onTunnelUrl: (url) => {
    supervisorLog(`Cloudflare tunnel active: ${url}`);
  },
});

pm.startAll();
supervisorLog("Children started");

// ── 4. Start admin dashboard ───────────────────────────────────────────────

startDashboard({
  port: PORTS.admin,
  logsDir: paths.logs,
  runDir: paths.run,
  supervisorStartTime: supervisorStart,
  pm,
});
supervisorLog(`Admin dashboard bound to 127.0.0.1:${PORTS.admin}`);

// ── 5. Signal handlers ─────────────────────────────────────────────────────

function shutdown(signal: string): void {
  supervisorLog(`Received ${signal} — shutting down`);
  pm.stopAll();
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // ignore if already gone
  }
  supervisorLog("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

supervisorLog("Ready — trap SIGTERM/SIGINT to stop");
