import type { FastifyRequest } from "fastify";
import type { AccessContext } from "@ariadne/shared";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Returns "remote" if the request came through a Cloudflare tunnel
 * (cf-connecting-ip or cf-ray header present) or if the Host hostname is
 * not a loopback address. Returns "local" otherwise.
 *
 * Note: Cloudflare always injects cf-connecting-ip, so spoofing
 * Host: localhost from a tunneled request is not sufficient to bypass this.
 */
export function accessContext(req: FastifyRequest): AccessContext {
  // Cloudflare tunnel headers are always present on tunneled requests.
  if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"]) {
    return "remote";
  }

  // Check the Host header hostname.
  const host = req.headers["host"] ?? "";
  const hostname = host.split(":")[0] ?? "";
  if (!LOOPBACK.has(hostname)) {
    return "remote";
  }

  return "local";
}
