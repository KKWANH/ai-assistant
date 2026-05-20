import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { LogName } from "./logManager.js";

export interface ChildState {
  name: string;
  pid: number | undefined;
  running: boolean;
  restartCount: number;
  lastExitCode: number | null;
  lastRestartTime: Date | null;
  startTime: Date | null;
}

export interface ManagerOptions {
  repoRoot: string;
  logsDir: string;
  runDir: string;
  serverPort: number;
  onLog?: (name: LogName, line: string) => void;
  onTunnelUrl?: (url: string) => void;
}

const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function backoff(restartCount: number): number {
  const ms = MIN_BACKOFF_MS * Math.pow(2, restartCount - 1);
  return Math.min(ms, MAX_BACKOFF_MS);
}

export class ProcessManager {
  private opts: ManagerOptions;
  private states: Map<string, ChildState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private backoffTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthFailCount = 0;
  private stopped = false;
  tunnelUrl: string | null = null;

  constructor(opts: ManagerOptions) {
    this.opts = opts;
    this.states.set("server", {
      name: "server",
      pid: undefined,
      running: false,
      restartCount: 0,
      lastExitCode: null,
      lastRestartTime: null,
      startTime: null,
    });
    this.states.set("tunnel", {
      name: "tunnel",
      pid: undefined,
      running: false,
      restartCount: 0,
      lastExitCode: null,
      lastRestartTime: null,
      startTime: null,
    });
  }

  getState(name: string): ChildState | undefined {
    return this.states.get(name);
  }

  getAllStates(): ChildState[] {
    return Array.from(this.states.values());
  }

  startAll(): void {
    this.spawnServer(false);
    // Give the server a moment to bind before starting the tunnel
    setTimeout(() => {
      if (!this.stopped) this.spawnTunnel(false);
    }, 1500);
    this.startHealthLoop();
  }

  private openLogStream(name: LogName): fs.WriteStream {
    const p = path.join(this.opts.logsDir, `${name}.log`);
    // Append mode — log was already rotated / created fresh by logManager
    return fs.createWriteStream(p, { flags: "a" });
  }

  private writeSupervisorLog(msg: string): void {
    const p = path.join(this.opts.logsDir, "supervisor.log");
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(p, line);
    this.opts.onLog?.("supervisor", line.trimEnd());
  }

  // ── Server ────────────────────────────────────────────────────────────────

