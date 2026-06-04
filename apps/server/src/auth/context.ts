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
 * "local" only when the request arrives on a real loopback connection AND is
 * not a Cloudflare tunnel hop. Everything else is "remote".
 *
 * The peer address (`req.socket.remoteAddress`) is the actual TCP source and
 * cannot be forged by a client — unlike the Host header — so a LAN/WAN client
 * (only reachable when the server is bound to 0.0.0.0) is correctly "remote"
 * even if it sends `Host: localhost`. cloudflared connects over loopback too,
 * but it always injects cf-* headers and is excluded first.
 */
export function accessContext(req: FastifyRequest): AccessContext {
  if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"]) {
    return "remote";
  }
  return isLoopback(req.socket.remoteAddress ?? "") ? "local" : "remote";
}
