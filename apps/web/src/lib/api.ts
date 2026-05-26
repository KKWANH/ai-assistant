/**
 * Typed fetch client for the Ariadne API.
 * All endpoints from ARCHITECTURE.md §REST API.
 */
import type {
  Workspace,
  Snapshot,
  Template,
  Run,
  ContextPick,
  EvidencePack,
  RunDiff,
  Settings,
  DirListing,
  AuthInfo,
  UsageSummary,
  ScriptFile,
  ScriptContent,
  ScriptRunResult,
  SearchResponse,
  Report,
} from "@ariadne/shared";
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  CreateRunInput,
  ConfirmContextInput,
  UpdateSettingsInput,
  LoginInput,
  CreateReportInput,
} from "@ariadne/shared";

const BASE = "/api";

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as {
      error?: string;
      detail?: string;
    };
    const msg = err.error ?? `HTTP ${res.status}`;
    // Attach status for callers that need to differentiate 401
    const error = new Error(err.detail ? `${msg} — ${err.detail}` : msg) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

// ── Workspaces ──────────────────────────────────────────────────────────────
export const getWorkspaces = () =>
  request<Workspace[]>("GET", "/workspaces");

export const createWorkspace = (input: CreateWorkspaceInput) =>
  request<Workspace>("POST", "/workspaces", input);

export const getWorkspace = (id: string) =>
  request<Workspace>("GET", `/workspaces/${id}`);

export const updateWorkspace = (id: string, input: UpdateWorkspaceInput) =>
  request<Workspace>("PATCH", `/workspaces/${id}`, input);

export const deleteWorkspace = (id: string) =>
  request<{ ok: boolean }>("DELETE", `/workspaces/${id}`);

export const scanWorkspace = (id: string) =>
  request<Snapshot>("POST", `/workspaces/${id}/scan`);

export const getSnapshot = (id: string) =>
  request<Snapshot>("GET", `/workspaces/${id}/snapshot`);

export interface WorkspaceSearchChunk {
  path: string;
  chunk: string;
  score: number;
}
export type WorkspaceRetrievalStrategy =
  | "semantic"
  | "keyword"
  | "keyword+symbol"
  | "none";
export interface WorkspaceSearchResult {
  query: string;
  chunks: WorkspaceSearchChunk[];
  /** Which retrieval path actually ran. */
  strategy: WorkspaceRetrievalStrategy;
  /** True only when an embedding index was actually used. */
  indexed: boolean;
  /** Provider id of the stored chunks ("openai", "ollama", …) — null
   *  when there's no semantic index. */
  embeddingProvider?: string | null;
  /** Total chunks the scorer evaluated before slicing topK. */
  candidateCount?: number;
  /** Notes from the retriever — "index out of date", "no extractable
   *  tokens", etc. Surfaced in the UI as a small footer. */
  warnings?: string[];
  fileCount?: number;
}
export const searchWorkspace = (id: string, query: string, topK = 10) =>
  request<WorkspaceSearchResult>(
    "GET",
    `/workspaces/${id}/search?q=${encodeURIComponent(query)}&topK=${topK.toString()}`,
  );

// ── Templates ───────────────────────────────────────────────────────────────
export const getTemplates = () =>
  request<Template[]>("GET", "/templates");

export const getTemplate = (id: string) =>
  request<Template>("GET", `/templates/${id}`);

// ── Runs ─────────────────────────────────────────────────────────────────────
export const getRuns = (workspaceId?: string) => {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return request<Run[]>("GET", `/runs${qs}`);
};

export const createRun = (input: CreateRunInput) =>
  request<Run>("POST", "/runs", input);

export const getRun = (id: string) =>
  request<Run>("GET", `/runs/${id}`);

export const getRunContext = (id: string) =>
  request<ContextPick>("GET", `/runs/${id}/context`);

export const confirmRunContext = (id: string, input: ConfirmContextInput) =>
  request<Run>("POST", `/runs/${id}/context`, input);

export const getRunBrief = (id: string) =>
  request<{ markdown: string }>("GET", `/runs/${id}/brief`);

export const getRunEvidence = (id: string) =>
  request<EvidencePack>("GET", `/runs/${id}/evidence`);

export const getRunDiff = (id: string) =>
  request<RunDiff>("GET", `/runs/${id}/diff`);

// ── Filesystem (folder picker) ───────────────────────────────────────────────
export const listDir = (dirPath?: string) => {
  const qs = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
  return request<DirListing>("GET", `/fs/list${qs}`);
};

