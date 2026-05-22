import type { DatabaseSync } from "node:sqlite";
import type {
  Workspace,
  WorkspaceVisibility,
  Snapshot,
  Run,
  RunUsage,
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
    `INSERT INTO workspaces (id,name,root_path,include_globs,exclude_globs,created_at,last_scan_at,file_count,created_by,visibility)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
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
    w.visibility ?? "private"
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
    `INSERT INTO runs (id,workspace_id,template_id,template_name,status,input_json,model,provider,created_at,started_at,completed_at,candidate_files,selected_files,token_estimate,evidence_count,unsupported_count,artifacts_json,trace_json,previous_run_id,error,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    r.id, r.workspaceId, r.templateId, r.templateName, r.status,
    JSON.stringify(r.input), r.model, r.provider,
    r.createdAt, r.startedAt, r.completedAt,
    JSON.stringify(r.candidateFiles), JSON.stringify(r.selectedFiles),
    r.tokenEstimate, r.evidenceCount, r.unsupportedCount,
    JSON.stringify(r.artifacts), JSON.stringify(r.trace),
    r.previousRunId, r.error,
    r.createdBy ?? null
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

  if (sets.length === 0) return dbGetRun(id);
  vals.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return dbGetRun(id);
}

function rowToRun(row: Record<string, unknown>): Run {
  const usageJson = row["usage_json"] as string | null | undefined;
  const usage: RunUsage | null = usageJson ? (JSON.parse(usageJson) as RunUsage) : null;
  return {
    id: row["id"] as string,
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
    `INSERT INTO chat_messages (id, chat_id, role, content, attachments_json, web_search, search_results_json, agent_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.id,
    m.chatId,
    m.role,
    m.content,
    JSON.stringify(m.attachments),
    m.webSearch ? 1 : 0,
    m.searchResults ? JSON.stringify(m.searchResults) : null,
    m.agent ? JSON.stringify(m.agent) : null,
    m.createdAt
  );
}

export function dbListMessages(chatId: string): ChatMessage[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
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
