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
  /** Scopes which templates this workspace surfaces; null = show all. */
  category: string | null;
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

/* ------------------------------------------------------------------ *
 * Action pipelines — a runnable action is an ordered list of blocks.
 * Block N's output feeds block N+1. Distinct from the flat WorkspaceAction
 * above (which the agent planner still consumes).
 * ------------------------------------------------------------------ */

export type BlockType =
  | "ask_ai"
  | "web_analysis"
  | "run_script"
  | "read_file"
  /**
   * Write the prior block's output (or a configured constant) to a file in
   * the workspace. Closes the loop for scheduled actions — the report a
   * monthly macro brief produces lands back in `monthly-briefs/2026-05.md`
   * instead of just streaming once to the screen.
   */
  | "write_file"
  /**
   * Propose a file change without touching the workspace. The diff lands
   * in `.ariadne/staged/<run-id>/` and the user reviews & applies it from
   * the run's diff view. Supports search/replace (with a required-match-
   * count safety) and full-file content.
   */
  | "edit_file"
  /**
   * Run a workspace test command and capture pass/fail. Thin wrapper over
   * shell execution shaped specifically so the agent can re-plan on
   * failure ("tests failed → fix → run again").
   */
  | "run_tests";

/**
 * Manifest of staged edits for a run, mirroring .ariadne/staged/<run-id>/.
 * The frontend renders this as the diff-review screen; applying produces
 * real file writes + a workspace-history commit.
 */
export interface StagedManifest {
  runId: string;
  workspaceId: string;
  createdAt: string;
  appliedAt: string | null;
  files: StagedFile[];
}

export interface StagedFile {
  path: string;
  /** What the apply step will do on disk. */
  action: "create" | "modify" | "replace" | "delete";
  /** Unified diff text (for the side-by-side renderer + history log). */
  diff: string;
  /** Pre-edit content, null when action="create". */
  before: string | null;
  /** Post-edit content, null when action="delete". */
  after: string | null;
}

export interface ActionBlock {
  id: string;
  type: BlockType;
  /** Type-specific settings, all string-valued (e.g. { prompt }, { script }). */
  config: Record<string, string>;
}

export interface ActionDef {
  id: string;
  name: string;
  description: string;
  /** Domain category, matching Template.category (research/finance/career/…). */
  category: string;
  blocks: ActionBlock[];
}

export interface BlockResult {
  blockId: string;
  type: BlockType;
  status: "ok" | "failed" | "running";
  output: string;
  error?: string;
  startedAt: string;
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
  /** Domain this template belongs to (e.g. "research", "finance", "career"). */
  category: string;
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
  | "artifacts"
  | "block"; // action-pipeline block step

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
  /** "template" = a template run; "action" = a block-pipeline action run. */
  kind: "template" | "action";
  workspaceId: string;
  /** For kind="action" this holds the action id. */
  templateId: string;
  /** For kind="action" this holds the action name. */
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
  /** Per-block results — populated only for kind="action" runs. */
  blockResults: BlockResult[];
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
  /** Saved profile — durable facts about the user, injected into chat prompts. */
  context: string;
  /** ISO timestamp of the last context update (auto or manual); null if never. */
  contextUpdatedAt: string | null;
}

export type AccessContext = "local" | "remote";

export interface AuthInfo {
  account: Account;
  accessContext: AccessContext;
}

/* ------------------------------------------------------------------ *
 * Reports — user-submitted feedback, triaged before becoming GitHub issues
 * ------------------------------------------------------------------ */

export type ReportType = "bug" | "suggestion" | "other";

/** pending = awaiting admin review · rejected = dismissed · filed = sent to GitHub. */
export type ReportStatus = "pending" | "rejected" | "filed";

/** LLM auto-triage verdict attached to a report shortly after submission. */
export interface ReportTriage {
  /** file = issue-worthy · review = borderline · discard = low quality / not actionable. */
  verdict: "file" | "review" | "discard";
  /** Short category label, e.g. "bug", "ui", "feature". */
  category: string;
  /** A cleaned-up issue title an admin can file as-is. */
  suggestedTitle: string;
  /** A formatted issue body in Markdown. */
  suggestedBody: string;
  /** One-line reasoning for the verdict. */
  reason: string;
}

export interface Report {
  id: string;
  type: ReportType;
  title: string;
  description: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  status: ReportStatus;
  /** Auto-triage result; null until triage finishes (it runs in the background). */
  triage: ReportTriage | null;
  triagedAt: string | null;
  /** The admin who filed or rejected the report. */
  decidedBy: string | null;
  decidedAt: string | null;
  /** The pre-filled GitHub "new issue" URL recorded when the report was filed. */
  githubUrl: string | null;
  /** Image / file attachments uploaded with the report. */
  attachments: ChatAttachment[];
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

/**
 * A previous version of a user message's content, retained when the user
 * edited the message. Oldest first.
 */
export interface MessageRevision {
  content: string;
  /** When this version was replaced. */
  editedAt: string;
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
  /** Past content versions for an edited user message — oldest first. */
  revisions?: MessageRevision[];
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
  | { type: "intent_suggestion"; actionId: string; actionName: string; reason: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

export interface Chat {
  id: string;
  title: string;
  /** Optional workspace the chat is grounded in. */
  workspaceId: string | null;
  createdBy: string | null;
  /** Display name of the account that started the chat (JOIN-resolved). */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Populated by GET /api/chats/:id. */
  messages?: ChatMessage[];
}

/* ------------------------------------------------------------------ *
 * Action schedules — recurring runs of a workspace action.
 *
 * Stored alongside accounts; a single in-process scheduler ticks every
 * 60 s, finds rows where `enabled` and `nextRunAt <= now`, and kicks off
 * a fresh action run via the existing actionEngine. v1 supports only
 * preset cadences (hourly / daily / weekly / monthly) — no raw cron, no
 * day-of-week / day-of-month picker yet. Those can land later.
 * ------------------------------------------------------------------ */

export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "monthly";

export interface ActionSchedule {
  id: string;
  workspaceId: string;
  /** The action.id inside the workspace's actions.yaml. */
  actionId: string;
  accountId: string;
  frequency: ScheduleFrequency;
  enabled: boolean;
  /** ISO timestamp of the most recent successful tick, null before the
   *  first run. */
  lastRunAt: string | null;
  /** ISO timestamp the scheduler is targeting next. The scheduler trusts
   *  this value rather than recomputing from `frequency` every tick. */
  nextRunAt: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Skills — short, reusable prompt snippets owned by an account.
 *
 * A skill is the cheapest unit of reuse in the composer: a named prompt
 * the user can drop in with a single click or via a slash command. The
 * agent / actions / runs system is for longer pipelines; skills are for
 * the "/translate / /summarize / /rewrite politely" instinct.
 * ------------------------------------------------------------------ */

export interface Skill {
  id: string;
  accountId: string;
  /** Short label shown in the menu and as the slash-command keyword. */
  name: string;
  /** The text inserted into the composer when this skill fires. */
  prompt: string;
  createdAt: string;
  updatedAt: string;
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
