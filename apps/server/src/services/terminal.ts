/**
 * Workspace terminal (P3 IDE #7) — a PTY running the user's shell in the
 * workspace root, bridged to a browser xterm.js over a WebSocket.
 *
 * LOCAL-ONLY: a real shell is far too powerful to expose to remote/public
 * access, so the route gates on `accessContext === "local"` before this runs.
 *
 * node-pty ships prebuilt binaries, but its `spawn-helper` loses the executable
 * bit during npm extraction (→ "posix_spawnp failed"), so we chmod it once
 * before the first spawn.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import logger from "../logger.js";

const nodeRequire = createRequire(import.meta.url);

/** Minimal shape of the ws socket we use (avoids a hard type dep on ws). */
interface TerminalSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message" | "close" | "error", cb: (arg: Buffer) => void): void;
}

let helperFixed = false;
function ensureSpawnHelperExecutable(): void {
  if (helperFixed) return;
  helperFixed = true;
  try {
    const pkgDir = path.dirname(nodeRequire.resolve("node-pty/package.json"));
    const prebuilds = path.join(pkgDir, "prebuilds");
    if (!fs.existsSync(prebuilds)) return;
    for (const dir of fs.readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, dir, "spawn-helper");
      try {
        if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
      } catch {
        /* best-effort per arch */
      }
    }
  } catch {
    /* node-pty unresolvable — attachTerminal's own require will surface it */
  }
}

function resolveShell(): string {
  return process.env["SHELL"] || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = { TERM: "xterm-256color" };
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  return env;
}

/**
 * Bridge a PTY in `rootPath` to a WebSocket.
 *   server → client: raw pty output (text frames)
 *   client → server: JSON { type:"input", data } | { type:"resize", cols, rows }
 */
export function attachTerminal(socket: TerminalSocket, rootPath: string): void {
  ensureSpawnHelperExecutable();

  let pty: typeof import("node-pty");
  try {
    pty = nodeRequire("node-pty") as typeof import("node-pty");
  } catch (err) {
    logger.warn({ err: String(err) }, "node-pty load failed — terminal disabled");
    try {
      socket.send("\r\n[terminal unavailable: node-pty failed to load]\r\n");
      socket.close();
    } catch {
      /* socket already gone */
    }
    return;
  }

  const term = pty.spawn(resolveShell(), [], {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: rootPath,
    env: cleanEnv(),
  });

  const onData = term.onData((data) => {
    if (socket.readyState === 1 /* OPEN */) {
      try {
        socket.send(data);
      } catch {
        /* drop on a closing socket */
      }
    }
  });
  const onExit = term.onExit(() => {
    try {
      socket.close();
    } catch {
      /* */
    }
  });

  socket.on("message", (raw: Buffer) => {
    let msg: { type?: string; data?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
      try {
        term.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
      } catch {
        /* ignore bad sizes */
      }
    }
  });

  const cleanup = () => {
    onData.dispose();
    onExit.dispose();
    try {
      term.kill();
    } catch {
      /* already exited */
    }
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}
