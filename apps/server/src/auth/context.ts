import type { FastifyRequest } from "fastify";
import type { AccessContext } from "@ariadne/shared";

/**
 * Is this an IPv4/IPv6 loopback address (127.0.0.0/8 or ::1)? Handles the
 * IPv4-mapped-IPv6 form Node reports on dual-stack sockets ("::ffff:127.0.0.1").
 */
function isLoopback(addr: string): boolean {
  if (addr === "::1") return true;
  const v4 = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
  return v4.startsWith("127.");
}

/**
 * Request headers that mean the connection was relayed by another process
 * (a tunnel or a reverse proxy) rather than coming straight from the client.
 * Any of these → "remote", regardless of the TCP peer. cloudflared injects the
 * cf-* pair; a reverse proxy adds x-forwarded-for / x-real-ip / forwarded.
 */
const RELAY_HEADERS = [
  "cf-connecting-ip",
  "cf-ray",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
] as const;

/**
 * "local" only when the request arrives on a real loopback connection AND was
 * not relayed by a tunnel/proxy. Everything else is "remote".
 *
 * The peer address (`req.socket.remoteAddress`) is the actual TCP source and
 * cannot be forged by a client — unlike the Host header — so a LAN/WAN client
 * (only reachable when the server is bound to 0.0.0.0) is correctly "remote"
 * even if it sends `Host: localhost`. cloudflared and any same-host reverse
 * proxy connect over loopback too, but they add a relay header (checked first),
 * so a future proxy in front of the server can't silently inherit local-admin.
 * Note these headers can only DOWNGRADE to remote — local trust still requires a
 * genuine loopback peer, so a remote client can't forge its way to "local".
 */
export function accessContext(req: FastifyRequest): AccessContext {
  if (RELAY_HEADERS.some((h) => req.headers[h])) {
    return "remote";
  }
  return isLoopback(req.socket.remoteAddress ?? "") ? "local" : "remote";
}
