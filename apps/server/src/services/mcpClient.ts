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
    // Pipe stderr so the connect() path can capture child diagnostics
    // and surface them in the error message — without this, a missing
    // npm package shows up as the opaque "Connection closed" instead
    // of the real "package not found" stderr.
    stderr: "pipe",
    // env: the SDK merges with its DEFAULT_INHERITED_ENV_VARS allow-list,
    // so user-supplied env overrides PATH/HOME/etc. only when explicit.
    env: server.env,
  });
}

/** Map common spawn / MCP errors into human-readable hints. The raw
 *  message is appended so power users keep diagnostic info; mom-grade
 *  users at least see what went wrong instead of "ENOENT". */
function friendlyError(raw: string, server: McpServer, stderr: string): string {
  if (raw.includes("ENOENT") && raw.includes(server.command)) {
    return `Command not found: "${server.command}". Check the spelling, or install it (e.g. \`npm i -g ${server.command}\`).${stderr ? `\n— stderr —\n${stderr}` : ""}`;
  }
  if (raw.includes("EACCES")) {
    return `Permission denied running "${server.command}". The binary exists but isn't executable.${stderr ? `\n— stderr —\n${stderr}` : ""}`;
  }
  if (raw.includes("Connection closed") || raw.includes("-32000")) {
    // The SDK reports this when the child crashes before the
    // initialize handshake completes. stderr usually has the real
    // reason (npm 404, missing required arg, etc.).
    const hint = stderr ? `\n— stderr —\n${stderr}` : " (check that the command + args are correct and the package is installed)";
    return `MCP server crashed before it could respond.${hint}`;
  }
  if (raw.includes("timed out")) {
    return `MCP server didn't respond in time. It may be downloading dependencies on first run — try again, or check stderr.${stderr ? `\n— stderr —\n${stderr}` : ""}`;
  }
  return stderr ? `${raw}\n— stderr —\n${stderr}` : raw;
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

  // Tap the child's stderr so connect-time failures (npm 404, missing
  // module, segfault) have a real diagnostic instead of "Connection
  // closed". The SDK doesn't expose stderr until after start(); we
  // attach an end-to-end listener for the connect window only and
  // then let the chunks pile up in a string we keep around.
  let stderrChunks = "";
  const onStderr = (buf: Buffer): void => {
    stderrChunks += buf.toString("utf-8");
    if (stderrChunks.length > 4_000) {
      stderrChunks = stderrChunks.slice(-4_000);
    }
  };

  // The MCP SDK's connect() resolves only after the initialize handshake.
  // We wrap it in a timeout so a wedged server doesn't hang the calling
  // request — better to surface a clear error than spin forever.
  const connectPromise = client.connect(transport).then(() => {
    // start() has run by now; transport.stderr is non-null when
    // stderr was set to "pipe" in the params.
    transport.stderr?.on("data", onStderr);
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`MCP "${server.name}" connect timed out after ${(CONNECT_TIMEOUT_MS / 1000).toString()}s`)),
      CONNECT_TIMEOUT_MS,
    );
  });

  try {
    // For the connect path, also tap stderr proactively in case the
    // child writes to stderr before connect() resolves (e.g. npm
    // download progress + the final error).
    setTimeout(() => transport.stderr?.on("data", onStderr), 50);
    await Promise.race([connectPromise, timeoutPromise]);
  } catch (err) {
    // Best-effort cleanup of the half-open transport.
    try { await transport.close(); } catch { /* ignore */ }
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new Error(friendlyError(rawMsg, server, stderrChunks.trim()));
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
