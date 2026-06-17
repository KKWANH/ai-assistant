import type { DatabaseSync } from "node:sqlite";
import type {
  Workspace,
  WorkspaceVisibility,
  Snapshot,
  Run,
  RunUsage,
  BlockResult,
  Claim,
  Settings,
  EvidencePack,
  UsageSummary,
  UsageSummaryByModel,
  Chat,
  ChatMessage,
  ChatAttachment,
  SearchResult,
  AgentTrace,
  Report,
  ReportType,
  ReportStatus,
  ReportTriage,
  Skill,
  ActionSchedule,
  ActionTrigger,
  Alert,
  ScheduleFrequency,
  AgentAttempt,
  AttemptStatus,
} from "@ariadne/shared";
import { getDb } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// JSON column deserialisation. Hardened (BD1): a single malformed value
// — partial write, hand-edit, botched migration, disk corruption — must
// NOT crash the request handler. `fallback` is exactly the "couldn't
// read a value" answer; parse failures degrade to it and warn-log so
// corruption stays visible rather than silently swallowed. The db layer
// keeps no logger dependency (avoids a circular import with services
// that import repo) — console.warn is the dependency-free choice here.
function j<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch (err) {
    console.warn(`[repo] malformed JSON column — using fallback: ${String(err)} | sample: ${v.slice(0, 80)}`);
    return fallback;
  }
}

/** j() for the raw `JSON.parse(row[...] as string)` sites that pass an
 *  `unknown` value. Same corruption-safe contract — never throws. */
function safeJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch (err) {
    console.warn(`[repo] malformed JSON column — using fallback: ${String(err)} | sample: ${v.slice(0, 80)}`);
    return fallback;
  }
}

/**
 * Wrap a synchronous block in a SQLite transaction. The big payoff is
 * for bulk inserts — without `BEGIN..COMMIT`, every `stmt.run()` is its
 * own auto-commit and the WAL takes a write per row. Hundreds of rows
 * collapse from hundreds of round-trips to one. Rolls back and rethrows
 * on any error so partial writes don't land.
 */
function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const WORKSPACE_SELECT = `
  SELECT w.*, a.display_name AS created_by_name
  FROM workspaces w
  LEFT JOIN accounts a ON a.id = w.created_by
`;

export function dbInsertWorkspace(w: Workspace): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO workspaces (id,name,root_path,include_globs,exclude_globs,created_at,last_scan_at,file_count,created_by,visibility,category,home_view,default_provider,default_model,default_skill_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    w.id,
    w.name,
    w.rootPath,
    JSON.stringify(w.include),
    JSON.stringify(w.exclude),
    w.createdAt,
    w.lastScanAt,
    w.fileCount,
    w.createdBy ?? null,
    w.visibility ?? "private",
    w.category ?? null,
    w.homeView ?? null,
    w.defaultProvider ?? null,
    w.defaultModel ?? null,
    w.defaultSkillId ?? null
  );
}