export const makeDir = (parent: string, name: string) =>
  request<{ path: string }>("POST", "/fs/mkdir", { parent, name });

// ── Settings ─────────────────────────────────────────────────────────────────
export const getSettings = () =>
  request<Settings>("GET", "/settings");

export const updateSettings = (input: UpdateSettingsInput) =>
  request<Settings>("PUT", "/settings", input);

// ── Providers ─────────────────────────────────────────────────────────────────
import type { ProviderStatus } from "@ariadne/shared";

export const getProviderStatus = () =>
  request<ProviderStatus[]>("GET", "/providers/status");

// ── Surface ───────────────────────────────────────────────────────────────────
import type { SurfaceState } from "@ariadne/shared";

export const getSurface = (workspaceId: string) =>
  request<{ state: SurfaceState; source: string }>("GET", `/workspaces/${workspaceId}/surface`);

export const saveSurface = (workspaceId: string, source: string) =>
  request<{ ok: boolean }>("PUT", `/workspaces/${workspaceId}/surface`, { source });

export const buildSurface = (workspaceId: string) =>
  request<{ ok: boolean; error?: string }>("POST", `/workspaces/${workspaceId}/surface/build`);

export const getWorkspaceFile = (workspaceId: string, path: string) =>
  request<{ content: string }>("GET", `/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`);

export const saveWorkspaceFile = (workspaceId: string, path: string, content: string) =>
  request<{ ok: boolean }>("PUT", `/workspaces/${workspaceId}/file`, { path, content });

// AK — multi-file surface editor support.
export interface SurfaceFolderFile {
  path: string;          // relative to .ariadne/surface/
  size: number;
  updatedAt: string;
  content: string;
}
export const getSurfaceFolder = (workspaceId: string) =>
  request<{ files: SurfaceFolderFile[]; folderExists: boolean }>(
    "GET",
    `/workspaces/${workspaceId}/surface/folder`,
  );
export const saveSurfaceFolderFile = (workspaceId: string, path: string, content: string) =>
  request<{ ok: boolean; path: string }>(
    "PUT",
    `/workspaces/${workspaceId}/surface/folder/file`,
    { path, content },
  );
// AL3 — create / delete files in the surface folder.
export const createSurfaceFolderFile = (workspaceId: string, path: string, content = "") =>
  request<{ ok: boolean; path: string }>(
    "POST",
    `/workspaces/${workspaceId}/surface/folder/file`,
    { path, content },
  );
export const deleteSurfaceFolderFile = (workspaceId: string, path: string) =>
  request<{ ok: boolean }>(
    "DELETE",
    `/workspaces/${workspaceId}/surface/folder/file?path=${encodeURIComponent(path)}`,
  );

export interface StageWorkspaceFileResult {
  runId: string;
  added: number;
  removed: number;
}
/**
 * Stage a data-file edit instead of writing it directly. The caller can
 * then navigate to /runs/:runId/diff to review + apply (or discard).
 * This is the Data-tab equivalent of the AI's edit_file → stage flow.
 */
export const stageWorkspaceFile = (workspaceId: string, path: string, content: string) =>
  request<StageWorkspaceFileResult>(
    "POST",
    `/workspaces/${workspaceId}/file/stage`,
    { path, content },
  );

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (input: LoginInput) =>
  request<AuthInfo>("POST", "/auth/login", input);

/** Server-side cookie reset — clears `ariadne_session` (signed or
 *  malformed), deletes the session row if the cookie WAS valid. Safe
 *  to call without auth. Used by the "stuck on a 401 loop" recovery
 *  link on the login screen. */
export const resetSession = () =>
  request<{ ok: boolean; cleared: boolean }>("POST", "/auth/reset");

export const logout = () =>
  request<{ ok: boolean }>("POST", "/auth/logout");

export const getMe = () =>
  request<AuthInfo>("GET", "/auth/me");

export const setLocale = (locale: string) =>
  request<{ ok: boolean }>("PUT", "/account/locale", { locale });

export const setMode = (mode: "standard" | "simple") =>
  request<{ ok: boolean }>("PUT", "/account/mode", { mode });

export const setAccountContext = (context: string) =>
  request<{ ok: boolean }>("PUT", "/account/context", { context });

// ── Usage ─────────────────────────────────────────────────────────────────────
export const getUsage = () =>
  request<UsageSummary>("GET", "/usage");

