/**
 * Alerts — create persisted per-account notifications.
 *
 * `createAlert` is the single entry point used by completion/limit hooks. It is
 * best-effort by design: an alert insert must NEVER break the run or chat it
 * reports on, so it swallows its own errors and no-ops without an account.
 */
import crypto from "node:crypto";
import { dbInsertAlert } from "../db/repo.js";
import logger from "../logger.js";

export function createAlert(
  accountId: string | null | undefined,
  type: string,
  title: string,
  body: string | null = null,
  link: string | null = null,
): void {
  if (!accountId) return;
  try {
    dbInsertAlert({
      id: crypto.randomUUID(),
      accountId,
      type,
      title,
      body,
      link,
      readAt: null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ accountId, type, err }, "failed to insert alert");
  }
}