export function dbGetWorkspace(id: string): Workspace | null {
  const db = getDb();
  const row = db
    .prepare(`${WORKSPACE_SELECT} WHERE w.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToWorkspace(row);
}

export function dbListWorkspaces(): Workspace[] {
  const db = getDb();
  const rows = db.prepare(`${WORKSPACE_SELECT} ORDER BY w.created_at DESC`).all() as Record<string, unknown>[];
  return rows.map(rowToWorkspace);
}

export function dbUpdateWorkspace(id: string, fields: Partial<Workspace>): Workspace | null {
  const db = getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (fields.name !== undefined) { sets.push("name = ?"); vals.push(fields.name); }
  if (fields.include !== undefined) { sets.push("include_globs = ?"); vals.push(JSON.stringify(fields.include)); }
  if (fields.exclude !== undefined) { sets.push("exclude_globs = ?"); vals.push(JSON.stringify(fields.exclude)); }
  if (fields.lastScanAt !== undefined) { sets.push("last_scan_at = ?"); vals.push(fields.lastScanAt); }
  if (fields.fileCount !== undefined) { sets.push("file_count = ?"); vals.push(fields.fileCount); }
  if (fields.visibility !== undefined) { sets.push("visibility = ?"); vals.push(fields.visibility); }
  if (fields.category !== undefined) { sets.push("category = ?"); vals.push(fields.category); }
  if (fields.homeView !== undefined) { sets.push("home_view = ?"); vals.push(fields.homeView); }
  if (fields.defaultProvider !== undefined) { sets.push("default_provider = ?"); vals.push(fields.defaultProvider ?? null); }
  if (fields.defaultModel !== undefined) { sets.push("default_model = ?"); vals.push(fields.defaultModel ?? null); }
  if (fields.defaultSkillId !== undefined) { sets.push("default_skill_id = ?"); vals.push(fields.defaultSkillId ?? null); }
  // rootPath is intentionally NOT exposed via the public PATCH route
  // (UpdateWorkspaceSchema doesn't list it) — repointing has snapshot/
  // index implications and shouldn't be a casual user action. It IS
  // exposed at the repo layer so internal migrations (demo-portfolio/ →
  // portfolio/, in AG) can repoint on boot.
  if (fields.rootPath !== undefined) { sets.push("root_path = ?"); vals.push(fields.rootPath); }

  if (sets.length === 0) return dbGetWorkspace(id);
  vals.push(id);
  db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return dbGetWorkspace(id);
}

/** Delete a workspace and all of its derived rows (snapshots, runs, claims, index). */
export function dbDeleteWorkspace(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM claims WHERE run_id IN (SELECT id FROM runs WHERE workspace_id = ?)").run(id);
  db.prepare("DELETE FROM runs WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM snapshots WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM file_index WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    rootPath: row["root_path"] as string,
    include: j<string[]>(row["include_globs"] as string, []),
    exclude: j<string[]>(row["exclude_globs"] as string, []),
    createdAt: row["created_at"] as string,
    lastScanAt: (row["last_scan_at"] as string | null) ?? null,
    fileCount: row["file_count"] as number,
    createdBy: (row["created_by"] as string | null) ?? null,
    createdByName: (row["created_by_name"] as string | null) ?? null,
    visibility: ((row["visibility"] as string | null) ?? "private") as WorkspaceVisibility,
    category: (row["category"] as string | null) ?? null,
    homeView: (row["home_view"] as string | null ?? null) as Workspace["homeView"],
    defaultProvider: (row["default_provider"] as string | null ?? null) as Workspace["defaultProvider"],
    defaultModel: (row["default_model"] as string | null) ?? null,
    defaultSkillId: (row["default_skill_id"] as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export function dbInsertSnapshot(s: Snapshot): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO snapshots (id,workspace_id,created_at,file_count,ignored_count,sensitive_count,total_estimated_tokens,files_json)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    s.id,
    s.workspaceId,
    s.createdAt,
    s.fileCount,
    s.ignoredCount,
    s.sensitiveCount,
    s.totalEstimatedTokens,
    JSON.stringify(s.files)
  );
}

export function dbGetLatestSnapshot(workspaceId: string): Snapshot | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToSnapshot(row);
}

function rowToSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    createdAt: row["created_at"] as string,
    fileCount: row["file_count"] as number,
    ignoredCount: row["ignored_count"] as number,
    sensitiveCount: row["sensitive_count"] as number,
    totalEstimatedTokens: row["total_estimated_tokens"] as number,
    files: j(row["files_json"] as string, []),
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const RUN_SELECT = `
  SELECT r.*, a.display_name AS created_by_name
  FROM runs r
  LEFT JOIN accounts a ON a.id = r.created_by
`;

export function dbInsertRun(r: Run): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (id,workspace_id,template_id,template_name,status,input_json,model,provider,created_at,started_at,completed_at,candidate_files,selected_files,token_estimate,evidence_count,unsupported_count,artifacts_json,trace_json,previous_run_id,error,created_by,kind,block_results_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    r.id, r.workspaceId, r.templateId, r.templateName, r.status,
    JSON.stringify(r.input), r.model, r.provider,
    r.createdAt, r.startedAt, r.completedAt,
    JSON.stringify(r.candidateFiles), JSON.stringify(r.selectedFiles),
    r.tokenEstimate, r.evidenceCount, r.unsupportedCount,
    JSON.stringify(r.artifacts), JSON.stringify(r.trace),
    r.previousRunId, r.error,
    r.createdBy ?? null,
    r.kind, JSON.stringify(r.blockResults)
  );
}

export function dbGetRun(id: string): Run | null {
  const db = getDb();
  const row = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToRun(row);
}

export function dbListRuns(workspaceId?: string): Run[] {
  const db = getDb();
  const rows = workspaceId
    ? db.prepare(`${RUN_SELECT} WHERE r.workspace_id = ? ORDER BY r.created_at DESC`).all(workspaceId) as Record<string, unknown>[]
    : db.prepare(`${RUN_SELECT} ORDER BY r.created_at DESC`).all() as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function dbUpdateRun(id: string, fields: Partial<Run>): Run | null {
  const db = getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
  if (fields.startedAt !== undefined) { sets.push("started_at = ?"); vals.push(fields.startedAt); }
  if (fields.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(fields.completedAt); }
  if (fields.candidateFiles !== undefined) { sets.push("candidate_files = ?"); vals.push(JSON.stringify(fields.candidateFiles)); }
  if (fields.selectedFiles !== undefined) { sets.push("selected_files = ?"); vals.push(JSON.stringify(fields.selectedFiles)); }
  if (fields.tokenEstimate !== undefined) { sets.push("token_estimate = ?"); vals.push(fields.tokenEstimate); }
  if (fields.evidenceCount !== undefined) { sets.push("evidence_count = ?"); vals.push(fields.evidenceCount); }
  if (fields.unsupportedCount !== undefined) { sets.push("unsupported_count = ?"); vals.push(fields.unsupportedCount); }
  if (fields.artifacts !== undefined) { sets.push("artifacts_json = ?"); vals.push(JSON.stringify(fields.artifacts)); }
  if (fields.trace !== undefined) { sets.push("trace_json = ?"); vals.push(JSON.stringify(fields.trace)); }
  if (fields.error !== undefined) { sets.push("error = ?"); vals.push(fields.error); }
  if (fields.usage !== undefined) { sets.push("usage_json = ?"); vals.push(fields.usage ? JSON.stringify(fields.usage) : null); }
  if (fields.blockResults !== undefined) { sets.push("block_results_json = ?"); vals.push(JSON.stringify(fields.blockResults)); }

  if (sets.length === 0) return dbGetRun(id);
  vals.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return dbGetRun(id);
}

function rowToRun(row: Record<string, unknown>): Run {
  const usage = safeJson<RunUsage | null>(row["usage_json"], null);
  const blockResults = safeJson<BlockResult[]>(row["block_results_json"], []);
  return {
    id: row["id"] as string,
    kind: ((row["kind"] as string | null) ?? "template") as Run["kind"],
    workspaceId: row["workspace_id"] as string,
    templateId: row["template_id"] as string,
    templateName: row["template_name"] as string,
    status: row["status"] as Run["status"],
    input: j(row["input_json"] as string, {}),
    model: row["model"] as string,
    provider: row["provider"] as Run["provider"],
    createdAt: row["created_at"] as string,
    startedAt: (row["started_at"] as string | null) ?? null,
    completedAt: (row["completed_at"] as string | null) ?? null,
    candidateFiles: j(row["candidate_files"] as string, []),
    selectedFiles: j(row["selected_files"] as string, []),
    tokenEstimate: row["token_estimate"] as number,
    evidenceCount: row["evidence_count"] as number,
    unsupportedCount: row["unsupported_count"] as number,
    artifacts: j(row["artifacts_json"] as string, {}),
    trace: j(row["trace_json"] as string, []),
    previousRunId: (row["previous_run_id"] as string | null) ?? null,
    error: (row["error"] as string | null) ?? null,
    createdBy: (row["created_by"] as string | null) ?? null,
    createdByName: (row["created_by_name"] as string | null) ?? null,
    usage,
    blockResults,
  };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export function dbInsertClaims(claims: Claim[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO claims (id,run_id,text,status,sources_json,reason,missing_evidence,suggested_source_type,conservative_rewrite)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  for (const c of claims) {
    stmt.run(
      c.id, c.runId, c.text, c.status, JSON.stringify(c.sources),
      c.reason ?? null, c.missingEvidence ?? null,
      c.suggestedSourceType ?? null, c.conservativeRewrite ?? null
    );
  }
}

export function dbGetEvidencePack(runId: string): EvidencePack {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM claims WHERE run_id = ?").all(runId) as Record<string, unknown>[];
  return {
    runId,
    claims: rows.map((row) => ({
      id: row["id"] as string,
      runId: row["run_id"] as string,
      text: row["text"] as string,
      status: row["status"] as Claim["status"],
      sources: j(row["sources_json"] as string, []),
      reason: (row["reason"] as string | null) ?? undefined,
      missingEvidence: (row["missing_evidence"] as string | null) ?? undefined,
      suggestedSourceType: (row["suggested_source_type"] as string | null) ?? undefined,
      conservativeRewrite: (row["conservative_rewrite"] as string | null) ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function dbGetSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function dbSetSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

// ---------------------------------------------------------------------------
// Usage events
// ---------------------------------------------------------------------------

export interface UsageEventRow {
  id: string;
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Account the usage is attributed to (for per-account limits). */
  accountId?: string | null;
  createdAt: string;
}

export function dbInsertUsageEvent(e: UsageEventRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO usage_events (id,run_id,provider,model,input_tokens,output_tokens,cost_usd,account_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    e.id, e.runId, e.provider, e.model,
    e.inputTokens, e.outputTokens, e.costUsd, e.accountId ?? null, e.createdAt
  );
}

export function dbGetRunUsage(runId: string): RunUsage {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
     FROM usage_events WHERE run_id = ?`
  ).get(runId) as { input_tokens: number; output_tokens: number; cost_usd: number } | undefined;
  return {
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    costUsd: row?.cost_usd ?? 0,
  };
}

