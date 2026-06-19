/**
 * Agent attempts — per-chat staging "branch" record.
 *
 * Wraps the Phase-A staged-edits primitive so the agent's `edit_file`
 * tool has somewhere to land its proposals (which it doesn't otherwise,
 * because agent steps have no Run id). The attempt id is used as the
 * staging key, so the diff viewer can render an attempt's manifest with
 * the same component as an action run's.
 *
 * Lifecycle:
 *   open       — agent is staging edits here; multiple edit_file calls
 *                accumulate into the same manifest.
 *   applied    — the user reviewed and applied; commit landed in
 *                workspace history; staged tree stays for forensics.
 *   abandoned  — the user discarded; staged tree wiped.
 *
 * At most one open attempt per chat. The agent's edit_file tool calls
 * `getOrOpenAttempt(chatId)` to find or create it.
 */
import crypto from "node:crypto";
import type { AgentAttempt, Workspace } from "@ariadne/shared";
import {
  dbInsertAttempt,
  dbGetAttempt,
  dbGetOpenAttemptForChat,
  dbListAttemptsForChat,
  dbUpdateAttempt,
  dbGetWorkspace,
} from "../db/repo.js";
import {
  getStagedManifest,
  discardStagedEdits,
  applyStagedEdits,
  type ApplyResult,
} from "./stagedEdits.js";
import logger from "../logger.js";

/** The string used as the "runId" in stagedEdits — keeps the staging
 *  directory deterministic per attempt. */
export function stagingIdForAttempt(attemptId: string): string {
  return `attempt-${attemptId}`;
}

/**
 * Return the chat's current open attempt, creating one if none exists.
 * Caller already knows the chat's workspace; we re-validate to avoid
 * a stale-cache crash.
 */
export function getOrOpenAttempt(chatId: string, workspaceId: string): AgentAttempt {
  const existing = dbGetOpenAttemptForChat(chatId);
  if (existing && existing.workspaceId === workspaceId) {
    return decorateWithFileCount(existing);
  }
  const attempt: Omit<AgentAttempt, "fileCount"> = {
    id: crypto.randomUUID(),
    chatId,
    workspaceId,
    status: "open",
    createdAt: new Date().toISOString(),
    appliedAt: null,
    abandonedAt: null,
    commitSha: null,
  };
  dbInsertAttempt(attempt);
  return { ...attempt, fileCount: 0 };
}

export function getAttempt(id: string): AgentAttempt | null {
  const a = dbGetAttempt(id);
  return a ? decorateWithFileCount(a) : null;
}

export function getOpenAttemptForChat(chatId: string): AgentAttempt | null {
  const a = dbGetOpenAttemptForChat(chatId);
  return a ? decorateWithFileCount(a) : null;
}

/** Every attempt for the chat, newest first — open + applied + abandoned. */
export function listAttemptsForChat(chatId: string): AgentAttempt[] {
  return dbListAttemptsForChat(chatId).map(decorateWithFileCount);
}

/** Apply selected files from the attempt. Marks the attempt 'applied'
 *  on success so the chat chip flips out of the open state. */
export async function applyAttempt(
  attemptId: string,
  selectedPaths: string[],
  /** Local (loopback) session? Gates staged_apply hook execution — see applyStagedEdits. */
  local: boolean,
): Promise<ApplyResult> {
  const attempt = dbGetAttempt(attemptId);
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.status !== "open") throw new Error("Attempt is no longer open");

  const result = await applyStagedEdits(
    attempt.workspaceId,
    stagingIdForAttempt(attemptId),
    selectedPaths,
    local,
  );
  if (result.applied.length > 0) {
    dbUpdateAttempt(attemptId, {
      status: "applied",
      appliedAt: new Date().toISOString(),
      commitSha: result.commitSha,
    });
  }
  return result;
}

/** Wipe the staged tree + mark the attempt abandoned. Safe to call
 *  on an already-closed attempt. */
export function abandonAttempt(attemptId: string): void {
  const attempt = dbGetAttempt(attemptId);
  if (!attempt) return;
  // Always wipe disk even if the row is in an odd state — never leave
  // orphan staged trees that could confuse the diff viewer later.
  discardStagedEdits(attempt.workspaceId, stagingIdForAttempt(attemptId));
  if (attempt.status === "open") {
    dbUpdateAttempt(attemptId, {
      status: "abandoned",
      abandonedAt: new Date().toISOString(),
    });
  }
}

/** Resolve the workspace for an attempt — small helper the agent tool uses
 *  so we don't re-look up in two places. */
export function workspaceForAttempt(attemptId: string): Workspace | null {
  const a = dbGetAttempt(attemptId);
  if (!a) return null;
  return dbGetWorkspace(a.workspaceId) ?? null;
}

function decorateWithFileCount(a: AgentAttempt): AgentAttempt {
  try {
    const manifest = getStagedManifest(a.workspaceId, stagingIdForAttempt(a.id));
    return { ...a, fileCount: manifest?.files.length ?? 0 };
  } catch (err) {
    logger.debug({ attemptId: a.id, err }, "could not read attempt manifest");
    return a;
  }
}
