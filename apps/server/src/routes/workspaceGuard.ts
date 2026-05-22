/**
 * Shared access-control helpers.
 *
 * Content is private by default: every account sees only what it created.
 * An admin sees everything. The built-in workspaces are public.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Workspace, Account } from "@ariadne/shared";
import { isBuiltinWorkspace } from "@ariadne/shared";
import { dbGetWorkspace } from "../db/repo.js";

/**
 * Owner-or-admin check — the basis for "private by default" content access.
 * An account sees what it created; an admin sees everything.
 */
export function isOwnerOrAdmin(createdBy: string | null, account: Account): boolean {
  if (account.role === "admin") return true;
  return createdBy != null && createdBy === account.id;
}

export function canAccessWorkspace(workspace: Workspace, account: Account): boolean {
  // Built-in workspaces (the tutorial and the Portfolio demo) are public.
  if (isBuiltinWorkspace(workspace.id)) return true;
  return isOwnerOrAdmin(workspace.createdBy, account);
}

/**
 * Fetch a workspace by id and enforce the access guard. On a missing workspace
 * or denied access this sends the appropriate 404/403 response and returns
 * null — callers should `return` immediately when the result is null.
 */
export async function requireWorkspace(
  id: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Workspace | null> {
  const workspace = dbGetWorkspace(id);
  if (!workspace) {
    await reply.status(404).send({ error: "Workspace not found" });
    return null;
  }
  if (!canAccessWorkspace(workspace, req.account)) {
    await reply.status(403).send({ error: "Forbidden" });
    return null;
  }
  return workspace;
}

/**
 * Reject remote (non-local) requests with a 403. Returns true when the request
 * was rejected — callers should `return` immediately in that case.
 *
 * `detail` is the human-readable explanation sent on the 403 body.
 */
export async function rejectRemoteAccess(
  detail: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (req.accessContext === "remote") {
    await reply.status(403).send({ error: "Forbidden", detail });
    return true;
  }
  return false;
}