export function dbGetTotalUsage(): UsageSummary {
  const db = getDb();

  const totalRow = db.prepare(
    `SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
     FROM usage_events`
  ).get() as { input_tokens: number; output_tokens: number; cost_usd: number } | undefined;

  const byModelRows = db.prepare(
    `SELECT provider, model,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd,
            COUNT(DISTINCT run_id) AS runs
     FROM usage_events
     GROUP BY provider, model
     ORDER BY cost_usd DESC`
  ).all() as Array<{ provider: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number; runs: number }>;

  const byModel: UsageSummaryByModel[] = byModelRows.map((r) => ({
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    runs: r.runs,
  }));

  return {
    total: {
      inputTokens: totalRow?.input_tokens ?? 0,
      outputTokens: totalRow?.output_tokens ?? 0,
      costUsd: totalRow?.cost_usd ?? 0,
    },
    byModel,
  };
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export function dbCreateChat(c: Chat): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO chats (id, title, workspace_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(c.id, c.title, c.workspaceId ?? null, c.createdBy ?? null, c.createdAt, c.updatedAt);
}

const CHAT_SELECT = `
  SELECT c.*, a.display_name AS created_by_name
  FROM chats c
  LEFT JOIN accounts a ON a.id = c.created_by
`;

export function dbListChats(): Chat[] {
  const db = getDb();
  const rows = db
    .prepare(`${CHAT_SELECT} ORDER BY c.updated_at DESC`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToChat);
}

export function dbGetChat(id: string): Chat | null {
  const db = getDb();
  const row = db.prepare(`${CHAT_SELECT} WHERE c.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const chat = rowToChat(row);
  chat.messages = dbListMessages(id);
  return chat;
}

/** Just the ownership fields — for guards that don't need the messages (the
 *  /active endpoint is polled every 2s). Avoids the full message load +
 *  per-row JSON.parse that dbGetChat does. */
export function dbGetChatMeta(id: string): { id: string; createdBy: string | null } | null {
  const db = getDb();
  const row = db.prepare("SELECT id, created_by FROM chats WHERE id = ?").get(id) as
    | { id: string; created_by: string | null }
    | undefined;
  return row ? { id: row.id, createdBy: row.created_by } : null;
}

export function dbUpdateChat(
  id: string,
  fields: { title?: string; workspaceId?: string | null; updatedAt: string }
): Chat | null {
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const vals: (string | null)[] = [fields.updatedAt];

  if (fields.title !== undefined) {
    sets.push("title = ?");
    vals.push(fields.title);
  }
  if (fields.workspaceId !== undefined) {
    sets.push("workspace_id = ?");
    vals.push(fields.workspaceId);
  }

  vals.push(id);
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return dbGetChat(id);
}

export function dbDeleteChat(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_messages WHERE chat_id = ?").run(id);
  db.prepare("DELETE FROM chats WHERE id = ?").run(id);
}

/** AT/AU — Bulk-delete chats with zero messages, optionally scoped to a
 *  single owner and to chats older than N hours. Used by the background
 *  auto-cleanup that runs on app mount. Returns the number of deleted
 *  chats so the caller can log it. */
export function dbDeleteEmptyChats(ownerId: string | null, olderThanHours = 0): number {
  const db = getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (ownerId) {
    where.push("c.created_by = ?");
    args.push(ownerId);
  }
  if (olderThanHours > 0) {
    // SQLite stores timestamps as ISO strings; compare against
    // (now - olderThanHours) computed in JS so we don't depend on
    // strftime quirks.
    const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
    where.push("c.created_at < ?");
    args.push(cutoff);
  }
  const whereSql = where.length > 0 ? "AND " + where.join(" AND ") : "";
  const rows = db.prepare(
    `SELECT c.id FROM chats c
     WHERE NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.chat_id = c.id)
     ${whereSql}`,
  ).all(...args) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  // Single transaction so a long list doesn't half-delete on error.
  withTransaction(() => {
    const del = db.prepare("DELETE FROM chats WHERE id = ?");
    for (const id of ids) del.run(id);
  });
  return ids.length;
}

function rowToChat(row: Record<string, unknown>): Chat {
  return {
    id: row["id"] as string,
    title: row["title"] as string,
    workspaceId: (row["workspace_id"] as string | null) ?? null,
    createdBy: (row["created_by"] as string | null) ?? null,
    createdByName: (row["created_by_name"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

export function dbInsertMessage(m: ChatMessage): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO chat_messages
       (id, chat_id, role, content, attachments_json, web_search, search_results_json,
        agent_json, revisions_json, provider, model, images_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.id,
    m.chatId,
    m.role,
    m.content,
    JSON.stringify(m.attachments),
    m.webSearch ? 1 : 0,
    m.searchResults ? JSON.stringify(m.searchResults) : null,
    m.agent ? JSON.stringify(m.agent) : null,
    m.revisions && m.revisions.length > 0 ? JSON.stringify(m.revisions) : null,
    m.provider ?? null,
    m.model ?? null,
    m.images && m.images.length > 0 ? JSON.stringify(m.images) : null,
    m.createdAt
  );
}

export function dbGetMessage(messageId: string): ChatMessage | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM chat_messages WHERE id = ?")
    .get(messageId) as Record<string, unknown> | undefined;
  return row ? rowToMessage(row) : null;
}

/**
 * Update a message's content, recording the prior content in its
 * revisions log. Used by the edit-and-regenerate flow. Returns the
 * updated message, or null if it doesn't exist.
 */
export function dbEditMessageContent(
  messageId: string,
  newContent: string,
  editedAt: string,
): ChatMessage | null {
  const existing = dbGetMessage(messageId);
  if (!existing) return null;
  const revisions: import("@ariadne/shared").MessageRevision[] = [
    ...(existing.revisions ?? []),
    { content: existing.content, editedAt },
  ];
  const db = getDb();
  db.prepare(
    "UPDATE chat_messages SET content = ?, revisions_json = ? WHERE id = ?",
  ).run(newContent, JSON.stringify(revisions), messageId);
  return { ...existing, content: newContent, revisions };
}

/**
 * Delete every message in the chat with `created_at` strictly later than
 * the given message. Used by the edit-and-regenerate flow — the old
 * assistant reply (and any turns after it) become stale when the user
 * edits the question.
 */
export function dbDeleteMessagesAfter(chatId: string, messageId: string): number {
  const target = dbGetMessage(messageId);
  if (!target || target.chatId !== chatId) return 0;
  const db = getDb();
  // `> ?` not `>= ?` — the edited user message itself stays put.
  const res = db
    .prepare("DELETE FROM chat_messages WHERE chat_id = ? AND created_at > ?")
    .run(chatId, target.createdAt);
  return Number(res.changes ?? 0);
}

export function dbListMessages(chatId: string): ChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  const revisions = j<import("@ariadne/shared").MessageRevision[]>(
    row["revisions_json"] as string | null,
    [],
  );
  return {
    id: row["id"] as string,
    chatId: row["chat_id"] as string,
    role: row["role"] as "user" | "assistant",
    content: row["content"] as string,
    attachments: j<ChatAttachment[]>(row["attachments_json"] as string | null, []),
    webSearch: Boolean(row["web_search"]),
    searchResults: j<SearchResult[] | null>(row["search_results_json"] as string | null, null),
    images: j<import("@ariadne/shared").ImageResult[] | null>(row["images_json"] as string | null, null),
    agent: j<AgentTrace | null>(row["agent_json"] as string | null, null),
    provider: (row["provider"] as string | null) ?? null,
    model: (row["model"] as string | null) ?? null,
    revisions: revisions && revisions.length > 0 ? revisions : undefined,
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const REPORT_SELECT = `
  SELECT r.*, a.display_name AS created_by_name
  FROM reports r
  LEFT JOIN accounts a ON a.id = r.created_by
`;

export function dbInsertReport(r: Report): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO reports (id,type,title,description,created_by,created_at,status,attachments_json)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    r.id, r.type, r.title, r.description, r.createdBy ?? null, r.createdAt, r.status,
    JSON.stringify(r.attachments),
  );
}

export function dbListReports(status?: ReportStatus): Report[] {
  const db = getDb();
  const rows = status
    ? (db.prepare(`${REPORT_SELECT} WHERE r.status = ? ORDER BY r.created_at DESC`).all(status) as Record<string, unknown>[])
    : (db.prepare(`${REPORT_SELECT} ORDER BY r.created_at DESC`).all() as Record<string, unknown>[]);
  return rows.map(rowToReport);
}

export function dbGetReport(id: string): Report | null {
  const db = getDb();
  const row = db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToReport(row);
}

export function dbSetReportTriage(id: string, triage: ReportTriage, triagedAt: string): void {
  const db = getDb();
  db.prepare("UPDATE reports SET triage_json = ?, triaged_at = ? WHERE id = ?").run(
    JSON.stringify(triage),
    triagedAt,
    id
  );
}

export function dbDecideReport(
  id: string,
  status: "rejected" | "filed",
  decidedBy: string,
  decidedAt: string,
  githubUrl: string | null
): Report | null {
  const db = getDb();
  db.prepare("UPDATE reports SET status = ?, decided_by = ?, decided_at = ?, github_url = ? WHERE id = ?").run(
    status,
    decidedBy,
    decidedAt,
    githubUrl,
    id
  );
  return dbGetReport(id);
}

function rowToReport(row: Record<string, unknown>): Report {
  const triageJson = row["triage_json"] as string | null | undefined;
  return {
    id: row["id"] as string,
    type: row["type"] as ReportType,
    title: row["title"] as string,
    description: row["description"] as string,
    createdBy: (row["created_by"] as string | null) ?? null,
    createdByName: (row["created_by_name"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    status: row["status"] as ReportStatus,
    triage: safeJson<ReportTriage | null>(triageJson, null),
    triagedAt: (row["triaged_at"] as string | null) ?? null,
    decidedBy: (row["decided_by"] as string | null) ?? null,
    decidedAt: (row["decided_at"] as string | null) ?? null,
    githubUrl: (row["github_url"] as string | null) ?? null,
    attachments: j<ChatAttachment[]>(row["attachments_json"] as string | null, []),
  };
}

// ---------------------------------------------------------------------------
// Skills — account-scoped reusable prompt snippets
// ---------------------------------------------------------------------------

/**
 * The account's skills, newest-updated first. With a workspaceId, includes that
 * workspace's scoped skills alongside the account-global ones; without it, only
 * the account-global skills (workspace_id IS NULL).
 */
export function dbListSkills(accountId: string, workspaceId?: string | null): Skill[] {
  const db = getDb();
  const rows = (
    workspaceId
      ? db
          .prepare(
            "SELECT * FROM skills WHERE account_id = ? AND (workspace_id IS NULL OR workspace_id = ?) ORDER BY updated_at DESC",
          )
          .all(accountId, workspaceId)
      : db
          .prepare(
            "SELECT * FROM skills WHERE account_id = ? AND workspace_id IS NULL ORDER BY updated_at DESC",
          )
          .all(accountId)
  ) as Record<string, unknown>[];
  return rows.map(rowToSkill);
}

export function dbGetSkill(id: string): Skill | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM skills WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSkill(row) : null;
}

export function dbInsertSkill(s: Skill): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO skills
       (id, account_id, workspace_id, name, prompt, description, category, variables_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.accountId,
    s.workspaceId ?? null,
    s.name,
    s.prompt,
    s.description ?? null,
    s.category ?? null,
    s.variables ? JSON.stringify(s.variables) : null,
    s.createdAt,
    s.updatedAt,
  );
}

export function dbUpdateSkill(
  id: string,
  patch: {
    name?: string;
    prompt?: string;
    description?: string | null;
    variables?: import("@ariadne/shared").SkillVariable[] | null;
  },
  updatedAt: string,
): Skill | null {
  const existing = dbGetSkill(id);
  if (!existing) return null;
  const next: Skill = {
    ...existing,
    name: patch.name ?? existing.name,
    prompt: patch.prompt ?? existing.prompt,
    description: patch.description === undefined ? existing.description : patch.description ?? undefined,
    variables: patch.variables === undefined ? existing.variables : patch.variables ?? undefined,
    updatedAt,
  };
  const db = getDb();
  db.prepare(
    `UPDATE skills
        SET name = ?, prompt = ?, description = ?, variables_json = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    next.name,
    next.prompt,
    next.description ?? null,
    next.variables ? JSON.stringify(next.variables) : null,
    next.updatedAt,
    id,
  );
  return next;
}

