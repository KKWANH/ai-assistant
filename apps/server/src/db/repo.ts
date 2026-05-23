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
  ScheduleFrequency,
  AgentAttempt,
  AttemptStatus,
} from "@ariadne/shared";
import { getDb } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function j<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  return JSON.parse(v) as T;
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
    `INSERT INTO workspaces (id,name,root_path,include_globs,exclude_globs,created_at,last_scan_at,file_count,created_by,visibility,category)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
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
    w.category ?? null
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
  const usageJson = row["usage_json"] as string | null | undefined;
  const usage: RunUsage | null = usageJson ? (JSON.parse(usageJson) as RunUsage) : null;
  const blockResultsJson = row["block_results_json"] as string | null | undefined;
  const blockResults: BlockResult[] = blockResultsJson
    ? (JSON.parse(blockResultsJson) as BlockResult[])
    : [];
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
  createdAt: string;
}

export function dbInsertUsageEvent(e: UsageEventRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO usage_events (id,run_id,provider,model,input_tokens,output_tokens,cost_usd,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    e.id, e.runId, e.provider, e.model,
    e.inputTokens, e.outputTokens, e.costUsd, e.createdAt
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
    `INSERT INTO chat_messages (id, chat_id, role, content, attachments_json, web_search, search_results_json, agent_json, revisions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const revisionsRaw = row["revisions_json"];
  const revisions = revisionsRaw
    ? (JSON.parse(revisionsRaw as string) as import("@ariadne/shared").MessageRevision[])
    : undefined;
  return {
    id: row["id"] as string,
    chatId: row["chat_id"] as string,
    role: row["role"] as "user" | "assistant",
    content: row["content"] as string,
    attachments: j<ChatAttachment[]>(row["attachments_json"] as string | null, []),
    webSearch: Boolean(row["web_search"]),
    searchResults:
      row["search_results_json"]
        ? (JSON.parse(row["search_results_json"] as string) as SearchResult[])
        : null,
    agent: row["agent_json"]
      ? (JSON.parse(row["agent_json"] as string) as AgentTrace)
      : null,
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
    triage: triageJson ? (JSON.parse(triageJson) as ReportTriage) : null,
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

export function dbListSkills(accountId: string): Skill[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM skills WHERE account_id = ? ORDER BY updated_at DESC",
    )
    .all(accountId) as Record<string, unknown>[];
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
    `INSERT INTO skills (id, account_id, name, prompt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(s.id, s.accountId, s.name, s.prompt, s.createdAt, s.updatedAt);
}

export function dbUpdateSkill(
  id: string,
  patch: { name?: string; prompt?: string },
  updatedAt: string,
): Skill | null {
  const existing = dbGetSkill(id);
  if (!existing) return null;
  const next: Skill = {
    ...existing,
    name: patch.name ?? existing.name,
    prompt: patch.prompt ?? existing.prompt,
    updatedAt,
  };
  const db = getDb();
  db.prepare(
    "UPDATE skills SET name = ?, prompt = ?, updated_at = ? WHERE id = ?",
  ).run(next.name, next.prompt, next.updatedAt, id);
  return next;
}

export function dbDeleteSkill(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM skills WHERE id = ?").run(id);
}

function rowToSkill(row: Record<string, unknown>): Skill {
  return {
    id: row["id"] as string,
    accountId: row["account_id"] as string,
    name: row["name"] as string,
    prompt: row["prompt"] as string,
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
  embedding: Float32Array;
  indexedAt: string;
}

/** Wipe the workspace's embedding index — called before a fresh reindex. */
export function dbClearWorkspaceEmbeddings(workspaceId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM chunk_embeddings WHERE workspace_id = ?").run(workspaceId);
}

/** Bulk-insert chunks for one workspace. Caller passes a Float32Array
 *  per row; we store it as a BLOB. */
export function dbInsertChunkEmbeddings(rows: ChunkEmbeddingRow[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO chunk_embeddings
       (id, workspace_id, provider, dimensions, path, chunk, chunk_index, file_mtime, embedding, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(
      r.id,
      r.workspaceId,
      r.provider,
      r.dimensions,
      r.path,
      r.chunk,
      r.chunkIndex,
      r.fileMtime,
      // node:sqlite accepts Buffer / Uint8Array for BLOB.
      Buffer.from(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength),
      r.indexedAt,
    );
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
