/**
 * MCP connection manager.
 *
 * Lazy-connects to an MCP server on first use, caches the live
 * connection process-wide, and exposes a tiny surface:
 *
 *   listTools(serverId)         -> McpTool[]
 *   callTool(serverId, name, args) -> string
 *   testConnection(serverId)    -> { ok: true, toolCount } | { ok: false, error }
 *   disconnect(serverId)        -> void
 *   shutdownAll()               -> void (called on supervisor stop)
 *
 * Transport: stdio only in v1 (most common pattern for `npx
 * @modelcontextprotocol/server-*`). HTTP/SSE is a non-breaking
 * follow-up — the McpServer.transport column already exists.
 *
 * Connection cache is keyed by serverId, NOT by spawn arity, so an
 * edit (e.g. swap a server's command) requires an explicit disconnect
 * first or a server restart. The CRUD route handles that.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  McpServer,
  McpTool,
  McpConnectionStatus,
} from "@ariadne/shared";
import { dbGetMcpServer } from "../db/repo.js";
import logger from "../logger.js";

interface CachedConnection {
  client: Client;
  transport: StdioClientTransport;
  /** When this entry was created — used to expire stale failed sessions. */
  openedAt: number;
}

const CONNECTIONS = new Map<string, CachedConnection>();
const CONNECT_TIMEOUT_MS = 10_000;

function clientIdentity(): { name: string; version: string } {
  return { name: "ariadne-mcp-client", version: "0.1.0" };
}

/** Build a Stdio transport from a stored server row. */
function buildTransport(server: McpServer): StdioClientTransport {
  return new StdioClientTransport({
    command: server.command,
    args: server.args,
    // Always pipe stderr so we capture child diagnostics instead of
    // leaking them to the supervisor's combined log. The server side
    // (Ariadne) doesn't surface stderr yet — adding a per-server log
    // is a follow-up.
    stderr: "pipe",
    // env: the SDK merges with its DEFAULT_INHERITED_ENV_VARS allow-list,
    // so user-supplied env overrides PATH/HOME/etc. only when explicit.
    env: server.env,
  });
}

/** Get or open a connection to the named server. Disabled rows error. */
async function getOrConnect(serverId: string): Promise<Client> {
  const cached = CONNECTIONS.get(serverId);
  if (cached) return cached.client;

  const server = dbGetMcpServer(serverId);
  if (!server) throw new Error(`MCP server ${serverId} not found`);
  if (!server.enabled) throw new Error(`MCP server "${server.name}" is disabled`);

  const transport = buildTransport(server);
  const client = new Client(clientIdentity(), { capabilities: {} });

  // The MCP SDK's connect() resolves only after the initialize handshake.
  // We wrap it in a timeout so a wedged server doesn't hang the calling
  // request — better to surface a clear error than spin forever.
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`MCP "${server.name}" connect timed out after ${(CONNECT_TIMEOUT_MS / 1000).toString()}s`)),
      CONNECT_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([connectPromise, timeoutPromise]);
  } catch (err) {
    // Best-effort cleanup of the half-open transport.
    try { await transport.close(); } catch { /* ignore */ }
    throw err;
  }

  CONNECTIONS.set(serverId, { client, transport, openedAt: Date.now() });
  logger.info({ serverId, name: server.name, command: server.command }, "MCP server connected");
  return client;
}

export async function listTools(serverId: string): Promise<McpTool[]> {
  const client = await getOrConnect(serverId);
  const resp = (await client.listTools()) as { tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }> };
  return (resp.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema ?? null,
  }));
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = await getOrConnect(serverId);
  const result = (await client.callTool({
    name: toolName,
    arguments: args,
  })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  // Stringify the content array into a single text blob — that's the
  // shape agent.ts expects from every tool handler.
  const blocks = result.content ?? [];
  const text = blocks
    .map((b) => (b.type === "text" && b.text ? b.text : `[${b.type}]`))
    .join("\n");
  if (result.isError) {
    return `[mcp_call error] ${text || "(no error text)"}`;
  }
  return text || "(empty result)";
}

export async function testConnection(serverId: string): Promise<McpConnectionStatus> {
  try {
    const tools = await listTools(serverId);
    return { connected: true, toolCount: tools.length };
  } catch (err) {
    return {
      connected: false,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Synchronously check whether a connection is cached. Used by routes
 *  to render "connected" badges without forcing a new connect. */
export function isConnected(serverId: string): boolean {
  return CONNECTIONS.has(serverId);
}

export async function disconnect(serverId: string): Promise<void> {
  const cached = CONNECTIONS.get(serverId);
  if (!cached) return;
  CONNECTIONS.delete(serverId);
  try {
    await cached.client.close();
  } catch (err) {
    logger.warn({ err, serverId }, "MCP client.close() failed");
  }
}

export async function shutdownAll(): Promise<void> {
  const ids = Array.from(CONNECTIONS.keys());
  await Promise.all(ids.map((id) => disconnect(id)));
}