  private spawnServer(isRestart: boolean): void {
    if (this.stopped) return;
    const state = this.states.get("server")!;
    if (isRestart) {
      state.restartCount++;
      state.lastRestartTime = new Date();
    }

    const tsxBin = path.join(this.opts.repoRoot, "node_modules", ".bin", "tsx");
    const serverEntry = path.join(this.opts.repoRoot, "apps", "server", "src", "index.ts");

    this.writeSupervisorLog(
      `Spawning server (restart #${state.restartCount}): ${tsxBin} ${serverEntry}`
    );

    const logStream = this.openLogStream("server");
    const child = spawn(tsxBin, [serverEntry], {
      cwd: this.opts.repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.pid = child.pid;
    state.running = true;
    state.startTime = new Date();
    this.processes.set("server", child);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      logStream.write(text);
      for (const line of text.split("\n")) {
        if (line.trim()) this.opts.onLog?.("server", line);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      logStream.write(text);
      for (const line of text.split("\n")) {
        if (line.trim()) this.opts.onLog?.("server", line);
      }
    });

    child.on("close", (code) => {
      state.running = false;
      state.lastExitCode = code;
      state.pid = undefined;
      logStream.end();
      this.writeSupervisorLog(`Server exited with code ${code}`);
      if (!this.stopped) {
        const delay = backoff(state.restartCount + 1);
        this.writeSupervisorLog(`Restarting server in ${delay}ms`);
        const t = setTimeout(() => {
          this.backoffTimers.delete("server");
          this.spawnServer(true);
        }, delay);
        this.backoffTimers.set("server", t);
      }
    });

    child.on("error", (err) => {
      // A spawn failure (e.g. tsx missing) emits 'error' but not 'close'.
      // Without this handler the supervisor itself would crash.
      this.writeSupervisorLog(`Server process error: ${err.message}`);
      if (
        state.running &&
        state.pid === undefined &&
        !this.stopped &&
        !this.backoffTimers.has("server")
      ) {
        state.running = false;
        logStream.end();
        const delay = backoff(state.restartCount + 1);
        this.writeSupervisorLog(`Restarting server in ${delay}ms`);
        const t = setTimeout(() => {
          this.backoffTimers.delete("server");
          this.spawnServer(true);
        }, delay);
        this.backoffTimers.set("server", t);
      }
    });
  }

  // ── Tunnel ────────────────────────────────────────────────────────────────

  private spawnTunnel(isRestart: boolean): void {
    if (this.stopped) return;
    const state = this.states.get("tunnel")!;
    if (isRestart) {
      state.restartCount++;
      state.lastRestartTime = new Date();
      this.tunnelUrl = null;
    }

    // A named tunnel (configured via ops/setup-tunnel.sh) serves a stable
    // custom domain; otherwise fall back to an ephemeral quick tunnel.
    const tunnelName = process.env.ARIADNE_TUNNEL_NAME?.trim();
    const tunnelHostname = process.env.ARIADNE_TUNNEL_HOSTNAME?.trim();
    const named = Boolean(tunnelName && tunnelHostname);
    const localUrl = `http://localhost:${this.opts.serverPort}`;

    this.writeSupervisorLog(
      `Spawning cloudflared ${
        named ? `named tunnel "${tunnelName ?? ""}" → ${tunnelHostname ?? ""}` : "quick tunnel"
      } (restart #${state.restartCount})`
    );

    const logStream = this.openLogStream("tunnel");
    const child = spawn(
      "cloudflared",
      named
        ? ["tunnel", "run", "--url", localUrl, tunnelName ?? ""]
        : ["tunnel", "--url", localUrl],
      {
        cwd: this.opts.repoRoot,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    state.pid = child.pid;
    state.running = true;
    state.startTime = new Date();
    this.processes.set("tunnel", child);

    // A named tunnel has a known, stable URL — publish it immediately
    // (cloudflared does not print one for named tunnels).
    if (named && !this.tunnelUrl) {
      this.tunnelUrl = `https://${tunnelHostname ?? ""}`;
      this.writeSupervisorLog(`Tunnel URL: ${this.tunnelUrl}`);
      this.opts.onTunnelUrl?.(this.tunnelUrl);
      fs.mkdirSync(this.opts.runDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.opts.runDir, "tunnel-url.txt"),
        this.tunnelUrl + "\n"
      );
    }

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      logStream.write(text);
      for (const line of text.split("\n")) {
        if (line.trim()) this.opts.onLog?.("tunnel", line);
        // Parse the trycloudflare.com URL
        const m = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (m && !this.tunnelUrl) {
          this.tunnelUrl = m[0];
          this.writeSupervisorLog(`Tunnel URL: ${this.tunnelUrl}`);
          this.opts.onTunnelUrl?.(this.tunnelUrl);
          // Persist for the control script
          fs.mkdirSync(this.opts.runDir, { recursive: true });
          fs.writeFileSync(
            path.join(this.opts.runDir, "tunnel-url.txt"),
            this.tunnelUrl + "\n"
          );
        }
      }
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    child.on("close", (code) => {
      state.running = false;
      state.lastExitCode = code;
      state.pid = undefined;
      logStream.end();
      this.writeSupervisorLog(`cloudflared exited with code ${code}`);
      if (!this.stopped) {
        const delay = backoff(state.restartCount + 1);
        this.writeSupervisorLog(`Restarting cloudflared in ${delay}ms`);
        const t = setTimeout(() => {
          this.backoffTimers.delete("tunnel");
          this.spawnTunnel(true);
        }, delay);
        this.backoffTimers.set("tunnel", t);
      }
    });

    child.on("error", (err) => {
      // cloudflared not installed / not on PATH emits 'error', not 'close'.
      this.writeSupervisorLog(`cloudflared process error: ${err.message}`);
      if (
        state.running &&
        state.pid === undefined &&
        !this.stopped &&
        !this.backoffTimers.has("tunnel")
      ) {
        state.running = false;
        logStream.end();
        const delay = backoff(state.restartCount + 1);
        this.writeSupervisorLog(`Restarting cloudflared in ${delay}ms`);
        const t = setTimeout(() => {
          this.backoffTimers.delete("tunnel");
          this.spawnTunnel(true);
        }, delay);
        this.backoffTimers.set("tunnel", t);
      }
    });
  }

  // ── Health poll ───────────────────────────────────────────────────────────

  private startHealthLoop(): void {
    this.healthTimer = setInterval(() => {
      this.checkServerHealth();
    }, 5_000);
  }

  private checkServerHealth(): void {
    const req = http.get(
      `http://localhost:${this.opts.serverPort}/healthz`,
      { timeout: 4_000 },
      (res) => {
        if (res.statusCode === 200) {
          this.healthFailCount = 0;
        } else {
          this.onHealthFail();
        }
        // Drain response
        res.resume();
      }
    );
    req.on("error", () => this.onHealthFail());
    req.on("timeout", () => {
      req.destroy();
      this.onHealthFail();
    });
  }

  private onHealthFail(): void {
    this.healthFailCount++;
    this.writeSupervisorLog(
      `Server health check failed (consecutive: ${this.healthFailCount})`
    );
    if (this.healthFailCount >= 3) {
      this.healthFailCount = 0;
      const state = this.states.get("server")!;
      if (state.running) {
        this.writeSupervisorLog("Killing server after 3 consecutive health failures");
        this.processes.get("server")?.kill("SIGTERM");
        // The 'close' handler will reschedule the restart
      }
    }
  }

  // ── Manual restart ────────────────────────────────────────────────────────

  restart(name: "server" | "tunnel"): void {
    const child = this.processes.get(name);
    const timer = this.backoffTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.backoffTimers.delete(name);
    }
    if (child && !child.killed) {
      // The close handler will fire and schedule the re-spawn
      child.kill("SIGTERM");
    } else {
      // Process is already gone — restart immediately
      if (name === "server") this.spawnServer(true);
      else this.spawnTunnel(true);
    }
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────

  stopAll(): void {
    this.stopped = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    for (const t of this.backoffTimers.values()) clearTimeout(t);
    this.backoffTimers.clear();
    for (const child of this.processes.values()) {
      if (!child.killed) child.kill("SIGTERM");
    }
    this.writeSupervisorLog("All children signalled with SIGTERM");
  }
}