// ── Actions ───────────────────────────────────────────────────────────────────
import type { WorkspaceAction, ActionDef } from "@ariadne/shared";

export interface ActionsPayload {
  source: string;
  actions: WorkspaceAction[];
  error: string | null;
}

/** The unified create-and-run list: built-in templates + custom block actions. */
export interface ActionDefsPayload {
  templates: Template[];
  actions: ActionDef[];
  error: string | null;
}

export const getActionDefs = (workspaceId: string) =>
  request<ActionDefsPayload>("GET", `/workspaces/${workspaceId}/action-defs`);

export const getActions = (workspaceId: string) =>
  request<ActionsPayload>("GET", `/workspaces/${workspaceId}/actions`);

export const saveActions = (workspaceId: string, source: string) =>
  request<ActionsPayload>("PUT", `/workspaces/${workspaceId}/actions`, { source });

export const runAction = (workspaceId: string, actionId: string, input?: Record<string, string>) =>
  request<Run>(
    "POST",
    `/workspaces/${workspaceId}/actions/${encodeURIComponent(actionId)}/run`,
    { input: input ?? {} },
  );

// ── Scripts ───────────────────────────────────────────────────────────────────
export const getScripts = (workspaceId: string) =>
  request<ScriptFile[]>("GET", `/workspaces/${workspaceId}/scripts`);

export const getScript = (workspaceId: string, name: string) =>
  request<ScriptContent>("GET", `/workspaces/${workspaceId}/scripts/${encodeURIComponent(name)}`);

export const saveScript = (workspaceId: string, name: string, content: string) =>
  request<ScriptContent>("PUT", `/workspaces/${workspaceId}/scripts/${encodeURIComponent(name)}`, { content });

export const runScript = (workspaceId: string, name: string) =>
  request<ScriptRunResult>("POST", `/workspaces/${workspaceId}/scripts/${encodeURIComponent(name)}/run`);

// ── Search ────────────────────────────────────────────────────────────────────
export const search = (query: string) =>
  request<SearchResponse>("POST", "/search", { query });

// ── Market data (live quotes + FX) ────────────────────────────────────────────
export interface Quote {
  symbol: string;
  inputSymbol?: string;
  resolvedSymbol?: string;
  price: number;
  currency: string;
  market?: string;
  source?: string;
  // AO — richer Yahoo meta passed through to surfaces. Optional.
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  previousClose?: number;
}

export interface QuoteError {
  inputSymbol: string;
  resolvedSymbol: string;
  reason: string;
}

export const getQuotes = (symbols: string[]) =>
  request<{ quotes: Quote[] }>(
    "GET",
    `/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,
  );

export const getQuotesDetailed = (symbols: string[]) =>
  request<{ quotes: Quote[]; errors: QuoteError[] }>(
    "GET",
    `/market/quotes?detailed=1&symbols=${encodeURIComponent(symbols.join(","))}`,
  );

export const getFxRates = (base: string, currencies: string[]) =>
  request<{ base: string; rates: Record<string, number> }>(
    "GET",
    `/market/fx?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(currencies.join(","))}`,
  );

// AQ — Historical close prices for a single symbol. Used by the
// portfolio surface for benchmark overlay (^KS200, ^GSPC).
export const getQuoteHistory = (symbol: string, range = "1y", interval = "1d") =>
  request<{ symbol: string; resolved: string; points: Array<{ date: string; close: number }>; error?: string }>(
    "GET",
    `/market/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`,
  );

// AR — Calendar events (earnings + ex-div + dividend) for a batch of symbols.
export interface QuoteCalendar {
  symbol: string;
  resolvedSymbol: string;
  earningsDate?: string;
  earningsType?: "actual" | "estimate";
  exDividendDate?: string;
  dividendRate?: number;
  dividendYield?: number;
}
export const getQuoteCalendars = (symbols: string[]) =>
  request<{ calendars: QuoteCalendar[] }>(
    "GET",
    `/market/calendar?symbols=${encodeURIComponent(symbols.join(","))}`,
  );

// AS — News + dividend history client wrappers.
export interface QuoteNewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  thumbnail?: string;
  relatedTickers?: string[];
}
export const getQuoteNews = (symbol: string, max = 8) =>
  request<{ symbol: string; resolved: string; items: QuoteNewsItem[]; error?: string }>(
    "GET",
    `/market/news?symbol=${encodeURIComponent(symbol)}&max=${max}`,
  );

export const getDividendHistory = (symbol: string, range = "5y") =>
  request<{ symbol: string; resolved: string; points: Array<{ date: string; amount: number }>; error?: string }>(
    "GET",
    `/market/dividends?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
  );

