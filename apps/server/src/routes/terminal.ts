/**
 * Terminal route (P3 IDE #7) — a WebSocket that bridges a workspace PTY to the
 * browser. Registered inside the /api scope, so the auth onRequest hook has
 * already run (req.account + req.accessContext are set).
 *
 * Hard gates, in order:
 *   1. LOCAL-ONLY — a shell must never be reachable over remote/public access.
 *   2. Owner/admin write access to the workspace (local resolves as admin, but
 *      we check anyway — defence in depth, mirrors the commit posture).
 */
import type { FastifyInstance } from "fastify";
import { dbGetWorkspace } from "../db/repo.js";
import { canModifyWorkspace } from "./workspaceGuard.js";
import { attachTerminal } from "../services/terminal.js";

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/terminal",
    { websocket: true },
    (socket, req) => {
      if (req.accessContext !== "local") {
        try {
          socket.send("\r\n[Terminal is only available on local access.]\r\n");
          socket.close();
        } catch {
          /* socket already gone */
        }
        return;
      }

      const workspace = dbGetWorkspace(req.params.id);
      if (!workspace || !req.account || !canModifyWorkspace(workspace, req.account)) {
        try {
          socket.close();
        } catch {
          /* */
        }
        return;
      }

      attachTerminal(socket, workspace.rootPath);
    },
  );
}
