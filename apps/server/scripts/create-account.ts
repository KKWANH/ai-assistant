/**
 * Create an Ariadne account from the command line.
 *
 *   tsx apps/server/scripts/create-account.ts <username> <password> [displayName] [role] [locale] [mode]
 *
 * Role is "user" unless "admin" is passed.
 * Locale defaults to "en" unless specified (e.g. "ko").
 * Mode is "standard" unless "simple" is passed.
 * Existing usernames are left untouched.
 */
import type { AccountMode } from "@ariadne/shared";
import { ensureDirs, PATHS } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { createAccount, findAccountByUsername } from "../src/auth/accounts.js";

const [, , username, password, displayName, role, locale, mode] = process.argv;

if (!username || !password) {
  console.error(
    "Usage: tsx apps/server/scripts/create-account.ts <username> <password> [displayName] [role] [locale] [mode]"
  );
  process.exit(1);
}

ensureDirs();
openDb(PATHS.db);

if (findAccountByUsername(username)) {
  console.log(`Account "${username}" already exists — skipped.`);
  process.exit(0);
}

const resolvedMode: AccountMode =
  mode && mode.trim() === "simple" ? "simple" : "standard";

const account = createAccount(
  username,
  password,
  displayName && displayName.trim() !== "" ? displayName : username,
  role === "admin" ? "admin" : "user",
  locale && locale.trim() !== "" ? locale.trim() : "en",
  resolvedMode
);
console.log(`Created account "${account.username}" (role: ${account.role}, locale: ${account.locale}, mode: ${account.mode}).`);
