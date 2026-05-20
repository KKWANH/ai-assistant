import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LogName } from "./logManager.js";
import type { ProcessManager } from "./processManager.js";
import { tailLog } from "./logManager.js";
import { analyzeErrors } from "./errorAnalyzer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function badRequest(res: http.ServerResponse, msg: string): void {
  json(res, 400, { error: msg });
}

function serveFile(
  res: http.ServerResponse,
  filePath: string,
  contentType: string
): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export interface DashboardOptions {
  port: number;
  logsDir: string;
  runDir: string;
  supervisorStartTime: Date;
  pm: ProcessManager;
}

export function startDashboard(opts: DashboardOptions): http.Server {
  const { port, logsDir, runDir, supervisorStartTime, pm } = opts;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // ── Static files ─────────────────────────────────────────────────────
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      serveFile(res, path.join(PUBLIC_DIR, "index.html"), MIME[".html"]!);
      return;
    }
    if (method === "GET" && pathname === "/dashboard.js") {
      serveFile(res, path.join(PUBLIC_DIR, "dashboard.js"), MIME[".js"]!);
      return;
    }
    if (method === "GET" && pathname === "/style.css") {
      serveFile(res, path.join(PUBLIC_DIR, "style.css"), MIME[".css"]!);
      return;
    }

    // ── JSON API ─────────────────────────────────────────────────────────

    if (method === "GET" && pathname === "/api/status") {
      const tunnelUrlFile = path.join(runDir, "tunnel-url.txt");
      const tunnelUrl = pm.tunnelUrl ??
        (fs.existsSync(tunnelUrlFile)
          ? fs.readFileSync(tunnelUrlFile, "utf8").trim()
          : null);

      const children = pm.getAllStates().map((s) => ({
        name: s.name,
        pid: s.pid ?? null,
        running: s.running,
        restartCount: s.restartCount,
        lastExitCode: s.lastExitCode,
        lastRestartTime: s.lastRestartTime?.toISOString() ?? null,
        startTime: s.startTime?.toISOString() ?? null,
        uptime: s.startTime
          ? Math.floor((Date.now() - s.startTime.getTime()) / 1000)
          : null,
      }));

      json(res, 200, {
        supervisorUptime: Math.floor(
          (Date.now() - supervisorStartTime.getTime()) / 1000
        ),
        supervisorStartTime: supervisorStartTime.toISOString(),
        tunnelUrl,
        children,
      });
      return;
    }

    if (method === "GET" && pathname === "/api/logs") {
      const name = url.searchParams.get("name") as LogName | null;
      const linesParam = url.searchParams.get("lines");
      const lines = linesParam ? parseInt(linesParam, 10) : 100;
      if (!name || !["server", "tunnel", "supervisor"].includes(name)) {
        badRequest(res, "name must be server | tunnel | supervisor");
        return;
      }
      if (isNaN(lines) || lines < 1 || lines > 2000) {
        badRequest(res, "lines must be 1–2000");
        return;
      }
      json(res, 200, { name, lines: tailLog(logsDir, name, lines) });
      return;
    }

    if (method === "GET" && pathname === "/api/errors") {
      json(res, 200, analyzeErrors(logsDir));
      return;
    }

    if (method === "POST" && pathname === "/api/restart") {
      const name = url.searchParams.get("name") as "server" | "tunnel" | null;
      if (!name || !["server", "tunnel"].includes(name)) {
        badRequest(res, "name must be server | tunnel");
        return;
      }
      pm.restart(name);
      json(res, 200, { ok: true, name });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // Bind to loopback ONLY — never 0.0.0.0
  server.listen(port, "127.0.0.1", () => {
    console.log(`Admin dashboard: http://127.0.0.1:${port}`);
  });

  return server;
}
