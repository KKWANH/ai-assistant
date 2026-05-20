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
} from "@ariadne/shared";
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  CreateRunInput,
  ConfirmContextInput,
  UpdateSettingsInput,
  LoginInput,
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

export const scanWorkspace = (id: string) =>
  request<Snapshot>("POST", `/workspaces/${id}/scan`);

export const getSnapshot = (id: string) =>
  request<Snapshot>("GET", `/workspaces/${id}/snapshot`);

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

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (input: LoginInput) =>
  request<AuthInfo>("POST", "/auth/login", input);

export const logout = () =>
  request<{ ok: boolean }>("POST", "/auth/logout");

export const getMe = () =>
  request<AuthInfo>("GET", "/auth/me");

export const setLocale = (locale: string) =>
  request<{ ok: boolean }>("PUT", "/account/locale", { locale });

export const setMode = (mode: "standard" | "simple") =>
  request<{ ok: boolean }>("PUT", "/account/mode", { mode });

// ── Usage ─────────────────────────────────────────────────────────────────────
export const getUsage = () =>
  request<UsageSummary>("GET", "/usage");

// ── Actions ───────────────────────────────────────────────────────────────────
import type { WorkspaceAction } from "@ariadne/shared";

export interface ActionsPayload {
  source: string;
  actions: WorkspaceAction[];
  error: string | null;
}

export const getActions = (workspaceId: string) =>
  request<ActionsPayload>("GET", `/workspaces/${workspaceId}/actions`);

export const saveActions = (workspaceId: string, source: string) =>
  request<ActionsPayload>("PUT", `/workspaces/${workspaceId}/actions`, { source });

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

// ── Streaming sendMessage (SSE) ───────────────────────────────────────────────
import type { ChatStreamEvent } from "@ariadne/shared";

export interface StreamHandlers {
  onUserMessage?: (msg: ChatMessage) => void;
  onStatus?: (text: string) => void;
  onDelta?: (text: string) => void;
  onAgentPlan?: (steps: import("@ariadne/shared").AgentStep[]) => void;
  onAgentStep?: (step: import("@ariadne/shared").AgentStep) => void;
  onDone?: (msg: ChatMessage) => void;
  onError?: (error: string) => void;
}

export async function sendMessage(
  chatId: string,
  input: PostMessageInput,
  handlers: StreamHandlers
): Promise<void> {
  const res = await fetch(`${BASE}/chats/${chatId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
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
          case "done":
            handlers.onDone?.(event.message);
            break;
          case "error":
            handlers.onError?.(event.error);
            break;
        }
      } catch {
        // Ignore malformed events
      }
    }
  }
}

export const getUploadUrl = (id: string) => `/api/uploads/${id}`;