// ── Reports ───────────────────────────────────────────────────────────────────
export const getReports = (status?: string) =>
  request<Report[]>("GET", `/reports${status ? `?status=${status}` : ""}`);

export const createReport = (input: CreateReportInput) =>
  request<Report>("POST", "/reports", input);

export const decideReport = (id: string, decision: "file" | "reject") =>
  request<Report>("POST", `/reports/${id}/decision`, { decision });

// ── Chat ──────────────────────────────────────────────────────────────────────
import type { Chat, ChatMessage } from "@ariadne/shared";
import type { CreateChatInput, UpdateChatInput, PostMessageInput } from "@ariadne/shared";

export const getChats = () =>
  request<Chat[]>("GET", "/chats");

export const createChat = (input: CreateChatInput) =>
  request<Chat>("POST", "/chats", input);

export const getChat = (id: string) =>
  request<Chat>("GET", `/chats/${id}`);

export const updateChat = (id: string, input: UpdateChatInput) =>
  request<Chat>("PATCH", `/chats/${id}`, input);

export const deleteChat = (id: string) =>
  request<{ ok: boolean }>("DELETE", `/chats/${id}`);

// ── In-progress generation (stop / reconnect) ─────────────────────────────────
import type { GenerationStatus } from "@ariadne/shared";

export interface ActiveGenerationPayload {
  active: GenerationStatus | null;
}

export const getActiveGeneration = (chatId: string) =>
  request<ActiveGenerationPayload>("GET", `/chats/${chatId}/active`);

export const stopGeneration = (chatId: string) =>
  request<{ ok: boolean }>("POST", `/chats/${chatId}/stop`);

/**
 * Edit a user message and regenerate the assistant reply that followed it.
 * SSE — same event shape as sendMessage. The server saves the prior content
 * to the message's revisions log and deletes every later message in the
 * chat before re-streaming.
 */
export async function regenerateAfterEdit(
  chatId: string,
  messageId: string,
  body: {
    content: string;
    webSearch?: "on" | "off" | "auto";
    agentMode?: boolean | "off" | "auto" | "on";
  },
  handlers: StreamHandlers,
): Promise<void> {
  return consumeMessageStream(
    `${BASE}/chats/${chatId}/messages/${messageId}/regenerate`,
    body,
    handlers,
  );
}

// ── Streaming sendMessage (SSE) ───────────────────────────────────────────────
import type { ChatStreamEvent } from "@ariadne/shared";

export interface StreamHandlers {
  onUserMessage?: (msg: ChatMessage) => void;
  onStatus?: (text: string) => void;
  onDelta?: (text: string) => void;
  onAgentPlan?: (steps: import("@ariadne/shared").AgentStep[]) => void;
  onAgentStep?: (step: import("@ariadne/shared").AgentStep) => void;
  onIntentSuggestion?: (s: { actionId: string; actionName: string; reason: string }) => void;
  onDone?: (msg: ChatMessage) => void;
  /** Fired after `done` when an auto-title resolves. Lets the sidebar
   *  patch the chat row in-place without a refetch. */
  onChatUpdated?: (chatId: string, title: string) => void;
  onError?: (error: string) => void;
  /** The stream closed before a done/error event — the generation may still
   *  be running on the server (reconnect via GET /chats/:id/active). */
  onDisconnect?: () => void;
}

export async function sendMessage(
  chatId: string,
  input: PostMessageInput,
  handlers: StreamHandlers
): Promise<void> {
  return consumeMessageStream(`${BASE}/chats/${chatId}/messages`, input, handlers);
}

