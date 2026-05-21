import crypto from "node:crypto";
import type { Account, AccountMode } from "@ariadne/shared";
import { getDb } from "../db/index.js";
import { hashPassword } from "./passwords.js";
import logger from "../logger.js";

// ---------------------------------------------------------------------------
// DB row → Account
// ---------------------------------------------------------------------------

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row["id"] as string,
    username: row["username"] as string,
    displayName: row["display_name"] as string,
    role: row["role"] as string,
    locale: (row["locale"] as string | null) ?? "ko",
    mode: ((row["mode"] as string | null) ?? "standard") as AccountMode,
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findAccountByUsername(username: string): (Account & { passwordHash: string; salt: string }) | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM accounts WHERE username = ?")
    .get(username) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...rowToAccount(row),
    passwordHash: row["password_hash"] as string,
    salt: row["salt"] as string,
  };
}

export function findAccountById(id: string): Account | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToAccount(row);
}

export function createAccount(
  username: string,
  password: string,
  displayName: string,
  role: "admin" | "user" = "user",
  locale = "ko",
  mode: AccountMode = "standard"
): Account {
  const db = getDb();
  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO accounts (id, username, password_hash, salt, display_name, role, created_at, locale, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, username, hash, salt, displayName, role, createdAt, locale, mode);
  return { id, username, displayName, role, locale, mode, createdAt };
}

/** Update the locale of an existing account. Returns the updated Account, or null if not found. */
export function updateAccountLocale(accountId: string, locale: string): Account | null {
  const db = getDb();
  db.prepare("UPDATE accounts SET locale = ? WHERE id = ?").run(locale, accountId);
  return findAccountById(accountId);
}

/** Update the mode of an existing account. Returns the updated Account, or null if not found. */
export function updateAccountMode(accountId: string, mode: AccountMode): Account | null {
  const db = getDb();
  db.prepare("UPDATE accounts SET mode = ? WHERE id = ?").run(mode, accountId);
  return findAccountById(accountId);
}

// ---------------------------------------------------------------------------
// Seed admin on first boot
// ---------------------------------------------------------------------------

const DEFAULT_USER = "admin";
const DEFAULT_PASS = "ariadne";

export function seedAdmin(): void {
  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) as c FROM accounts").get() as { c: number }).c;
  if (count > 0) return;

  const username = process.env["ARIADNE_ADMIN_USER"] ?? DEFAULT_USER;
  const password = process.env["ARIADNE_ADMIN_PASSWORD"] ?? DEFAULT_PASS;
  const isDefault = !process.env["ARIADNE_ADMIN_PASSWORD"];

  createAccount(username, password, username, "admin");

  if (isDefault) {
    logger.info(
      { username, password },
      "Admin account seeded (default credentials — set ARIADNE_ADMIN_PASSWORD to customise)"
    );
  } else {
    logger.info({ username }, "Admin account seeded from env");
  }
}
