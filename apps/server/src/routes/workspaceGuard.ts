/**
 * Shared access-control helpers — read and write are now distinct gates.
 *
 *   canViewWorkspace    — reading metadata, files, runs, surfaces, snapshots.
 *   canModifyWorkspace  — mutating: edit, scan, delete, build, scripts, etc.
 *
 *   Private (default)   → view + modify: owner/admin only.
 *   Public (visibility="public") → view: any authenticated account.
 *                                 modify: owner/admin only.
 *   Built-in (tutorial/demo) → view: any authenticated account.
 *                              modify: any authenticated account (current behaviour;
 *                                       could be tightened to admin-only in a
 *                                       follow-up, kept loose so the tutorial
 *                                       walkthrough doesn't break).
 *
 * `requireWorkspace` takes a mode that defaults to "write" — strict by
 * default, so a route that forgot to specify can't accidentally over-share.
 * GET endpoints opt into "read" explicitly.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Workspace, Account } from "@ariadne/shared";
import { isBuiltinWorkspace } from "@ariadne/shared";
import { dbGetWorkspace, dbGetWorkspaceRole } from "../db/repo.js";

/**
 * Owner-or-admin check — the basis for "private by default" content access.
 * An account sees what it created; an admin sees everything.
 */
export function isOwnerOrAdmin(createdBy: string | null, account: Account): boolean {
  if (account.role === "admin") return true;
  return createdBy != null && createdBy === account.id;
}

/** Can `account` read this workspace's content? */
export function canViewWorkspace(workspace: Workspace, account: Account): boolean {
  if (isBuiltinWorkspace(workspace.id)) return true;
  if (workspace.visibility === "public") return true;
  if (isOwnerOrAdmin(workspace.createdBy, account)) return true;
  // A per-user access grant (viewer/editor/owner) opens a private workspace —
  // e.g. an admin shares 강의 준비 with a specific account.
  return dbGetWorkspaceRole(workspace.id, account.id) != null;
}

/**
 * Boolean view-gate for a workspace *id* — for sites that reference a
 * workspace by id without going through `requireWorkspace` (a chat carrying a
 * `workspaceId`). A null/absent id is "nothing to gate" → true. An id that
 * resolves to no workspace (dangling reference) → false, so a chat can never
 * point at a workspace its owner can't see — or one that doesn't exist.
 */
export function canViewWorkspaceId(id: string | null | undefined, account: Account): boolean {
  if (!id) return true;
  const workspace = dbGetWorkspace(id);
  if (!workspace) return false;
  return canViewWorkspace(workspace, account);
}

/** Can `account` mutate this workspace (edit files, scan, delete, run, ...)? */
export function canModifyWorkspace(workspace: Workspace, account: Account): boolean {
  // Guests are read + chat only — never mutate or run anything in a workspace.
  // This one check blocks every write-guarded route (actions/scripts/run,
  // edit/scan/delete, triggers/schedules) for the guest role centrally.
  if (account?.role === "guest") return false;
  if (isBuiltinWorkspace(workspace.id)) return true;
  if (isOwnerOrAdmin(workspace.createdBy, account)) return true;
  // An editor/owner grant may modify; a viewer grant may not.
  const role = dbGetWorkspaceRole(workspace.id, account.id);
  return role === "editor" || role === "owner";
}

/**
 * Fetch a workspace by id and enforce the access guard. On a missing workspace
 * or denied access this sends the appropriate 404/403 response and returns
 * null — callers should `return` immediately when the result is null.
 *
 * `mode` defaults to "write" — the strict choice. Pass `"read"` on GET
 * endpoints and on read-only inspection sites so visibility="public"
 * workspaces are reachable by other authenticated accounts.
 */
export async function requireWorkspace(
  id: string,
  req: FastifyRequest,
  reply: FastifyReply,
  mode: "read" | "write" = "write",
): Promise<Workspace | null> {
  const workspace = dbGetWorkspace(id);
  if (!workspace) {
    await reply.status(404).send({ error: "Workspace not found" });
    return null;
  }
  const allowed =
    mode === "read"
      ? canViewWorkspace(workspace, req.account)
      : canModifyWorkspace(workspace, req.account);
  if (!allowed) {
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

/**
 * Reject a guest (role "guest") with 403. Returns true when it rejected —
 * callers should `return` immediately. Use on execution/mutation routes that
 * are NOT workspace-write-guarded (e.g. POST /runs, staged-apply), since
 * `canModifyWorkspace` already blocks guests on the workspace-scoped ones.
 */
export async function rejectGuest(
  req: FastifyRequest,
  reply: FastifyReply,
  detail = "Guests can't run or change projects — sign in to do that.",
): Promise<boolean> {
  if (req.account?.role === "guest") {
    await reply.status(403).send({ error: "Forbidden", detail });
    return true;
  }
  return false;
}
