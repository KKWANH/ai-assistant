/**
 * Shared workspace access-control helpers.
 *
 * Rules:
 *   - Owner (created_by === account.id) → always allowed
 *   - Admin + visibility === "public"   → allowed
 *   - Otherwise                         → denied
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Workspace, Account } from "@ariadne/shared";
import { TUTORIAL_WORKSPACE_ID } from "@ariadne/shared";
import { dbGetWorkspace } from "../db/repo.js";

export function canAccessWorkspace(workspace: Workspace, account: Account): boolean {
  // The built-in tutorial workspace is visible to everyone.
  if (workspace.id === TUTORIAL_WORKSPACE_ID) return true;
  if (workspace.createdBy === account.id) return true;
  if (workspace.visibility === "public" && account.role === "admin") return true;
  return false;
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