/** Shared SSE consumer for both /messages (send) and /messages/:id/regenerate. */
async function consumeMessageStream(
  url: string,
  body: unknown,
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
    };
    handlers.onError?.(err.error ?? `HTTP ${res.status}`);
    return;
  }

  // If server returns plain JSON (non-streaming fallback), handle it
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    // Fallback: parse as JSON
    const data = (await res.json()) as {
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    };
    handlers.onUserMessage?.(data.userMessage);
    handlers.onDone?.(data.assistantMessage);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    handlers.onError?.("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedTerminal = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const event = JSON.parse(jsonStr) as ChatStreamEvent;
        switch (event.type) {
          case "user_message":
            handlers.onUserMessage?.(event.message);
            break;
          case "status":
            handlers.onStatus?.(event.text);
            break;
          case "delta":
            handlers.onDelta?.(event.text);
            break;
          case "agent_plan":
            handlers.onAgentPlan?.(event.steps);
            break;
          case "agent_step":
            handlers.onAgentStep?.(event.step);
            break;
          case "intent_suggestion":
            handlers.onIntentSuggestion?.({
              actionId: event.actionId,
              actionName: event.actionName,
              reason: event.reason,
            });
            break;
          case "done":
            receivedTerminal = true;
            handlers.onDone?.(event.message);
            break;
          case "chat_updated":
            handlers.onChatUpdated?.(event.chatId, event.title);
            break;
          case "error":
            receivedTerminal = true;
            handlers.onError?.(event.error);
            break;
        }
      } catch {
        // Ignore malformed events
      }
    }
  }

  // Stream closed with no done/error — a dropped connection. The generation
  // keeps running on the server; the caller can reconnect via /active.
  if (!receivedTerminal) handlers.onDisconnect?.();
}

export const getUploadUrl = (id: string) => `/api/uploads/${id}`;

// ── Agent attempts (Claude-Code Phase C) ──────────────────────────────────────
import type { AgentAttempt } from "@ariadne/shared";

export const getOpenAttemptForChat = (chatId: string) =>
  request<AgentAttempt | null>("GET", `/chats/${chatId}/open-attempt`);

export const listAttemptsForChat = (chatId: string) =>
  request<AgentAttempt[]>("GET", `/chats/${chatId}/attempts`);

export interface AttemptPayload {
  attempt: AgentAttempt;
  manifest: StagedManifest | null;
}

export const getAttempt = (attemptId: string) =>
  request<AttemptPayload>("GET", `/attempts/${attemptId}`);

export const applyAttempt = (attemptId: string, paths: string[]) =>
  request<ApplyStagedResult>("POST", `/attempts/${attemptId}/apply`, { paths });

export const abandonAttempt = (attemptId: string) =>
  request<{ ok: boolean }>("POST", `/attempts/${attemptId}/abandon`);

// ── Staged edits (Claude-Code Phase A) ────────────────────────────────────────
import type { StagedManifest } from "@ariadne/shared";

export const getStagedManifest = (runId: string) =>
  request<StagedManifest>("GET", `/runs/${runId}/staged`);

export interface ApplyStagedResult {
  applied: string[];
  skipped: string[];
  errors: { path: string; reason: string }[];
  commitSha: string | null;
  /** Summaries of any staged_apply hooks that fired (typecheck-on-apply etc.). */
  hookResults?: import("@ariadne/shared").HookRunSummary[];
}

export const applyStagedEdits = (runId: string, paths: string[]) =>
  request<ApplyStagedResult>("POST", `/runs/${runId}/staged/apply`, { paths });

export const discardStagedEdits = (runId: string) =>
  request<{ ok: boolean }>("POST", `/runs/${runId}/staged/discard`);

// ── Workspace git history ─────────────────────────────────────────────────────

export interface WorkspaceCommit {
  sha: string;
  shortSha: string;
  message: string;
  timestamp: string;
  filesChanged: number;
  /** When set, this commit is from an apply-step and can be rewound. */
  applyRunId: string | null;
}

export const listWorkspaceHistory = (workspaceId: string, limit = 50) =>
  request<WorkspaceCommit[]>(
    "GET",
    `/workspaces/${workspaceId}/history?limit=${limit.toString()}`,
  );

export interface RewindResult {
  restored: string[];
  errors: { path: string; reason: string }[];
  commitSha: string | null;
}

export const rewindWorkspaceCommit = (workspaceId: string, sha: string) =>
  request<RewindResult>("POST", `/workspaces/${workspaceId}/history/rewind`, { sha });

export interface CommitFileChange {
  path: string;
  action: "create" | "modify" | "replace" | "delete";
  before: string | null;
  after: string | null;
  diff: string;
}
export interface CommitDetail {
  sha: string;
  shortSha: string;
  message: string;
  timestamp: string;
  files: CommitFileChange[];
}

export const getCommitDetail = (workspaceId: string, sha: string) =>
  request<CommitDetail>("GET", `/workspaces/${workspaceId}/history/${sha}`);