export function dbDeleteSkill(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM skills WHERE id = ?").run(id);
}

function rowToSkill(row: Record<string, unknown>): Skill {
  const variablesRaw = row["variables_json"] as string | null | undefined;
  return {
    id: row["id"] as string,
    accountId: row["account_id"] as string,
    workspaceId: (row["workspace_id"] as string | null) ?? null,
    name: row["name"] as string,
    prompt: row["prompt"] as string,
    description: (row["description"] as string | null) ?? undefined,
    category: (row["category"] as string | null) ?? undefined,
    variables: safeJson<import("@ariadne/shared").SkillVariable[] | undefined>(
      variablesRaw,
      undefined,
    ),
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Action schedules — recurring action runs
// ---------------------------------------------------------------------------

export function dbInsertSchedule(s: ActionSchedule): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO action_schedules
      (id, workspace_id, action_id, account_id, frequency, enabled, last_run_at, next_run_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.workspaceId,
    s.actionId,
    s.accountId,
    s.frequency,
    s.enabled ? 1 : 0,
    s.lastRunAt,
    s.nextRunAt,
    s.createdAt,
  );
}

export function dbGetSchedule(id: string): ActionSchedule | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM action_schedules WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSchedule(row) : null;
}

/** All schedules in the workspace (regardless of enabled / paused). */
export function dbListSchedulesForWorkspace(workspaceId: string): ActionSchedule[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM action_schedules WHERE workspace_id = ? ORDER BY created_at DESC",
    )
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map(rowToSchedule);
}

