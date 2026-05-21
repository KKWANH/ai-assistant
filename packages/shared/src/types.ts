import type { ProviderId } from "./config.js";

/* ------------------------------------------------------------------ *
 * Workspace + folder snapshot
 * ------------------------------------------------------------------ */

export type WorkspaceVisibility = "private" | "public";

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  include: string[];
  exclude: string[];
  createdAt: string;
  lastScanAt: string | null;
  fileCount: number;
  createdBy: string | null;
  createdByName: string | null;
  /** "private" = owner only; "public" = visible to admins too. */
  visibility: WorkspaceVisibility;
}

/* ------------------------------------------------------------------ *
 * Custom workspace actions (tools the agent planner may use)
 * ------------------------------------------------------------------ */

export type ActionType = "run_script" | "read_file" | "web_search" | "format";

export interface WorkspaceAction {
  id: string;
  name: string;
  description: string;
  type: ActionType;
  /** run_script: a `.sh`/`.py` file in `.ariadne/scripts/`. */
  script?: string;
  /** read_file: a path relative to the workspace root. */
  path?: string;
  /** web_search: a default/template query. */
  query?: string;
  /** format: an output format template or spec. */
  template?: string;
  /** Free-form constraints surfaced to the agent planner. */
  constraints?: string;
}

/** Cheap per-file metadata from the Gasp Filter metadata scan. */
export interface FileMeta {
  path: string; // relative to workspace root
  extension: string;
  size: number;
  modifiedTime: string;
  hash: string;
  firstLines: string[];
  headings?: string[]; // markdown
  csvHeaders?: string[];
  csvRowCount?: number;
  jsonKeys?: string[]; // json / yaml top-level keys
  estimatedTokens: number;
  sensitive: boolean;
  sensitiveReason?: string;
}

export interface Snapshot {
  id: string;
  workspaceId: string;
  createdAt: string;
  fileCount: number;
  ignoredCount: number;
  sensitiveCount: number;
  totalEstimatedTokens: number;
  files: FileMeta[];
}

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

export interface TemplateInput {
  key: string;
  type: "string" | "text";
  label: string;
  required: boolean;
  default?: string;
  placeholder?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  inputs: TemplateInput[];
  outputContract: { sections: string[] };
  evidenceRequired: boolean;
  unsupportedClaimsRequired: boolean;
  rerunDiffRequired: boolean;
  promptHint?: string;
}

/* ------------------------------------------------------------------ *
 * Run + trace
 * ------------------------------------------------------------------ */

export type RunStatus =
  | "created"
  | "scanning"
  | "context_pick" // waiting for the user to approve the context
  | "generating"
  | "completed"
  | "failed";

export type RunPhase =
  | "scan"
  | "manifest"
  | "candidate_select"
  | "context_approved"
  | "focused_read"
  | "brief"
  | "claims"
  | "evidence"
  | "unsupported"
  | "diff"
  | "artifacts";

export interface TraceEvent {
  timestamp: string;
  phase: RunPhase;
  status: "ok" | "running" | "failed";
  label: string;
  details?: string;
}

/** A file the Gasp Filter proposes (or the user toggles) for a run. */
export interface ContextFile {
  path: string;
  reason: string;
  estimatedTokens: number;
  sensitive: boolean;
  oversized: boolean;
  included: boolean;
}

export interface ContextPick {
  runId: string;
  files: ContextFile[];
  totalTokens: number;
  skippedLarge: string[];
}

