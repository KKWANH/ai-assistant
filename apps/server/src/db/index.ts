import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import logger from "../logger.js";

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) throw new Error("DB not initialised — call openDb() first");
  return _db;
}

export function openDb(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  _db = db;

  // Enable WAL for better concurrency
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");

  runMigrations(db);
  logger.info({ dbPath }, "SQLite database opened");
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      root_path   TEXT NOT NULL,
      include_globs TEXT NOT NULL DEFAULT '[]',
      exclude_globs TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      last_scan_at TEXT,
      file_count  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id                    TEXT PRIMARY KEY,
      workspace_id          TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      file_count            INTEGER NOT NULL DEFAULT 0,
      ignored_count         INTEGER NOT NULL DEFAULT 0,
      sensitive_count       INTEGER NOT NULL DEFAULT 0,
      total_estimated_tokens INTEGER NOT NULL DEFAULT 0,
      files_json            TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS runs (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL,
      template_id      TEXT NOT NULL,
      template_name    TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'created',
      input_json       TEXT NOT NULL DEFAULT '{}',
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      started_at       TEXT,
      completed_at     TEXT,
      candidate_files  TEXT NOT NULL DEFAULT '[]',
      selected_files   TEXT NOT NULL DEFAULT '[]',
      token_estimate   INTEGER NOT NULL DEFAULT 0,
      evidence_count   INTEGER NOT NULL DEFAULT 0,
      unsupported_count INTEGER NOT NULL DEFAULT 0,
      artifacts_json   TEXT NOT NULL DEFAULT '{}',
      trace_json       TEXT NOT NULL DEFAULT '[]',
      previous_run_id  TEXT,
      error            TEXT
    );

    CREATE TABLE IF NOT EXISTS claims (
      id                  TEXT PRIMARY KEY,
      run_id              TEXT NOT NULL,
      text                TEXT NOT NULL,
      status              TEXT NOT NULL,
      sources_json        TEXT NOT NULL DEFAULT '[]',
      reason              TEXT,
      missing_evidence    TEXT,
      suggested_source_type TEXT,
      conservative_rewrite TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS file_index USING fts5(
      workspace_id UNINDEXED,
      path,
      filename,
      headings,
      tokenize='unicode61'
    );
  `);

  // usage_events table (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id           TEXT PRIMARY KEY,
      run_id       TEXT NOT NULL,
      provider     TEXT NOT NULL,
      model        TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd     REAL NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL
    );
  `);

  // Chat tables (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      workspace_id TEXT,
      created_by   TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id                  TEXT PRIMARY KEY,
      chat_id             TEXT NOT NULL,
      role                TEXT NOT NULL,
      content             TEXT NOT NULL,
      attachments_json    TEXT NOT NULL DEFAULT '[]',
      web_search          INTEGER NOT NULL DEFAULT 0,
      search_results_json TEXT,
      created_at          TEXT NOT NULL
    );
  `);

  // Reports table — user-submitted feedback awaiting triage + admin review (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      created_by  TEXT,
      created_at  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      triage_json TEXT,
      triaged_at  TEXT,
      decided_by  TEXT,
      decided_at  TEXT,
      github_url  TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Skills — account-scoped, reusable prompt snippets. v1 keeps it tiny:
  // just a name + a prompt. The chat composer surfaces them via a button
  // dropdown and via slash-command autocomplete (e.g. /translate).
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Action schedules — recurring runs of a workspace action, fired by the
  // in-process scheduler service (services/scheduler.ts) every minute.
  // next_run_at is denormalised so we don't recompute from `frequency`
  // every tick. enabled doubles as a soft delete: flip to 0 to pause.
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_schedules (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      action_id    TEXT NOT NULL,
      account_id   TEXT NOT NULL,
      frequency    TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_run_at  TEXT,
      next_run_at  TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);

  // Chunk embeddings — semantic-search index over workspace text files.
  // One row per chunk. embedding is a Float32Array stored as a BLOB; the
  // provider tag captures which model produced the vector so the
  // retriever can reject a stale index after a model swap.
  // Re-indexing replaces all rows for the workspace, so we don't need
  // staleness flags — file_mtime is for incremental indexing later.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL,
      provider      TEXT NOT NULL,
      dimensions    INTEGER NOT NULL,
      path          TEXT NOT NULL,
      chunk         TEXT NOT NULL,
      chunk_index   INTEGER NOT NULL,
      file_mtime    INTEGER NOT NULL,
      embedding     BLOB NOT NULL,
      indexed_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_workspace
      ON chunk_embeddings(workspace_id);
  `);

  // Guarded ALTER TABLE: add agent_json to chat_messages if missing
  const chatMsgColumns = db
    .prepare("PRAGMA table_info(chat_messages)")
    .all() as Array<{ name: string }>;
  if (!chatMsgColumns.some((c) => c.name === "agent_json")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN agent_json TEXT");
  }
  // Guarded ALTER TABLE: add revisions_json — past versions of a user
  // message's content, retained when the message was edited.
  if (!chatMsgColumns.some((c) => c.name === "revisions_json")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN revisions_json TEXT");
  }

  // Guarded ALTER TABLE: add created_by to workspaces if missing
  const wsColumns = db
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string }>;
  if (!wsColumns.some((c) => c.name === "created_by")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN created_by TEXT");
  }

  // Guarded ALTER TABLE: add created_by to runs if missing
  const runColumns = db
    .prepare("PRAGMA table_info(runs)")
    .all() as Array<{ name: string }>;
  if (!runColumns.some((c) => c.name === "created_by")) {
    db.exec("ALTER TABLE runs ADD COLUMN created_by TEXT");
  }

  // Guarded ALTER TABLE: add usage_json to runs if missing
  if (!runColumns.some((c) => c.name === "usage_json")) {
    db.exec("ALTER TABLE runs ADD COLUMN usage_json TEXT");
  }

  // Guarded ALTER TABLE: add kind to runs if missing (NULL → "template")
  if (!runColumns.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE runs ADD COLUMN kind TEXT");
  }

  // Guarded ALTER TABLE: add block_results_json to runs if missing
  if (!runColumns.some((c) => c.name === "block_results_json")) {
    db.exec("ALTER TABLE runs ADD COLUMN block_results_json TEXT");
  }

  // Guarded ALTER TABLE: add locale to accounts if missing
  const accountColumns = db
    .prepare("PRAGMA table_info(accounts)")
    .all() as Array<{ name: string }>;
  if (!accountColumns.some((c) => c.name === "locale")) {
    db.exec("ALTER TABLE accounts ADD COLUMN locale TEXT");
  }

  // Guarded ALTER TABLE: add mode to accounts if missing (NULL → "standard")
  if (!accountColumns.some((c) => c.name === "mode")) {
    db.exec("ALTER TABLE accounts ADD COLUMN mode TEXT");
  }

  // Guarded ALTER TABLE: add context + context_updated_at to accounts if missing
  if (!accountColumns.some((c) => c.name === "context")) {
    db.exec("ALTER TABLE accounts ADD COLUMN context TEXT");
  }
  if (!accountColumns.some((c) => c.name === "context_updated_at")) {
    db.exec("ALTER TABLE accounts ADD COLUMN context_updated_at TEXT");
  }

  // Guarded ALTER TABLE: add visibility to workspaces if missing (NULL → "private")
  if (!wsColumns.some((c) => c.name === "visibility")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN visibility TEXT");
  }

  // Guarded ALTER TABLE: add category to workspaces if missing (NULL → all templates)
  if (!wsColumns.some((c) => c.name === "category")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN category TEXT");
  }

  // Guarded ALTER TABLE: add attachments_json to reports if missing
  const reportColumns = db
    .prepare("PRAGMA table_info(reports)")
    .all() as Array<{ name: string }>;
  if (!reportColumns.some((c) => c.name === "attachments_json")) {
    db.exec("ALTER TABLE reports ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'");
  }
}
