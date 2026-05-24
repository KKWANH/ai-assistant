/**
 * Script execution routes.
 *
 * Security model (PRODUCT_PLAN §12 approved exception):
 *   local  → list, read, create/edit, run
 *   remote → list, run only — create/edit return 403
 *
 * Scripts live exclusively in <workspaceRoot>/.ariadne/scripts/ and must
 * have a .sh or .py extension. Names are validated against
 * /^[a-zA-Z0-9_\-]+\.(sh|py)$/ before use.
 */

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { ensureAriadneFolder, scriptsDir, writeScript } from "../ariadneFolder.js";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";
import { scriptEnv } from "../services/scriptEnv.js";

const SCRIPT_NAME_RE = /^[a-zA-Z0-9_\-]+\.(sh|py)$/;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB output cap
const TIMEOUT_MS = 30_000; // 30 seconds

function isSafeScriptName(name: string): boolean {
  return SCRIPT_NAME_RE.test(name) && !name.includes("/") && !name.includes("..");
}

function getRunner(name: string): { cmd: string; args: string[] } | null {
  if (name.endsWith(".sh")) return { cmd: "/bin/bash", args: [] };
  if (name.endsWith(".py")) return { cmd: "python3", args: [] };
  return null;
}

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces/:id/scripts
  app.get<{ Params: { id: string } }>("/workspaces/:id/scripts", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const dir = scriptsDir(workspace.rootPath);

    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".sh") || n.endsWith(".py"));
    } catch {
      names = [];
    }

    return reply.send(names.map((name) => ({ name })));
  });

  // GET /api/workspaces/:id/scripts/:name
  app.get<{ Params: { id: string; name: string } }>("/workspaces/:id/scripts/:name", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;

    const { name } = req.params;
    if (!isSafeScriptName(name)) {
      return reply.status(400).send({ error: "Invalid script name" });
    }

    const filePath = path.join(scriptsDir(workspace.rootPath), name);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "Script not found" });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return reply.send({ name, content });
  });

  // PUT /api/workspaces/:id/scripts/:name — LOCAL only
  app.put<{ Params: { id: string; name: string }; Body: { content: string } }>(
    "/workspaces/:id/scripts/:name",
    async (req, reply) => {
      // Access gating: remote users cannot create or edit scripts
      if (
        await rejectRemoteAccess(
          "Creating or editing scripts is not permitted from remote access. Connect locally to manage scripts.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const { name } = req.params;
      if (!isSafeScriptName(name)) {
        return reply.status(400).send({ error: "Invalid script name — must match [a-zA-Z0-9_-]+.(sh|py)" });
      }

      const body = req.body as { content?: unknown };
      if (typeof body?.content !== "string") {
        return reply.status(400).send({ error: "Missing required field: content" });
      }

      ensureAriadneFolder(workspace.rootPath);
      try {
        writeScript(workspace.rootPath, name, body.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to write script", detail: msg });
      }

      return reply.status(200).send({ name, content: body.content });
    }
  );

  // POST /api/workspaces/:id/scripts/:name/run
  app.post<{ Params: { id: string; name: string } }>(
    "/workspaces/:id/scripts/:name/run",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const { name } = req.params;
      if (!isSafeScriptName(name)) {
        return reply.status(400).send({ error: "Invalid script name" });
      }

      const filePath = path.join(scriptsDir(workspace.rootPath), name);
      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: "Script not found" });
      }

      const runner = getRunner(name);
      if (!runner) {
        return reply.status(400).send({ error: "Unsupported script type" });
      }

      // Run the script
      const result = await new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((resolve) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        let timedOut = false;

        const proc = spawn(runner.cmd, [...runner.args, filePath], {
          cwd: workspace.rootPath,
          env: scriptEnv(),
        });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          // Force-kill after 2s if still running
          setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 2000);
        }, TIMEOUT_MS);

        proc.stdout.on("data", (chunk: Buffer) => {
          if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
            stdoutBuf += chunk.toString("utf-8");
          }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
          if (stderrBuf.length < MAX_OUTPUT_BYTES) {
            stderrBuf += chunk.toString("utf-8");
          }
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: code,
            stdout: stdoutBuf.slice(0, MAX_OUTPUT_BYTES),
            stderr: stderrBuf.slice(0, MAX_OUTPUT_BYTES),
            timedOut,
          });
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          resolve({
            exitCode: null,
            stdout: stdoutBuf,
            stderr: `Failed to start process: ${err.message}`,
            timedOut: false,
          });
        });
      });

      return reply.send(result);
    }
  );
}