/** Every schedule that is enabled AND already due — what the scheduler ticks on. */
export function dbListDueSchedules(nowIso: string): ActionSchedule[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM action_schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC",
    )
    .all(nowIso) as Record<string, unknown>[];
  return rows.map(rowToSchedule);
}

export function dbUpdateSchedule(
  id: string,
  patch: { frequency?: ScheduleFrequency; enabled?: boolean; lastRunAt?: string; nextRunAt?: string },
): ActionSchedule | null {
  const existing = dbGetSchedule(id);
  if (!existing) return null;
  const next: ActionSchedule = {
    ...existing,
    frequency: patch.frequency ?? existing.frequency,
    enabled: patch.enabled ?? existing.enabled,
    lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : existing.lastRunAt,
    nextRunAt: patch.nextRunAt ?? existing.nextRunAt,
  };
  const db = getDb();
  db.prepare(
    "UPDATE action_schedules SET frequency = ?, enabled = ?, last_run_at = ?, next_run_at = ? WHERE id = ?",
  ).run(
    next.frequency,
    next.enabled ? 1 : 0,
    next.lastRunAt,
    next.nextRunAt,
    id,
  );
  return next;
}

export function dbDeleteSchedule(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM action_schedules WHERE id = ?").run(id);
}

function rowToSchedule(row: Record<string, unknown>): ActionSchedule {
  return {
    id: row["id"] as string,
    workspaceId: row["workspace_id"] as string,
    actionId: row["action_id"] as string,
    accountId: row["account_id"] as string,
    frequency: row["frequency"] as ScheduleFrequency,
    enabled: Boolean(row["enabled"]),
    lastRunAt: (row["last_run_at"] as string | null) ?? null,
    nextRunAt: row["next_run_at"] as string,
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Action triggers — webhook-fired action runs
// ---------------------------------------------------------------------------

export function dbInsertTrigger(t: ActionTrigger): void {
  getDb()
    .prepare(
      `INSERT INTO action_triggers
        (id, secret, workspace_id, action_id, account_id, last_fired_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.id, t.secret, t.workspaceId, t.actionId, t.accountId, t.lastFiredAt, t.createdAt);
}

export function dbGetTrigger(id: string): ActionTrigger | null {
  const row = getDb()
    .prepare("SELECT * FROM action_triggers WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToTrigger(row) : null;
}

export function dbGetTriggerBySecret(secret: string): ActionTrigger | null {
  const row = getDb()
    .prepare("SELECT * FROM action_triggers WHERE secret = ?")
    .get(secret) as Record<string, unknown> | undefined;
  return row ? rowToTrigger(row) : null;
}

export function dbListTriggersForWorkspace(workspaceId: string): ActionTrigger[] {
  const rows = getDb()
    .prepare("SELECT * FROM action_triggers WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as Record<string, unknown>[];
  return rows.map(rowToTrigger);
}

export function dbTouchTrigger(id: string, firedAt: string): void {
  getDb().prepare("UPDATE action_triggers SET last_fired_at = ? WHERE id = ?").run(firedAt, id);
}

export function dbDeleteTrigger(id: string): void {
  getDb().prepare("DELETE FROM action_triggers WHERE id = ?").run(id);
}

function rowToTrigger(row: Record<string, unknown>): ActionTrigger {
  return {
    id: row["id"] as string,
    secret: row["secret"] as string,
    workspaceId: row["workspace_id"] as string,
    actionId: row["action_id"] as string,
    accountId: row["account_id"] as string,
    lastFiredAt: (row["last_fired_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Account token usage (windowed) + per-account limits
// ---------------------------------------------------------------------------

/** Sum input+output tokens an account used since `sinceIso` (rolling window). */
export function dbGetAccountTokenUsage(accountId: string, sinceIso: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens),0) AS tokens
       FROM usage_events WHERE account_id = ? AND created_at >= ?`,
    )
    .get(accountId, sinceIso) as { tokens: number } | undefined;
  return row?.tokens ?? 0;
}

export function dbGetAccountLimits(
  accountId: string,
): { dailyTokenLimit: number | null; weeklyTokenLimit: number | null } | null {
  const row = getDb()
    .prepare("SELECT daily_token_limit, weekly_token_limit FROM account_limits WHERE account_id = ?")
    .get(accountId) as { daily_token_limit: number | null; weekly_token_limit: number | null } | undefined;
  if (!row) return null;
  return { dailyTokenLimit: row.daily_token_limit ?? null, weeklyTokenLimit: row.weekly_token_limit ?? null };
}

export function dbSetAccountLimits(
  accountId: string,
  dailyTokenLimit: number | null,
  weeklyTokenLimit: number | null,
  createdAt: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO account_limits (account_id, daily_token_limit, weekly_token_limit, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         daily_token_limit = excluded.daily_token_limit,
         weekly_token_limit = excluded.weekly_token_limit`,
    )
    .run(accountId, dailyTokenLimit, weeklyTokenLimit, createdAt);
}

// ---------------------------------------------------------------------------
// Alerts — persisted per-account notifications (the inbox / bell)
// ---------------------------------------------------------------------------

export function dbInsertAlert(a: Alert): void {
  getDb()
    .prepare(
      `INSERT INTO alerts (id, account_id, type, title, body, link, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.id, a.accountId, a.type, a.title, a.body, a.link, a.readAt, a.createdAt);
}

export function dbListAlerts(accountId: string, limit = 50): Alert[] {
  const rows = getDb()
    .prepare("SELECT * FROM alerts WHERE account_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(accountId, limit) as Record<string, unknown>[];
  return rows.map(rowToAlert);
}

export function dbCountUnreadAlerts(accountId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM alerts WHERE account_id = ? AND read_at IS NULL")
    .get(accountId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function dbMarkAlertRead(id: string, accountId: string, readAt: string): void {
  getDb()
    .prepare("UPDATE alerts SET read_at = ? WHERE id = ? AND account_id = ? AND read_at IS NULL")
    .run(readAt, id, accountId);
}

export function dbMarkAllAlertsRead(accountId: string, readAt: string): void {
  getDb()
    .prepare("UPDATE alerts SET read_at = ? WHERE account_id = ? AND read_at IS NULL")
    .run(readAt, accountId);
}

export function dbDeleteAlert(id: string, accountId: string): void {
  getDb().prepare("DELETE FROM alerts WHERE id = ? AND account_id = ?").run(id, accountId);
}

function rowToAlert(row: Record<string, unknown>): Alert {
  return {
    id: row["id"] as string,
    accountId: row["account_id"] as string,
    type: row["type"] as string,
    title: row["title"] as string,
    body: (row["body"] as string | null) ?? null,
    link: (row["link"] as string | null) ?? null,
    readAt: (row["read_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
  };
}

// ---------------------------------------------------------------------------
// Agent attempts — per-chat staging branches
// ---------------------------------------------------------------------------

export function dbInsertAttempt(a: Omit<AgentAttempt, "fileCount">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO agent_attempts
       (id, chat_id, workspace_id, status, created_at, applied_at, abandoned_at, commit_sha)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.chatId, a.workspaceId, a.status,
    a.createdAt, a.appliedAt, a.abandonedAt, a.commitSha,
  );
}

export function dbGetAttempt(id: string): AgentAttempt | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM agent_attempts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToAttempt(row) : null;
}

/** The single open attempt for a chat, if any. */
export function dbGetOpenAttemptForChat(chatId: string): AgentAttempt | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM agent_attempts WHERE chat_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    )
    .get(chatId) as Record<string, unknown> | undefined;
  return row ? rowToAttempt(row) : null;
}

/** All attempts for a chat — newest first. Used by the attempts list page. */
export function dbListAttemptsForChat(chatId: string): AgentAttempt[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM agent_attempts WHERE chat_id = ? ORDER BY created_at DESC",
    )
    .all(chatId) as Record<string, unknown>[];
  return rows.map(rowToAttempt);
}

export function dbUpdateAttempt(
  id: string,
  patch: { status?: AttemptStatus; appliedAt?: string | null; abandonedAt?: string | null; commitSha?: string | null },
): void {
  const existing = dbGetAttempt(id);
  if (!existing) return;
  const next = { ...existing, ...patch };
  const db = getDb();
  db.prepare(
    "UPDATE agent_attempts SET status = ?, applied_at = ?, abandoned_at = ?, commit_sha = ? WHERE id = ?",
  ).run(
    next.status,
    next.appliedAt,
    next.abandonedAt,
    next.commitSha,
    id,
  );
}

function rowToAttempt(row: Record<string, unknown>): AgentAttempt {
  return {
    id: row["id"] as string,
    chatId: row["chat_id"] as string,
    workspaceId: row["workspace_id"] as string,
    status: row["status"] as AttemptStatus,
    fileCount: 0, // populated by the caller after reading the staged manifest
    createdAt: row["created_at"] as string,
    appliedAt: (row["applied_at"] as string | null) ?? null,
    abandonedAt: (row["abandoned_at"] as string | null) ?? null,
    commitSha: (row["commit_sha"] as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Symbol index — regex-extracted code symbols, used for retrieval boosting
// ---------------------------------------------------------------------------

export interface SymbolRow {
  workspaceId: string;
  path: string;
  name: string;
  kind: "function" | "class" | "method" | "const" | "interface" | "type" | "struct" | "enum" | "trait";
  line: number;
  /** Last line of the symbol's range (inclusive). Tree-sitter fills this;
   *  regex extraction leaves it null. */
  endLine?: number | null;
  /** Enclosing scope — e.g. the class name for a method. Null for top-level. */
  parent?: string | null;
  /** Short signature snippet (function header up to body). Null for kinds
   *  where it doesn't apply (const, type alias) or when unavailable. */
  signature?: string | null;
  /** True when the symbol is exported / public at the module level. Null
   *  when the extractor can't tell (regex provider). */
  exported?: boolean | null;
}

/**
 * Per-file extraction shape — same as `SymbolRow` minus the columns the
 * indexer entry point fills in (workspaceId, path). Exported here so
 * the chooser and each provider speak the same type without re-declaring.
 */
export type SymbolDraft = Omit<SymbolRow, "workspaceId" | "path">;

export function dbClearWorkspaceSymbols(workspaceId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM symbol_index WHERE workspace_id = ?").run(workspaceId);
}

export function dbInsertSymbols(rows: SymbolRow[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO symbol_index
       (workspace_id, path, name, kind, line, end_line, parent, signature, exported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Single transaction collapses hundreds of WAL writes into one.
  withTransaction(() => {
    for (const r of rows) {
      stmt.run(
        r.workspaceId,
        r.path,
        r.name,
        r.kind,
        r.line,
        r.endLine ?? null,
        r.parent ?? null,
        r.signature ?? null,
        r.exported == null ? null : r.exported ? 1 : 0,
      );
    }
  });
}

/** Find file paths whose symbols match any of the query terms. Used by
 *  the retriever to nudge those chunks' scores. */
export function dbLookupSymbolMatches(
  workspaceId: string,
  terms: string[],
): { name: string; path: string }[] {
  if (terms.length === 0) return [];
  const db = getDb();
  // Case-insensitive prefix match — generous so a query for "Holdings"
  // also picks up `HoldingsTable`, `holdings_csv` etc.
  const placeholders = terms.map(() => "LOWER(name) LIKE ?").join(" OR ");
  const stmt = db.prepare(
    `SELECT DISTINCT name, path FROM symbol_index
       WHERE workspace_id = ? AND (${placeholders})`,
  );
  return stmt.all(workspaceId, ...terms.map((t) => `${t.toLowerCase()}%`)) as {
    name: string;
    path: string;
  }[];
}

// ---------------------------------------------------------------------------
// Chunk embeddings — semantic-search index over workspace files
// ---------------------------------------------------------------------------

export interface ChunkEmbeddingRow {
  id: string;
  workspaceId: string;
  provider: string;
  dimensions: number;
  path: string;
  chunk: string;
  chunkIndex: number;
  fileMtime: number;
  /** SHA-256 hex of the file content (after the read-budget truncate).
   *  Used by incremental indexing — mtime is a cheap pre-check, hash
   *  is truth. Nullable on rows from before the migration. */
  fileHash?: string | null;
  embedding: Float32Array;
  indexedAt: string;
}

/** Wipe the workspace's embedding index — called before a fresh reindex. */
export function dbClearWorkspaceEmbeddings(workspaceId: string): void {
  const db = getDb();
  // Clear both the vector store AND the FTS5 mirror in one transaction —
  // hybrid retrieval breaks badly if these drift out of sync.
  withTransaction(() => {
    db.prepare("DELETE FROM chunk_embeddings WHERE workspace_id = ?").run(workspaceId);
    db.prepare("DELETE FROM chunk_fts WHERE workspace_id = ?").run(workspaceId);
  });
}

/** Bulk-insert chunks for one workspace. Caller passes a Float32Array
 *  per row; we store it as a BLOB. The same chunks are mirrored into
 *  the FTS5 table so the hybrid path's BM25 leg can search them. */
export function dbInsertChunkEmbeddings(rows: ChunkEmbeddingRow[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const embStmt = db.prepare(
    `INSERT INTO chunk_embeddings
       (id, workspace_id, provider, dimensions, path, chunk, chunk_index,
        file_mtime, file_hash, embedding, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(
    `INSERT INTO chunk_fts (workspace_id, path, chunk_index, chunk)
     VALUES (?, ?, ?, ?)`,
  );
  // One transaction collapses hundreds of WAL writes into one.
  withTransaction(() => {
    for (const r of rows) {
      embStmt.run(
        r.id,
        r.workspaceId,
        r.provider,
        r.dimensions,
        r.path,
        r.chunk,
        r.chunkIndex,
        r.fileMtime,
        r.fileHash ?? null,
        // node:sqlite accepts Buffer / Uint8Array for BLOB.
        Buffer.from(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength),
        r.indexedAt,
      );
      ftsStmt.run(r.workspaceId, r.path, r.chunkIndex, r.chunk);
    }
  });
}

/**
 * Delete all chunk rows for `paths` within a workspace — both the
 * embedding rows AND the FTS5 mirror. Used by the incremental indexer
 * to invalidate a single file's chunks before re-embedding, or to
 * drop rows for files that no longer exist on disk.
 */
export function dbDeleteChunksByPath(workspaceId: string, paths: string[]): void {
  if (paths.length === 0) return;
  const db = getDb();
  const placeholders = paths.map(() => "?").join(",");
  withTransaction(() => {
    db.prepare(
      `DELETE FROM chunk_embeddings WHERE workspace_id = ? AND path IN (${placeholders})`,
    ).run(workspaceId, ...paths);
    db.prepare(
      `DELETE FROM chunk_fts WHERE workspace_id = ? AND path IN (${placeholders})`,
    ).run(workspaceId, ...paths);
  });
}

/**
 * Return per-path mtime + hash for what's currently stored — enough
 * to decide which files are unchanged. Returns one row per path
 * (the indexer writes the same mtime/hash to every chunk of a file,
 * so MIN+MAX collapse to a single value).
 */
export function dbListChunkPathDigests(
  workspaceId: string,
): Map<string, { mtime: number; hash: string | null }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT path,
              MAX(file_mtime) AS file_mtime,
              MAX(file_hash)  AS file_hash
         FROM chunk_embeddings
        WHERE workspace_id = ?
        GROUP BY path`,
    )
    .all(workspaceId) as Array<{ path: string; file_mtime: number; file_hash: string | null }>;
  const out = new Map<string, { mtime: number; hash: string | null }>();
  for (const r of rows) {
    out.set(r.path, { mtime: r.file_mtime, hash: r.file_hash });
  }
  return out;
}

/**
 * BM25 search via the chunk_fts virtual table. Returns top-k chunks
 * for `workspaceId` ranked by FTS5's built-in bm25 (smaller = better).
 * Sanitises the query so FTS5 operators (`"` `*` `:` `(` `)` `-`) in
 * a user string don't blow up the parser.
 *
 * Returns `[]` for unrecoverable queries (only operator chars left
 * after sanitisation, or no FTS rows for the workspace).
 */
export function dbBm25Search(
  workspaceId: string,
  query: string,
  topK: number,
): Array<{ path: string; chunkIndex: number; chunk: string; score: number }> {
  // Strip FTS5 special characters; keep CJK + ASCII alphanumerics +
  // spaces. Empty query after sanitisation → no rows.
  const cleaned = query
    .replace(/["*:()\-+~^]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`)
    .join(" OR ");
  if (!cleaned) return [];

  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT path, chunk_index, chunk, bm25(chunk_fts) AS score
           FROM chunk_fts
          WHERE workspace_id = ? AND chunk_fts MATCH ?
          ORDER BY score
          LIMIT ?`,
      )
      .all(workspaceId, cleaned, topK) as Array<{
      path: string;
      chunk_index: number;
      chunk: string;
      score: number;
    }>;
    return rows.map((r) => ({
      path: r.path,
      chunkIndex: r.chunk_index,
      chunk: r.chunk,
      score: r.score,
    }));
  } catch {
    // FTS5 throws on a few exotic queries (e.g. all-operator strings
    // that survive sanitisation). Treat as zero-result rather than
    // crashing the request.
    return [];
  }
}

export interface StoredChunk {
  id: string;
  path: string;
  chunk: string;
  embedding: Float32Array;
  /** Provider + dimensions of THIS row — caller checks against the
   *  query's provider before scoring (mismatch ⇒ reindex needed). */
  provider: string;
  dimensions: number;
}

export function dbListWorkspaceChunks(workspaceId: string): StoredChunk[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, path, chunk, embedding, provider, dimensions
         FROM chunk_embeddings WHERE workspace_id = ?`,
    )
    .all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    // SQLite returns BLOB as Uint8Array. Reuse the underlying buffer so
    // we don't pay an O(n) copy per row.
    const buf = row["embedding"] as Uint8Array;
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    return {
      id: row["id"] as string,
      path: row["path"] as string,
      chunk: row["chunk"] as string,
      embedding: f32,
      provider: row["provider"] as string,
      dimensions: row["dimensions"] as number,
    };
  });
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

import type { McpServer } from "@ariadne/shared";

function rowToMcpServer(row: Record<string, unknown>): McpServer {
  // env_json / args_json shape is enforced on insert. Parse defensively
  // — corrupt rows shouldn't crash the listing endpoint.
  let args: string[] = [];
  let env: Record<string, string> = {};
  try {
    const parsedArgs = JSON.parse((row["args_json"] as string) ?? "[]") as unknown;
    if (Array.isArray(parsedArgs)) args = parsedArgs.map((s) => String(s));
  } catch { /* keep default */ }
  try {
    const parsedEnv = JSON.parse((row["env_json"] as string) ?? "{}") as unknown;
    if (parsedEnv && typeof parsedEnv === "object" && !Array.isArray(parsedEnv)) {
      env = Object.fromEntries(
        Object.entries(parsedEnv as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }
  } catch { /* keep default */ }
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    transport: (row["transport"] as McpServer["transport"]) ?? "stdio",
    command: row["command"] as string,
    args,
    env,
    enabled: Number(row["enabled"]) === 1,
    createdBy: (row["created_by"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
  };
}

export function dbInsertMcpServer(s: McpServer): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO mcp_servers
       (id, name, transport, command, args_json, env_json, enabled, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.name,
    s.transport,
    s.command,
    JSON.stringify(s.args),
    JSON.stringify(s.env),
    s.enabled ? 1 : 0,
    s.createdBy,
    s.createdAt,
  );
}

export function dbGetMcpServer(id: string): McpServer | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mcp_servers WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToMcpServer(row) : null;
}

export function dbListMcpServers(createdBy?: string): McpServer[] {
  const db = getDb();
  const rows = createdBy
    ? (db.prepare("SELECT * FROM mcp_servers WHERE created_by = ? ORDER BY created_at DESC").all(createdBy) as Array<Record<string, unknown>>)
    : (db.prepare("SELECT * FROM mcp_servers ORDER BY created_at DESC").all() as Array<Record<string, unknown>>);
  return rows.map(rowToMcpServer);
}

export function dbListEnabledMcpServers(): McpServer[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at DESC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToMcpServer);
}

export function dbUpdateMcpServer(
  id: string,
  patch: Partial<Pick<McpServer, "name" | "command" | "args" | "env" | "enabled">>,
): McpServer | null {
  const existing = dbGetMcpServer(id);
  if (!existing) return null;
  const next: McpServer = {
    ...existing,
    name: patch.name ?? existing.name,
    command: patch.command ?? existing.command,
    args: patch.args ?? existing.args,
    env: patch.env ?? existing.env,
    enabled: patch.enabled ?? existing.enabled,
  };
  const db = getDb();
  db.prepare(
    `UPDATE mcp_servers
        SET name = ?, command = ?, args_json = ?, env_json = ?, enabled = ?
      WHERE id = ?`,
  ).run(
    next.name,
    next.command,
    JSON.stringify(next.args),
    JSON.stringify(next.env),
    next.enabled ? 1 : 0,
    id,
  );
  return next;
}

export function dbDeleteMcpServer(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// FTS index
// ---------------------------------------------------------------------------

export function dbUpsertFileIndex(db: DatabaseSync, workspaceId: string, filePath: string, headings: string): void {
  // FTS5 with content='' needs manual delete+insert
  db.prepare("DELETE FROM file_index WHERE workspace_id = ? AND path = ?").run(workspaceId, filePath);
  db.prepare("INSERT INTO file_index (workspace_id, path, filename, headings) VALUES (?, ?, ?, ?)").run(
    workspaceId,
    filePath,
    filePath.split("/").pop() ?? filePath,
    headings
  );
}
