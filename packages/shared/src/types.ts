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
  /** Where entering the workspace lands. null/"overview" = the tabbed
   *  overview (default); "surface" = the custom screen as an immersive home
   *  (no tabs), like lecture prep. General to all workspaces. */
  homeView: WorkspaceHomeView;
  /** Per-workspace AI model override for this workspace's chats. Both null =
   *  inherit the account-global default; set together (a model implies its
   *  provider). The "per-workspace config" lever (P2). */
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
  /** A skill whose prompt is pre-filled into the composer when starting a new
   *  chat in this workspace. null = none. References a skill id (user or
   *  built-in). */
  defaultSkillId: string | null;
}

export type WorkspaceHomeView = "overview" | "surface" | null;

/* ------------------------------------------------------------------ *
 * Custom workspace actions (tools the agent planner may use)
 * ------------------------------------------------------------------ */

/** The custom-action types — runtime array is the single source; the ActionType
 *  union and the server's validation Set both derive from it (no drift). */
export const ACTION_TYPES = ["run_script", "read_file", "web_search", "format"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

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

/**
 * The run-pipeline block types — the steps a template/action RUN executes in
 * order (output of one feeds the next). Distinct from `ActionType` above, which
 * is the *agent's* flat tool vocabulary in chat; these are the *run engine's*
 * (runs/actionEngine.ts) blocks. The runtime array is the single source — the
 * BlockType union and the server's validation Set both derive from it (no drift).
 *   write_file — write the prior block's output (or a constant) to a workspace
 *     file; closes the loop for scheduled actions (a monthly brief lands back in
 *     `monthly-briefs/2026-05.md` instead of just streaming once).
 *   edit_file  — propose a file change staged to `.ariadne/staged/<run-id>/`
 *     that the user reviews + applies; search/replace (match-count safety) or
 *     full content.
 *   run_tests  — run a workspace test command, capture pass/fail, so the agent
 *     can re-plan on failure ("tests failed → fix → run again").
 */
export const BLOCK_TYPES = [
  "ask_ai",
  "web_analysis",
  "run_script",
  "read_file",
  "write_file",
  "edit_file",
  "run_tests",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

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
  /** AX — set when a markitdown-cached version exists at
   *  <workspace>/.ariadne/cache/markdown/<hash>.md. Drives the "md"
   *  badge in the file picker and unlocks the preview modal. */
  hasMarkdown?: boolean;
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
  /** True when served by the desktop shell (ARIADNE_DESKTOP=1) — gates the
   *  desktop-only first-run wizard. Absent on the web build. */
  desktop?: boolean;
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

// Lecture-prep types (Deck, DeckSlide, Lecture*) moved to
// projects/lecture/types.ts — core carries no lecture-specific shapes.

/** One image hit from the image-search service (art/museum collections),
 *  with everything a lecture slide needs to attribute it. */
export interface ImageResult {
  title: string;
  /** Small preview URL for a grid. */
  thumbUrl: string;
  /** Full-resolution image URL (for the fullscreen viewer). */
  imageUrl: string;
  /** Human-facing page to cite/link (NOT the raw image). */
  sourceUrl: string;
  /** Which collection it came from. */
  source: string;
  creator?: string;
  date?: string;
  license?: string;
  /** Medium/technique, e.g. "Oil on canvas" — for a scholarly slide caption. */
  medium?: string;
  /** Physical dimensions, cleaned to one clause, e.g. "89.9 × 94.1 cm". */
  dimensions?: string;
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
  /** Image-search results to render as a thumbnail grid, if the message asked
   *  for images. Null on every other message. */
  images: ImageResult[] | null;
  /** Plan-and-execute trace, when the message was produced in agent mode. */
  agent: AgentTrace | null;
  /** Provider that generated this message ("anthropic", "openai", "gemini",
   *  "moonshot", "ollama", "mock"). Set on assistant messages; null on
   *  user messages and on rows from before the metadata was tracked. */
  provider?: string | null;
  /** Model id the provider used (e.g. "claude-opus-4.5-20251024",
   *  "gpt-5", "llama3.2:3b"). Same rules as `provider`. */
  model?: string | null;
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
  | "reason"
  /** Propose a file change — stages it under .ariadne/staged/ for review. */
  | "edit_file"
  /** Run the workspace's test command; output prefixed with ✓/✗ for re-plan. */
  | "run_tests"
  /** Evaluate a math expression via mathjs — fast, in-process, no side effects. */
  | "calculate"
  /** Invoke a tool on a registered MCP server. The step description must
   *  start with `serverName::toolName ` then a JSON-encoded args object —
   *  the planner is told this format in its system prompt. */
  | "mcp_call";

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
  /** Image-search results for a "find images" message — the web UI renders a
   *  thumbnail grid the user picks from. */
  | { type: "images"; images: ImageResult[] }
  | { type: "done"; message: ChatMessage }
  /** Emitted AFTER `done` when the post-stream title generation lands.
   *  The sidebar listens for this and patches the chat row in-place
   *  without a refetch. Eliminates the post-stream spinner because
   *  `done` no longer blocks on the title model call. */
  | { type: "chat_updated"; chatId: string; title: string }
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
 * Agent attempts — a per-chat staging "branch".
 *
 * When the agent uses `edit_file`, the staged manifest can't hang on
 * an action Run (the agent loop has no Run record), so we introduce a
 * thin parallel — an Attempt. One open attempt per chat at a time.
 * Multiple agent `edit_file` calls in the same chat accumulate into
 * the same staged tree. The user reviews / applies / abandons.
 *
 * Conceptually this is the "branch-per-attempt" idea from the Phase C
 * plan, made concrete without any extra git plumbing: each open
 * attempt is a working set the user can fast-forward (apply) or
 * throw away (abandon).
 * ------------------------------------------------------------------ */

export type AttemptStatus = "open" | "applied" | "abandoned";

export interface AgentAttempt {
  id: string;
  chatId: string;
  workspaceId: string;
  status: AttemptStatus;
  /** How many staged files are currently in this attempt's manifest. */
  fileCount: number;
  createdAt: string;
  /** Set when `status` flipped to applied (and the workspace commit landed). */
  appliedAt: string | null;
  /** Set when `status` flipped to abandoned (and the staged tree was wiped). */
  abandonedAt: string | null;
  /** Apply commit sha — populated only on successful apply. */
  commitSha: string | null;
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

/** A webhook that fires a workspace action when POSTed to with its secret.
 *  The secret in the URL is the auth — there is no cookie on a webhook call. */
export interface ActionTrigger {
  id: string;
  /** Unguessable secret embedded in the webhook URL. */
  secret: string;
  workspaceId: string;
  /** The action.id inside the workspace's actions.yaml. */
  actionId: string;
  accountId: string;
  /** ISO timestamp of the most recent fire, null before the first. */
  lastFiredAt: string | null;
  createdAt: string;
}

/** A persisted notification for an account — accumulates in the alert inbox
 *  (the bell in the top bar). Created when a background-ish task finishes (an
 *  agent chat run, an action/template run) or a usage limit is hit. */
export interface Alert {
  id: string;
  accountId: string;
  /** "chat_completed" | "run_completed" | "run_failed" | "limit_exceeded" */
  type: string;
  title: string;
  body: string | null;
  /** Client route to open on click, e.g. "/chat/<id>" or "/runs/<id>". */
  link: string | null;
  /** ISO timestamp when the user read it; null = unread. */
  readAt: string | null;
  createdAt: string;
}

/** An account's usage limits + current windowed usage (GET /api/account/limits).
 *  A null limit = unlimited. Token windows are rolling (last 24h / last 7 days). */
export interface AccountLimits {
  dailyTokenLimit: number | null;
  weeklyTokenLimit: number | null;
  dailyTokensUsed: number;
  weeklyTokensUsed: number;
}

/* ------------------------------------------------------------------ *
 * Skills — short, reusable prompt snippets owned by an account.
 *
 * A skill is the cheapest unit of reuse in the composer: a named prompt
 * the user can drop in with a single click or via a slash command. The
 * agent / actions / runs system is for longer pipelines; skills are for
 * the "/translate / /summarize / /rewrite politely" instinct.
 * ------------------------------------------------------------------ */

export interface SkillVariable {
  /** Placeholder key as it appears in the prompt — e.g. `topic` matches
   *  `{topic}`. Lowercase ascii + underscore, kept short. */
  key: string;
  /** Human-friendly label shown in the fill modal. Falls back to `key`. */
  label?: string;
  /** Optional hint shown under the input (e.g. "JavaScript / TypeScript / ..."). */
  hint?: string;
  /** Optional default; pre-fills the input so the user can keep or edit. */
  default?: string;
}

/** A built-in slash command that runs a capability instead of inserting text.
 *  `web_search` arms web search for the next message. Extensible — add more
 *  as the composer learns to trigger them. */
export type SkillAction = "web_search";

export interface Skill {
  id: string;
  /** null for built-in skills shipped server-side; user id otherwise. */
  accountId: string | null;
  /** null = account-global skill (usable in every workspace); set = scoped to
   *  one workspace, only surfaced in that workspace's chats. Built-ins leave
   *  it unset. */
  workspaceId?: string | null;
  /** Short label shown in the menu and as the slash-command keyword. */
  name: string;
  /** The text inserted into the composer when this skill fires.
   *  Variable placeholders use {key} syntax — e.g. "Review {file_path}". */
  prompt: string;
  /** Built-in "function" skills set this to RUN a capability (e.g. web
   *  search) on pick instead of inserting `prompt`. User skills leave it
   *  unset (they insert text). */
  action?: SkillAction;
  /** Optional one-line description shown in the picker beneath the name. */
  description?: string;
  /** Optional category to group built-in skills (`code`, `writing`,
   *  `research`, …). Custom user skills usually leave this null. */
  category?: string | null;
  /** Variables to prompt the user for before inserting. Empty/undefined
   *  means insert as-is (the legacy behaviour). */
  variables?: SkillVariable[];
  /** True for skills shipped by Ariadne (read-only; can't be edited/deleted). */
  builtin?: boolean;
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
 * Workspace memory — facts the AI has learned about a workspace, each
 * one approved by the user before write. Persisted to
 * `<workspaceRoot>/.ariadne/memory.yaml`. Injected into the chat system
 * prompt so subsequent answers reflect what's already been confirmed.
 *
 * The promotion gate is the UI: AI proposes (or the user pins) → modal
 * shows the text for editing → user saves. There is no auto-write path.
 * ------------------------------------------------------------------ */

export interface WorkspaceMemory {
  /** Stable id — used by the delete route and as a yaml field. */
  id: string;
  /** Single-sentence fact / preference. ≤ 500 chars. */
  text: string;
  /** ISO timestamp of when the user approved this memory. */
  addedAt: string;
  /** Display name of the account that approved it. */
  addedBy: string | null;
  /** Optional: where the AI first surfaced it, for traceability.
   *  source.kind="chat" + source.ref=<messageId>, etc. Mirrors the
   *  shape used by user-promoted eval cases. */
  source?: { kind: "chat" | "manual"; ref?: string };
}

/* ------------------------------------------------------------------ *
 * Workspace hooks — per-workspace commands that run on key events.
 * Stored in `<workspaceRoot>/.ariadne/hooks.yaml`, fired by the
 * server-side hooks service. Editing is local-only; remote sessions
 * can view but not modify.
 * ------------------------------------------------------------------ */

export type HookEvent =
  /** Fired after a staged edit is applied to disk. Payload includes paths. */
  | "staged_apply"
  /** Fired after a workspace scan completes. Payload includes file count. */
  | "post_scan"
  /** Fired after a new workspace memory is added. Payload includes the memory id. */
  | "memory_added";

export const HOOK_EVENTS: readonly HookEvent[] = [
  "staged_apply",
  "post_scan",
  "memory_added",
] as const;

export interface WorkspaceHook {
  id: string;
  event: HookEvent;
  command: string;
  /** Default 30000 (30s). Hard-capped at 300000 (5m) by the runner. */
  timeoutMs?: number;
  enabled: boolean;
}

export interface HookRunSummary {
  hookId: string;
  event: HookEvent;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  /** Tail of stdout/stderr, capped at ~2 KB for the API response. The
   *  full log lives in `.ariadne/hooks/<id>.log` on disk. */
  outputTail: string;
}

/* ------------------------------------------------------------------ *
 * MCP servers — external Model Context Protocol endpoints the user
 * has registered. Each entry describes how to launch (stdio) or reach
 * (http/sse, future) one MCP server. The connection manager owns the
 * actual live connections.
 * ------------------------------------------------------------------ */

export type McpTransport = "stdio";

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  /** For stdio: the binary to spawn (e.g. "npx" or "/usr/local/bin/foo"). */
  command: string;
  /** Args appended to `command` when spawning. */
  args: string[];
  /** Env vars merged into the child process. Keep secrets here, not in command. */
  env: Record<string, string>;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface McpTool {
  /** Tool name as the MCP server returns it. */
  name: string;
  description: string;
  /** Raw input schema (JSON Schema) — passed through to the agent planner
   *  so it can craft well-formed args. May be null when the server
   *  doesn't publish one. */
  inputSchema: Record<string, unknown> | null;
}

export interface McpConnectionStatus {
  connected: boolean;
  lastError?: string;
  toolCount?: number;
}

/* ------------------------------------------------------------------ *
 * Generic API envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  detail?: string;
}