// ── Action schedules ──────────────────────────────────────────────────────────
import type {
  ActionSchedule,
  CreateScheduleInput,
  UpdateScheduleInput,
} from "@ariadne/shared";

export const listSchedules = (workspaceId: string) =>
  request<ActionSchedule[]>("GET", `/workspaces/${workspaceId}/schedules`);
export const createSchedule = (workspaceId: string, input: CreateScheduleInput) =>
  request<ActionSchedule>("POST", `/workspaces/${workspaceId}/schedules`, input);
export const updateSchedule = (id: string, input: UpdateScheduleInput) =>
  request<ActionSchedule>("PATCH", `/schedules/${id}`, input);
export const deleteSchedule = (id: string) =>
  request<{ ok: boolean }>("DELETE", `/schedules/${id}`);

// ── Skills ────────────────────────────────────────────────────────────────────
import type { Skill, CreateSkillInput, UpdateSkillInput } from "@ariadne/shared";

export const listSkills = () => request<Skill[]>("GET", "/skills");
export const createSkill = (input: CreateSkillInput) =>
  request<Skill>("POST", "/skills", input);
export const updateSkill = (id: string, input: UpdateSkillInput) =>
  request<Skill>("PATCH", `/skills/${id}`, input);
export const deleteSkill = (id: string) =>
  request<{ ok: boolean }>("DELETE", `/skills/${id}`);

// ── Eval-case promotion ──────────────────────────────────────────────────────
import type { PromoteEvalCaseInput } from "@ariadne/shared";

export interface PromoteEvalCaseResponse {
  ok: true;
  caseId: string;
  savedPath: string;
}

export const promoteEvalCase = (input: PromoteEvalCaseInput) =>
  request<PromoteEvalCaseResponse>("POST", "/eval-cases/promote", input);

// ── Workspace memory ─────────────────────────────────────────────────────────
import type { AddMemoryInput, WorkspaceMemory } from "@ariadne/shared";

export const listWorkspaceMemory = (workspaceId: string) =>
  request<{ memories: WorkspaceMemory[] }>(
    "GET",
    `/workspaces/${workspaceId}/memory`,
  );

export const addWorkspaceMemory = (workspaceId: string, input: AddMemoryInput) =>
  request<WorkspaceMemory>("POST", `/workspaces/${workspaceId}/memory`, input);

export const deleteWorkspaceMemory = (workspaceId: string, memoryId: string) =>
  request<{ ok: true }>(
    "DELETE",
    `/workspaces/${workspaceId}/memory/${memoryId}`,
  );

// ── Workspace hooks ──────────────────────────────────────────────────────────
import type { WorkspaceHook, PutHooksInput } from "@ariadne/shared";

export const getWorkspaceHooks = (workspaceId: string) =>
  request<{ hooks: WorkspaceHook[]; source: string }>(
    "GET",
    `/workspaces/${workspaceId}/hooks`,
  );

export const putWorkspaceHooks = (workspaceId: string, input: PutHooksInput) =>
  request<{ hooks: WorkspaceHook[]; source: string }>(
    "PUT",
    `/workspaces/${workspaceId}/hooks`,
    input,
  );

export const getHookLog = (workspaceId: string, hookId: string) =>
  request<{ log: string }>(
    "GET",
    `/workspaces/${workspaceId}/hooks/${hookId}/log`,
  );

// ── MCP servers ──────────────────────────────────────────────────────────────
import type {
  McpServer,
  McpTool,
  McpConnectionStatus,
  CreateMcpServerInput,
  UpdateMcpServerInput,
} from "@ariadne/shared";

export type McpServerWithStatus = McpServer & { connected: boolean };

export const listMcpServers = () =>
  request<McpServerWithStatus[]>("GET", "/mcp-servers");

export const createMcpServer = (input: CreateMcpServerInput) =>
  request<McpServerWithStatus>("POST", "/mcp-servers", input);

export const updateMcpServer = (id: string, input: UpdateMcpServerInput) =>
  request<McpServerWithStatus>("PATCH", `/mcp-servers/${id}`, input);

export const deleteMcpServer = (id: string) =>
  request<{ ok: true }>("DELETE", `/mcp-servers/${id}`);

export const listMcpTools = (id: string) =>
  request<{ tools: McpTool[] }>("GET", `/mcp-servers/${id}/tools`);

export const testMcpServer = (id: string) =>
  request<McpConnectionStatus>("POST", `/mcp-servers/${id}/test`);