export interface RunArtifacts {
  brief?: string; // path inside .ariadne
  evidence?: string;
  unsupported?: string;
  diff?: string;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Run {
  id: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  status: RunStatus;
  input: Record<string, string>;
  model: string;
  provider: ProviderId;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  candidateFiles: string[];
  selectedFiles: string[];
  tokenEstimate: number;
  evidenceCount: number;
  unsupportedCount: number;
  artifacts: RunArtifacts;
  trace: TraceEvent[];
  previousRunId: string | null;
  error: string | null;
  createdBy: string | null;
  createdByName: string | null;
  usage: RunUsage | null;
}

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

export type ClaimStatus =
  | "supported"
  | "partially_supported"
  | "inferred"
  | "unsupported";

export interface ClaimSource {
  path: string;
  locator: string;
  excerpt: string;
}

export interface Claim {
  id: string;
  runId: string;
  text: string;
  status: ClaimStatus;
  sources: ClaimSource[];
  /** Populated for unsupported / weak claims. */
  reason?: string;
  missingEvidence?: string;
  suggestedSourceType?: string;
  conservativeRewrite?: string;
}

export interface EvidencePack {
  runId: string;
  claims: Claim[];
}

/* ------------------------------------------------------------------ *
 * Re-run diff
 * ------------------------------------------------------------------ */

export interface RunDiff {
  runId: string;
  previousRunId: string | null;
  newFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  newClaims: string[];
  removedClaims: string[];
  changedConclusions: string[];
  newUnsupported: string[];
  resolvedUnsupported: string[];
  summary: string;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean; // key present / reachable
  models: string[];
}

export interface Settings {
  provider: ProviderId;
  model: string;
  providers: ProviderStatus[];
}

/* ------------------------------------------------------------------ *
 * Filesystem browsing (folder picker)
 * ------------------------------------------------------------------ */

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DirListing {
  /** Absolute path of the listed directory. */
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  entries: DirEntry[];
}

/* ------------------------------------------------------------------ *
 * Auth & accounts
 * ------------------------------------------------------------------ */

export type AccountMode = "standard" | "simple";

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: string;
  /** UI language preference, e.g. "en" | "ko". */
  locale: string;
  /** "simple" = streamlined UI for non-technical users. */
  mode: AccountMode;
  createdAt: string;
}

export type AccessContext = "local" | "remote";

export interface AuthInfo {
  account: Account;
  accessContext: AccessContext;
}

/* ------------------------------------------------------------------ *
 * Usage & cost summary
 * ------------------------------------------------------------------ */

export interface UsageSummaryByModel {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  runs: number;
}

export interface UsageSummary {
  total: RunUsage;
  byModel: UsageSummaryByModel[];
}

/* ------------------------------------------------------------------ *
 * Scripts (command execution)
 * ------------------------------------------------------------------ */

export interface ScriptFile {
  name: string;
}

export interface ScriptContent {
  name: string;
  content: string;
}

export interface ScriptRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/* ------------------------------------------------------------------ *
 * Web search
 * ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  provider: string;
  results: SearchResult[];
  error?: string;
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export interface ChatAttachment {
  id: string;
  name: string;
  /** MIME type, e.g. "image/png", "application/pdf". */
  mediaType: string;
  kind: "image" | "file";
  size: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  attachments: ChatAttachment[];
  /** Whether web search was requested for this (user) message. */
  webSearch: boolean;
  /** Search results that grounded an assistant reply, if any. */
  searchResults: SearchResult[] | null;
  /** Plan-and-execute trace, when the message was produced in agent mode. */
  agent: AgentTrace | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Agent (plan-and-execute) mode
 * ------------------------------------------------------------------ */

export type AgentTool =
  | "web_search"
  | "read_file"
  | "list_files"
  | "analyze_image"
  | "run_template"
  | "reason";

export interface AgentStep {
  id: string;
  description: string;
  tool: AgentTool;
  status: "pending" | "running" | "done" | "failed";
  /** One-line rationale — why this step, what it looks for. Explainability. */
  note?: string;
  /** Short summary of the step's result, set once done/failed. */
  result?: string;
}

export interface AgentTrace {
  steps: AgentStep[];
  /** One-line summary of the overall approach taken. */
  summary?: string;
}

/**
 * A chat generation running on the server right now. Survives client
 * disconnect — a reconnecting client polls this to resume the live view.
 */
export interface GenerationStatus {
  chatId: string;
  /** The assistant message id being generated. */
  messageId: string;
  /** ISO timestamp the generation started. */
  startedAt: string;
  agentMode: boolean;
  /** Partial assistant text produced so far. */
  content: string;
  /** Latest status line. */
  statusText: string;
  /** Partial agent steps (agent mode only). */
  agentSteps: AgentStep[];
}

/* ------------------------------------------------------------------ *
 * Chat streaming (SSE event union for POST /api/chats/:id/messages)
 * ------------------------------------------------------------------ */

export type ChatStreamEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "agent_plan"; steps: AgentStep[] }
  | { type: "agent_step"; step: AgentStep }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

export interface Chat {
  id: string;
  title: string;
  /** Optional workspace the chat is grounded in. */
  workspaceId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Populated by GET /api/chats/:id. */
  messages?: ChatMessage[];
}

/* ------------------------------------------------------------------ *
 * Custom project surface (user-authored UI)
 * ------------------------------------------------------------------ */

export interface SurfaceState {
  /** A `.ariadne/surface.tsx` exists for the workspace. */
  exists: boolean;
  /** A current build artifact exists. */
  built: boolean;
  /** Last build error, if the build failed. */
  buildError: string | null;
  /** When the surface source was last saved. */
  updatedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Generic API envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  detail?: string;
}
