import { randomBytes } from "node:crypto";
import type { Account } from "@ariadne/shared";
import { getDb } from "../db/index.js";
import { findAccountById } from "./accounts.js";

const SESSION_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createSession(accountId: string): string {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token, account_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(token, accountId, now.toISOString(), expiresAt.toISOString());
  return token;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateSession(token: string): Account | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token) as { account_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    // expired — clean up
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return findAccountById(row.account_id);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteSession(token: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
