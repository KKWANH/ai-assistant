/**
 * MCP server CRUD + introspection routes.
 *
 *   GET    /api/mcp-servers              — list (your servers + admin sees all)
 *   POST   /api/mcp-servers              — register a new MCP server
 *   PATCH  /api/mcp-servers/:id          — update fields
 *   DELETE /api/mcp-servers/:id          — remove (disconnects first)
 *   GET    /api/mcp-servers/:id/tools    — fetch the server's tool list
 *   POST   /api/mcp-servers/:id/test     — opens the connection, returns status
 *
 * All write actions are local-only (rejectRemoteAccess) — MCP servers
 * spawn child processes on the host, so a remote session can't be
 * trusted to add or change them.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CreateMcpServerSchema,
  UpdateMcpServerSchema,
  type McpServer,
} from "@ariadne/shared";
import {
  dbInsertMcpServer,
  dbGetMcpServer,
  dbListMcpServers,
  dbUpdateMcpServer,
  dbDeleteMcpServer,
} from "../db/repo.js";
import {
  listTools,
  testConnection,
  disconnect,
  isConnected,
} from "../services/mcpClient.js";
import { rejectRemoteAccess } from "./workspaceGuard.js";

function isAdmin(role: string | undefined): boolean {
  return role === "admin";
}

/** Owner-or-admin check, mirroring the rest of the API. */
function canTouch(server: McpServer, accountId: string, role: string): boolean {
  if (isAdmin(role)) return true;
  return server.createdBy === accountId;
}

/** Strip null-y fields so the response shape stays clean. */
function decorate(server: McpServer): McpServer & { connected: boolean } {
  return { ...server, connected: isConnected(server.id) };
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  // ── List ────────────────────────────────────────────────────────────
  app.get("/mcp-servers", async (req, reply) => {
    const all = dbListMcpServers(
      isAdmin(req.account.role) ? undefined : req.account.id,
    );
    return reply.send(all.map(decorate));
  });

  // ── Create ──────────────────────────────────────────────────────────
  app.post("/mcp-servers", async (req, reply) => {
    if (await rejectRemoteAccess("MCP server management is local-only", req, reply)) return;
    const parsed = CreateMcpServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    const now = new Date().toISOString();
    const server: McpServer = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      transport: parsed.data.transport ?? "stdio",
      command: parsed.data.command,
      args: parsed.data.args ?? [],
      env: parsed.data.env ?? {},
      enabled: parsed.data.enabled ?? true,
      createdBy: req.account.id,
      createdAt: now,
    };
    dbInsertMcpServer(server);
    return reply.status(201).send(decorate(server));
  });

  // ── Update ──────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/mcp-servers/:id", async (req, reply) => {
    if (await rejectRemoteAccess("MCP server management is local-only", req, reply)) return;
    const existing = dbGetMcpServer(req.params.id);
    if (!existing) return reply.status(404).send({ error: "MCP server not found" });
    if (!canTouch(existing, req.account.id, req.account.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const parsed = UpdateMcpServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    // Any mutation invalidates the cached connection so the next call
    // re-spawns with the new params.
    await disconnect(existing.id);
    const updated = dbUpdateMcpServer(existing.id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "MCP server not found" });
    return reply.send(decorate(updated));
  });

  // ── Delete ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/mcp-servers/:id", async (req, reply) => {
    if (await rejectRemoteAccess("MCP server management is local-only", req, reply)) return;
    const existing = dbGetMcpServer(req.params.id);
    if (!existing) return reply.status(404).send({ error: "MCP server not found" });
    if (!canTouch(existing, req.account.id, req.account.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    await disconnect(existing.id);
    dbDeleteMcpServer(existing.id);
    return reply.send({ ok: true as const });
  });

  // ── Tools ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/mcp-servers/:id/tools", async (req, reply) => {
    const existing = dbGetMcpServer(req.params.id);
    if (!existing) return reply.status(404).send({ error: "MCP server not found" });
    if (!canTouch(existing, req.account.id, req.account.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    try {
      const tools = await listTools(existing.id);
      return reply.send({ tools });
    } catch (err) {
      return reply.status(502).send({
        error: "MCP connection failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Test connection ─────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/mcp-servers/:id/test", async (req, reply) => {
    if (await rejectRemoteAccess("MCP testing spawns a child process and is local-only", req, reply)) return;
    const existing = dbGetMcpServer(req.params.id);
    if (!existing) return reply.status(404).send({ error: "MCP server not found" });
    if (!canTouch(existing, req.account.id, req.account.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const status = await testConnection(existing.id);
    return reply.send(status);
  });
}
