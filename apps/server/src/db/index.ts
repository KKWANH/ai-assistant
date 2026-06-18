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

/**
 * Schema migrations — intentionally a simple, ADDITIVE-ONLY scheme: every boot
 * re-runs `CREATE TABLE IF NOT EXISTS` blocks plus guarded `addColumnIfMissing`
 * ALTERs (idempotent via SQLite introspection). There is no version table and
 * no down-migrations — adding a table or a nullable column is a one-liner, but
 * anything non-additive (renames, type changes, data backfills) is NOT
 * supported here and must be handled deliberately (a one-off script + a manual
 * note), not by editing this function. Keep new columns nullable / defaulted so
 * existing rows stay valid.
 */
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

    -- Hot path: load/poll a chat's messages in order. Without this, every chat
    -- open and every 2s /active poll was a full table SCAN + temp-B-tree sort
    -- over all messages in the DB.
    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat
      ON chat_messages(chat_id, created_at);
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

    CREATE TABLE IF NOT EXISTS action_triggers (
      id            TEXT PRIMARY KEY,
      secret        TEXT NOT NULL UNIQUE,
      workspace_id  TEXT NOT NULL,
      action_id     TEXT NOT NULL,
      account_id    TEXT NOT NULL,
      last_fired_at TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      link        TEXT,
      read_at     TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_account
      ON alerts(account_id, created_at);

    CREATE TABLE IF NOT EXISTS account_limits (
      account_id          TEXT PRIMARY KEY,
      daily_token_limit   INTEGER,
      weekly_token_limit  INTEGER,
      created_at          TEXT NOT NULL
    );
  `);

  // Agent attempts — per-chat staging "branches". A chat has at most
  // one open attempt at a time; closing it (apply or abandon) is what
  // commits or wipes the staged tree under .ariadne/staged/attempt-<id>/.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_attempts (
      id            TEXT PRIMARY KEY,
      chat_id       TEXT NOT NULL,
      workspace_id  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'open',
      created_at    TEXT NOT NULL,
      applied_at    TEXT,
      abandoned_at  TEXT,
      commit_sha    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_attempts_chat
      ON agent_attempts(chat_id, status);
  `);

  // Symbol index — regex-extracted function/class/method/const names
  // per file. Cheap to maintain; retrieval gives a small score nudge
  // to chunks whose path contains a query-matched symbol.
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_index (
      workspace_id TEXT NOT NULL,
      path         TEXT NOT NULL,
      name         TEXT NOT NULL,
      kind         TEXT NOT NULL,
      line         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symbol_index_workspace_name
      ON symbol_index(workspace_id, name);
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

  // FTS5 chunk index — populated alongside chunk_embeddings for the
  // hybrid retrieval path (BM25 + vector + symbol via RRF). `unicode61`
  // tokeniser handles Korean / mixed-script content; `simple` would
  // drop non-ASCII codepoints. workspace_id is UNINDEXED so it doesn't
  // participate in scoring — we just need it for per-workspace filter.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      workspace_id UNINDEXED,
      path,
      chunk_index UNINDEXED,
      chunk,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  // MCP servers — external Model Context Protocol endpoints the user
  // has registered. The agent can call any tool exposed by a connected
  // server via the `mcp_call` tool. Per-account so each user manages
  // their own credentials; admin can see all via the settings panel.
  //
  // v1 transport is "stdio" only — `command` is the binary to spawn
  // (e.g. `npx`), `args_json` is the JSON-encoded argv tail
  // (e.g. `["-y", "@modelcontextprotocol/server-filesystem", "/path"]`).
  // HTTP/SSE transport is on the roadmap; the table already has a
  // `transport` column so adding it later is non-breaking.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      transport   TEXT NOT NULL DEFAULT 'stdio',
      command     TEXT NOT NULL,
      args_json   TEXT NOT NULL DEFAULT '[]',
      env_json    TEXT NOT NULL DEFAULT '{}',
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_by  TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_created_by
      ON mcp_servers(created_by);
  `);

  // Guarded ALTER TABLE blocks. Each `addColumn(...)` is a no-op if the
  // column already exists on the table; SQLite has no IF NOT EXISTS for
  // ADD COLUMN, so we PRAGMA-introspect once per table and reuse the
  // cached column list for every column on that table.
  // Skills extension: variables (JSON), description, category. Null on rows
  // from before this migration; built-in skills set them at startup.
  const skills = addColumnIfMissing(db, "skills");
  skills("variables_json", "TEXT");
  skills("description", "TEXT");
  skills("category", "TEXT");
  // workspace_id (NULL → account-global skill; set → scoped to one workspace)
  skills("workspace_id", "TEXT");

  const chatMessages = addColumnIfMissing(db, "chat_messages");
  chatMessages("agent_json", "TEXT");
  // revisions_json — past versions of a user message's content, retained
  // when the message was edited.
  chatMessages("revisions_json", "TEXT");
  // provider + model — which provider/model produced this assistant message.
  // Null for user messages and for assistant messages from before this
  // metadata was tracked.
  chatMessages("provider", "TEXT");
  chatMessages("model", "TEXT");
  // images_json — image-search results rendered as a thumbnail grid, when the
  // message asked to find images. Null on every other message.
  chatMessages("images_json", "TEXT");

  const workspaces = addColumnIfMissing(db, "workspaces");
  workspaces("created_by", "TEXT");
  // visibility (NULL → "private"), category (NULL → all templates)
  workspaces("visibility", "TEXT");
  workspaces("category", "TEXT");
  // home_view (NULL → tabbed overview; "surface" → immersive custom screen)
  workspaces("home_view", "TEXT");
  // Per-workspace model override (NULL → inherit the account-global default)
  workspaces("default_provider", "TEXT");
  workspaces("default_model", "TEXT");
  // default_skill_id (NULL → none; set → skill pre-filled into the composer
  // when starting a new chat in this workspace)
  workspaces("default_skill_id", "TEXT");
  // sort_order (NULL → fall back to creation order; set → manual drag-reorder)
  workspaces("sort_order", "REAL");

  // chats gain sort_order for manual drag-reorder (NULL → recency fallback).
  const chats = addColumnIfMissing(db, "chats");
  chats("sort_order", "REAL");

  const runs = addColumnIfMissing(db, "runs");
  runs("created_by", "TEXT");
  runs("usage_json", "TEXT");
  // kind (NULL → "template")
  runs("kind", "TEXT");
  runs("block_results_json", "TEXT");

  const accounts = addColumnIfMissing(db, "accounts");
  accounts("locale", "TEXT");
  // mode (NULL → "standard")
  accounts("mode", "TEXT");
  accounts("context", "TEXT");
  accounts("context_updated_at", "TEXT");

  // usage_events gains account_id so per-account token limits can sum a window
  // directly instead of a fragile JOIN through runs / chat_messages. NULL on
  // rows from before this migration (and on usage not attributed to an account).
  const usageEvents = addColumnIfMissing(db, "usage_events");
  usageEvents("account_id", "TEXT");
  // workspace_id so per-workspace token usage is a direct SUM, not a JOIN
  // through run_id (which is a run id for runs but a message id for chats).
  // Recorded at the metering wrapper going forward; one-time backfill below.
  const usageHadWorkspace = (
    db.prepare("PRAGMA table_info(usage_events)").all() as Array<{ name: string }>
  ).some((c) => c.name === "workspace_id");
  usageEvents("workspace_id", "TEXT");
  if (!usageHadWorkspace) {
    // Recover historical attribution: run usage keys off a run id, chat usage
    // off the assistant message id. Orphaned events (deleted message/run) stay
    // NULL. Runs once, when the column is first added.
    db.exec(
      `UPDATE usage_events SET workspace_id =
         (SELECT r.workspace_id FROM runs r WHERE r.id = usage_events.run_id)
       WHERE workspace_id IS NULL AND run_id IN (SELECT id FROM runs)`,
    );
    db.exec(
      `UPDATE usage_events SET workspace_id =
         (SELECT c.workspace_id FROM chat_messages m JOIN chats c ON c.id = m.chat_id
          WHERE m.id = usage_events.run_id)
       WHERE workspace_id IS NULL AND run_id IN (SELECT id FROM chat_messages)`,
    );
  }

  const reports = addColumnIfMissing(db, "reports");
  reports("attachments_json", "TEXT NOT NULL DEFAULT '[]'");

  // symbol_index extended with the tree-sitter shape. All four columns
  // are NULL for regex-extracted rows; only the tree-sitter provider
  // fills them in.
  const symbolIndex = addColumnIfMissing(db, "symbol_index");
  symbolIndex("end_line", "INTEGER");
  symbolIndex("parent", "TEXT");
  symbolIndex("signature", "TEXT");
  symbolIndex("exported", "INTEGER");

  // chunk_embeddings: file_hash for incremental indexing. mtime is the
  // cheap pre-check, hash is truth. NULL on rows from before this
  // migration — those count as "unknown content" and get re-embedded
  // on the next scan, which is the safe default.
  const chunkEmb = addColumnIfMissing(db, "chunk_embeddings");
  chunkEmb("file_hash", "TEXT");

  // Path-scoped index — incremental indexing wants to enumerate "all
  // rows for workspace X / path Y" cheaply (per-file invalidation).
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_workspace_path
      ON chunk_embeddings(workspace_id, path);
  `);
}

/**
 * Returns a function that adds a column to `table` if it doesn't already
 * exist. Reads PRAGMA once at the call site (so 4 columns on one table
 * still mean 1 PRAGMA read, matching the previous hand-rolled pattern).
 * Table and column names are template-literal'd into the SQL — only
 * call this with hardcoded identifiers from migration code, never with
 * untrusted input.
 */
function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
): (column: string, decl: string) => void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return (column, decl) => {
    if (cols.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    // Keep the cache fresh in case the caller adds two columns with the
    // same name (idempotent without re-reading PRAGMA).
    cols.push({ name: column });
  };
}
