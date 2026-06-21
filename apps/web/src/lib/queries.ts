/**
 * TanStack Query hooks for all server state.
 */
import { useEffect } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Run, RunStatus, Chat, ChatMessage, AgentStep, Report, ActionSchedule } from "@ariadne/shared";
import * as api from "./api";

// ── Query keys ───────────────────────────────────────────────────────────────
export const qk = {
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  snapshot: (id: string) => ["workspaces", id, "snapshot"] as const,
  templates: ["templates"] as const,
  template: (id: string) => ["templates", id] as const,
  runs: (workspaceId?: string) =>
    workspaceId ? ["runs", { workspaceId }] : (["runs"] as const),
  run: (id: string) => ["runs", id] as const,
  runContext: (id: string) => ["runs", id, "context"] as const,
  runBrief: (id: string) => ["runs", id, "brief"] as const,
  runEvidence: (id: string) => ["runs", id, "evidence"] as const,
  runDiff: (id: string) => ["runs", id, "diff"] as const,
  settings: ["settings"] as const,
  me: ["me"] as const,
  usage: ["usage"] as const,
} as const;

const POLLING_STATUSES: RunStatus[] = ["scanning", "context_pick", "generating"];

function isPolling(status?: RunStatus) {
  return status ? POLLING_STATUSES.includes(status) : false;
}

// ── Workspaces ───────────────────────────────────────────────────────────────
export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces,
    queryFn: api.getWorkspaces,
  });
}

export function useWorkspace(id: string) {
  return useQuery({
    queryKey: qk.workspace(id),
    queryFn: () => api.getWorkspace(id),
    enabled: !!id,
  });
}

export function useSnapshot(workspaceId: string, enabled = true) {
  const qc = useQueryClient();
  // AY/BD3 — subscribe to workspace push events via SSE. On any event
  // (scan-complete / markdown-warmed / embedding-indexed) invalidate the
  // snapshot so the UI refetches without a manual rescan.
  //
  // BD3 resilience (graceful degradation):
  //   1. Refetch on every (re)open, not just on events. The native
  //      EventSource auto-reconnects on transient drops, but events that
  //      fired DURING the downtime are lost — a catch-up refetch on
  //      `onopen` closes that gap.
  //   2. Recover from PERMANENT close. If the browser gives up
  //      (readyState===CLOSED — e.g. server 5xx on reconnect, auth
  //      expiry), native EventSource never retries again. We schedule a
  //      manual reconnect with capped exponential backoff so a transient
  //      server blip doesn't leave the stream dead until remount.
  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000; // 1s → … → 30s cap

    const refetch = () => {
      void qc.invalidateQueries({ queryKey: qk.snapshot(workspaceId) });
    };

    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/events`, { withCredentials: true });
      } catch {
        scheduleReconnect();
        return;
      }
      es.onopen = () => {
        backoff = 1000;        // healthy connection → reset backoff
        refetch();             // catch up on anything missed while down
      };
      es.addEventListener("scan-complete", refetch);
      es.addEventListener("markdown-warmed", refetch);
      es.addEventListener("embedding-indexed", refetch);
      es.onerror = () => {
        // CONNECTING (0) = browser is auto-retrying; leave it alone.
        // CLOSED (2) = browser gave up → we must reconnect ourselves.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          scheduleReconnect();
        }
      };
    };

    const scheduleReconnect = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        backoff = Math.min(backoff * 2, 30_000);
        connect();
      }, backoff);
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [workspaceId, enabled, qc]);
  return useQuery({
    queryKey: qk.snapshot(workspaceId),
    queryFn: () => api.getSnapshot(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

export function useScanWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.scanWorkspace(id),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: qk.workspace(id) });
      void qc.invalidateQueries({ queryKey: qk.snapshot(id) });
    },
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: import("@ariadne/shared").UpdateWorkspaceInput }) =>
      api.updateWorkspace(id, input),
    onSuccess: (ws) => {
      void qc.invalidateQueries({ queryKey: qk.workspace(ws.id) });
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaces });
    },
  });
}

// ── Templates ────────────────────────────────────────────────────────────────
export function useTemplates() {
  return useQuery({
    queryKey: qk.templates,
    queryFn: api.getTemplates,
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: qk.template(id),
    queryFn: () => api.getTemplate(id),
    enabled: !!id,
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────────
export function useRuns(workspaceId?: string, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: qk.runs(workspaceId),
    queryFn: () => api.getRuns(workspaceId),
    refetchInterval: options?.refetchInterval,
  });
}

export function useRun(id: string, extraOptions?: { enabled?: boolean }) {
  return useQuery<Run>({
    queryKey: qk.run(id),
    queryFn: () => api.getRun(id),
    enabled: !!id && (extraOptions?.enabled ?? true),
    refetchInterval: (query) => {
      const data = query.state.data as Run | undefined;
      return isPolling(data?.status) ? 1000 : false;
    },
  });
}

export function useRunContext(runId: string, enabled = true) {
  return useQuery({
    queryKey: qk.runContext(runId),
    queryFn: () => api.getRunContext(runId),
    enabled: !!runId && enabled,
  });
}

export function useRunBrief(runId: string, enabled = true) {
  return useQuery({
    queryKey: qk.runBrief(runId),
    queryFn: () => api.getRunBrief(runId),
    enabled: !!runId && enabled,
  });
}

export function useRunEvidence(runId: string, enabled = true) {
  return useQuery({
    queryKey: qk.runEvidence(runId),
    queryFn: () => api.getRunEvidence(runId),
    enabled: !!runId && enabled,
  });
}

export function useRunDiff(runId: string, enabled = true) {
  return useQuery({
    queryKey: qk.runDiff(runId),
    queryFn: () => api.getRunDiff(runId),
    enabled: !!runId && enabled,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRun,
    onSuccess: (run) => {
      // Invalidate both the workspace-scoped and the global runs lists
      void qc.invalidateQueries({ queryKey: qk.runs(run.workspaceId) });
      void qc.invalidateQueries({ queryKey: qk.runs() });
    },
  });
}

export function useRunAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      actionId,
      input,
    }: {
      workspaceId: string;
      actionId: string;
      input?: Record<string, string>;
    }) => api.runAction(workspaceId, actionId, input),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: qk.runs(run.workspaceId) });
      void qc.invalidateQueries({ queryKey: qk.runs() });
    },
  });
}

export function useConfirmContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, selected }: { runId: string; selected: string[] }) =>
      api.confirmRunContext(runId, { selected }),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: qk.run(run.id) });
    },
  });
}

// ── Provider status ───────────────────────────────────────────────────────────
/** Save (or clear, when key is "") a provider API key, then refresh the
 *  provider status + settings so the configured badge updates immediately. */
export function useSetProviderKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => api.setProviderKey(id, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["providerStatus"] });
      void qc.invalidateQueries({ queryKey: qk.settings });
    },
  });
}

export function useProviderStatus() {
  return useQuery({
    queryKey: ["providerStatus"] as const,
    queryFn: api.getProviderStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: api.getSettings,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
    },
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: api.getMe,
    retry: false,
    // Don't throw on 401 — App.tsx uses the error state to show login
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useLoginAsGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.loginAsGuest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useUpdateMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: "standard" | "simple") => api.setMode(mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useUpdateContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (context: string) => api.setAccountContext(context),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

// ── Usage ─────────────────────────────────────────────────────────────────────
export function useUsage() {
  return useQuery({
    queryKey: qk.usage,
    queryFn: api.getUsage,
    staleTime: 30_000,
  });
}

export function useWorkspaceUsage(workspaceId: string) {
  return useQuery({
    queryKey: [...qk.usage, workspaceId] as const,
    queryFn: () => api.getWorkspaceUsage(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

// ── Scripts ───────────────────────────────────────────────────────────────────
export function useScripts(workspaceId: string) {
  return useQuery({
    queryKey: ["scripts", workspaceId] as const,
    queryFn: () => api.getScripts(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useScript(workspaceId: string, name: string) {
  return useQuery({
    queryKey: ["scripts", workspaceId, name] as const,
    queryFn: () => api.getScript(workspaceId, name),
    enabled: !!workspaceId && !!name,
  });
}

export function useSaveScript(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.saveScript(workspaceId, name, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scripts", workspaceId] });
    },
  });
}

export function useWorkspaceFile(workspaceId: string, path: string) {
  return useQuery({
    queryKey: ["workspace-file", workspaceId, path] as const,
    queryFn: () => api.getWorkspaceFile(workspaceId, path),
    enabled: !!workspaceId && !!path,
  });
}

export function useSaveWorkspaceFile(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.saveWorkspaceFile(workspaceId, path, content),
    onSuccess: (_, { path }) => {
      void qc.invalidateQueries({ queryKey: ["workspace-file", workspaceId, path] });
    },
  });
}

/**
 * Stage a data-file edit (Data-tab Save) instead of writing it directly.
 * Returns the created runId so the caller can deep-link to /runs/:runId/diff.
 * Apply happens from that diff view, and on apply the workspace's runs
 * + file queries should refresh — the diff view handles that itself.
 */
export function useStageWorkspaceFile(workspaceId: string) {
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.stageWorkspaceFile(workspaceId, path, content),
  });
}

export function useCreateWorkspaceFile(workspaceId: string) {
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.createWorkspaceFile(workspaceId, path, content),
  });
}

export function useGitStatus(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["git-status", workspaceId] as const,
    queryFn: () => api.getGitStatus(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

export function useGitCommit(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ message, paths }: { message: string; paths: string[] }) =>
      api.gitCommit(workspaceId, message, paths),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["git-status", workspaceId] });
    },
  });
}

export function useRunScript(workspaceId: string) {
  return useMutation({
    mutationFn: (name: string) => api.runScript(workspaceId, name),
  });
}

// ── Surface ───────────────────────────────────────────────────────────────────
export function useSurface(workspaceId: string) {
  return useQuery({
    queryKey: ["surface", workspaceId] as const,
    queryFn: () => api.getSurface(workspaceId),
    enabled: !!workspaceId,
    retry: false,
  });
}

export function useSaveSurface(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source: string) => api.saveSurface(workspaceId, source),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["surface", workspaceId] });
    },
  });
}

export function useBuildSurface(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.buildSurface(workspaceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["surface", workspaceId] });
    },
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
export function useSearch() {
  return useMutation({
    mutationFn: (query: string) => api.search(query),
  });
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export function useChats() {
  return useQuery({
    queryKey: ["chats"] as const,
    queryFn: api.getChats,
  });
}

export function useChat(id: string) {
  return useQuery({
    queryKey: ["chats", id] as const,
    queryFn: () => api.getChat(id),
    enabled: !!id,
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createChat,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useUpdateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: import("@ariadne/shared").UpdateChatInput }) =>
      api.updateChat(id, input),
    onSuccess: (chat) => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      void qc.invalidateQueries({ queryKey: ["chats", chat.id] });
    },
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteChat(id),
    // AV polish: optimistic update — the row disappears from the
    // sidebar list the instant the user clicks Delete, no waiting for
    // the network round-trip. Rollback on error.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["chats"] });
      const prev = qc.getQueryData<Chat[]>(["chats"]);
      if (prev) {
        qc.setQueryData<Chat[]>(["chats"], prev.filter((c) => c.id !== id));
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      // Roll back to the snapshot the cancel saved.
      if (ctx?.prev) qc.setQueryData(["chats"], ctx.prev);
    },
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: ["chats", id] });
    },
    onSettled: () => {
      // Reconcile with server (in case of races or new arrivals).
      void qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** AT/AU — bulk-delete the current user's chats with no messages.
 *  Pass olderHours to restrict to chats created more than N hours ago. */
export function useDeleteEmptyChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (olderHours?: number) => api.deleteEmptyChats(olderHours ?? 0),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Polls whether a generation is in progress for a chat — survives reconnects. */
export function useActiveGeneration(chatId: string) {
  return useQuery({
    queryKey: ["chat-active", chatId] as const,
    queryFn: () => api.getActiveGeneration(chatId),
    enabled: !!chatId,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}

export function useStopGeneration() {
  return useMutation({
    mutationFn: (chatId: string) => api.stopGeneration(chatId),
  });
}

/**
 * Edit a user message and stream a fresh assistant reply. The server
 * appends the prior content to the message's revisions log, deletes the
 * now-stale assistant turn (and any later turns), then SSE-streams the
 * regenerated answer — same event shape as useSendMessage.
 */
export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { chatId: string; messageId: string; content: string }
  >({
    mutationFn: async ({ chatId, messageId, content }) => {
      const streamingId = `__streaming_${Date.now()}`;
      await api.regenerateAfterEdit(chatId, messageId, { content }, {
        // Replace the existing user-message bubble (revisions etc. updated)
        // and drop every later message from the cache; add the streaming
        // assistant placeholder right after the edited message.
        onUserMessage: (editedMsg) => {
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            const messages = old.messages ?? [];
            const idx = messages.findIndex((m) => m.id === editedMsg.id);
            if (idx === -1) return old;
            const placeholder: ChatMessage = {
              id: streamingId,
              chatId,
              role: "assistant",
              content: "",
              attachments: [],
              webSearch: false,
              searchResults: null,
              images: null,
              agent: null,
              createdAt: new Date().toISOString(),
            };
            return {
              ...old,
              messages: [
                ...messages.slice(0, idx),
                editedMsg,
                placeholder,
              ],
            };
          });
        },
        onDelta: (text) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            content: m.content + text,
          }));
        },
        onStatus: (text) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            _streamStatus: text,
          } as ChatMessage & { _streamStatus?: string }));
        },
        onAgentPlan: (steps) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            agent: { steps },
          }));
        },
        onAgentStep: (step) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => {
            const cur = m.agent?.steps ?? [];
            const i = cur.findIndex((s) => s.id === step.id);
            const updated: AgentStep[] = i >= 0
              ? cur.map((s, idx) => (idx === i ? step : s))
              : [...cur, step];
            return { ...m, agent: { steps: updated } };
          });
        },
        onImages: (images) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({ ...m, images }));
        },
        onDone: (finalMsg) => {
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            const msgs = (old.messages ?? []).filter((m) => m.id !== streamingId);
            return { ...old, messages: [...msgs, finalMsg] };
          });
          qc.setQueryData(["chat-active", chatId], { active: null });
          void qc.invalidateQueries({ queryKey: ["chats"] });
        },
        onError: (error) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            _streamError: error,
          } as ChatMessage & { _streamError?: string }));
          qc.setQueryData(["chat-active", chatId], { active: null });
        },
      });
    },
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

export function useActions(workspaceId: string) {
  return useQuery({
    queryKey: ["actions", workspaceId] as const,
    queryFn: () => api.getActions(workspaceId),
    enabled: !!workspaceId,
    retry: false,
  });
}

export function useActionDefs(workspaceId: string) {
  return useQuery({
    queryKey: ["action-defs", workspaceId] as const,
    queryFn: () => api.getActionDefs(workspaceId),
    enabled: !!workspaceId,
    retry: false,
  });
}

export function useSaveActions(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source: string) => api.saveActions(workspaceId, source),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["actions", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["action-defs", workspaceId] });
    },
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

export function useReports(status?: string) {
  return useQuery({
    queryKey: ["reports", status ?? "all"] as const,
    queryFn: () => api.getReports(status),
    // Poll while a pending report is still awaiting background triage.
    refetchInterval: (query) => {
      const data = query.state.data as Report[] | undefined;
      return data?.some((r) => r.status === "pending" && !r.triage) ? 4000 : false;
    },
  });
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createReport,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useDecideReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "file" | "reject" }) =>
      api.decideReport(id, decision),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

// ── Chat streaming helpers ────────────────────────────────────────────────────

/** The shape we store in the query cache for a single chat. */
function getCachedChat(qc: QueryClient, chatId: string): Chat | undefined {
  return qc.getQueryData<Chat>(["chats", chatId]);
}

function setCachedChat(qc: QueryClient, chatId: string, updater: (old: Chat | undefined) => Chat | undefined) {
  qc.setQueryData<Chat>(["chats", chatId], updater);
}

/** Patch a message inside the cached chat, by id. */
function patchCachedMessage(
  qc: QueryClient,
  chatId: string,
  msgId: string,
  patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)
) {
  setCachedChat(qc, chatId, (old) => {
    if (!old) return old;
    return {
      ...old,
      messages: (old.messages ?? []).map((m) =>
        m.id === msgId
          ? typeof patch === "function"
            ? patch(m)
            : { ...m, ...patch }
          : m
      ),
    };
  });
}

export interface UseSendMessageOptions {
  /** Called when the server emits an `intent_suggestion` event mid-stream. */
  onIntentSuggestion?: (s: { actionId: string; actionName: string; reason: string }) => void;
}

/** Streaming mutation — manages cache directly; no server round-trip response value. */
export function useSendMessage(opts?: UseSendMessageOptions) {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    { chatId: string; input: import("@ariadne/shared").PostMessageInput }
  >({
    mutationFn: async ({ chatId, input }) => {
      const streamingId = `__streaming_${Date.now()}`;
      const optimisticUserId = `__optimistic_user_${streamingId}`;

      // Optimistic: show the user's message + a "thinking" assistant placeholder
      // INSTANTLY, before the request even starts. The server runs retrieval /
      // context-building first (which can take a beat), and only then echoes the
      // user message — so without this, your own message appears delayed. Both
      // are reconciled to the server's real ids when user_message arrives.
      const optimisticUser: ChatMessage = {
        id: optimisticUserId,
        chatId,
        role: "user",
        content: input.content,
        attachments: (input.attachments ?? []).map((a, i) => ({
          id: `${optimisticUserId}_att_${i}`,
          name: a.name,
          mediaType: a.mediaType,
          kind: a.mediaType.startsWith("image/") ? "image" : "file",
          size: Math.floor((a.dataBase64.length * 3) / 4),
        })),
        webSearch: input.webSearch === "on",
        searchResults: null,
        images: null,
        agent: null,
        createdAt: new Date().toISOString(),
      };
      const placeholder: ChatMessage = {
        id: streamingId,
        chatId,
        role: "assistant",
        content: "",
        attachments: [],
        webSearch: false,
        searchResults: null,
        images: null,
        agent: null,
        createdAt: new Date().toISOString(),
      };
      setCachedChat(qc, chatId, (old) =>
        old ? { ...old, messages: [...(old.messages ?? []), optimisticUser, placeholder] } : old,
      );

      await api.sendMessage(chatId, input, {
        onUserMessage: (userMsg) => {
          // Reconcile the optimistic user message with the server's real one.
          // Three cases keep it safe (never lose or duplicate the message):
          //  - real already present → drop the optimistic dupe
          //  - optimistic present   → swap in place (stays before the placeholder)
          //  - neither (cache wasn't ready at insert) → append
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            const msgs = old.messages ?? [];
            if (msgs.some((m) => m.id === userMsg.id)) {
              return { ...old, messages: msgs.filter((m) => m.id !== optimisticUserId) };
            }
            if (msgs.some((m) => m.id === optimisticUserId)) {
              return { ...old, messages: msgs.map((m) => (m.id === optimisticUserId ? userMsg : m)) };
            }
            return { ...old, messages: [...msgs, userMsg] };
          });
        },

        onDelta: (text) => {
          // Append text delta to streaming placeholder
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            content: m.content + text,
          }));
        },

        onStatus: (text) => {
          // Store status as a special attribute on the placeholder
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            // We re-use a custom field only while streaming; overwritten on done
            _streamStatus: text,
          } as ChatMessage & { _streamStatus?: string }));
        },

        onAgentPlan: (steps) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            agent: { steps },
          }));
        },

        onIntentSuggestion: (s) => {
          opts?.onIntentSuggestion?.(s);
        },

        onImages: (images) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => ({ ...m, images }));
        },

        onAgentStep: (step) => {
          patchCachedMessage(qc, chatId, streamingId, (m) => {
            const currentSteps = m.agent?.steps ?? [];
            const idx = currentSteps.findIndex((s) => s.id === step.id);
            const updatedSteps: AgentStep[] =
              idx >= 0
                ? currentSteps.map((s, i) => (i === idx ? step : s))
                : [...currentSteps, step];
            return {
              ...m,
              agent: { steps: updatedSteps },
            };
          });
        },

        onDone: (finalMsg) => {
          // Replace the streaming placeholder with the final message
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            const msgs = (old.messages ?? []).filter(
              (m) => m.id !== streamingId
            );
            return {
              ...old,
              messages: [...msgs, finalMsg],
            };
          });
          // Clean finish — clear the reconnect poll so its view never flashes.
          qc.setQueryData(["chat-active", chatId], { active: null });
          // Don't invalidate the chat list immediately — the title isn't
          // on the chat row yet (it arrives via the follow-up
          // chat_updated event from S1). Invalidating now would refetch
          // and replace the optimistic title with the stale untitled
          // one. We patch the cache when chat_updated arrives.
          //
          // BUT: if the title gen takes longer than the 2s SSE race
          // budget, chat_updated never fires and the sidebar shows the
          // raw user-message snippet until the next manual refresh
          // (non-dev report: N1 renamed, N3 didn't — inconsistent).
          // Schedule one refetch 4s after done as a safety net — by
          // then the async DB write should have landed.
          setTimeout(() => {
            void qc.invalidateQueries({ queryKey: ["chats"] });
          }, 4_000);
        },

        onChatUpdated: (chatIdEv, title) => {
          // Patch the chat list cache so the sidebar shows the new title
          // without a network round-trip. Also patch the chat object on
          // the chat detail cache.
          qc.setQueryData<Chat[] | undefined>(["chats"], (old) => {
            if (!old) return old;
            return old.map((c) =>
              c.id === chatIdEv ? { ...c, title } : c,
            );
          });
          setCachedChat(qc, chatIdEv, (old) => {
            if (!old) return old;
            return { ...old, title };
          });
        },

        onError: (error) => {
          // Mark the placeholder as errored
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            content: m.content || "",
            _streamError: error,
          } as ChatMessage & { _streamError?: string }));
          qc.setQueryData(["chat-active", chatId], { active: null });
        },

        onDisconnect: () => {
          // The stream dropped before completion — the generation keeps
          // running on the server. KEEP the placeholder (with its streamed-
          // so-far content) so nothing visibly vanishes; mark it so ThreadView
          // reconciles it from the /active poll, then refetches the saved
          // message once the generation finishes.
          patchCachedMessage(qc, chatId, streamingId, (m) => ({
            ...m,
            _disconnected: true,
          } as ChatMessage & { _disconnected?: boolean }));
          void qc.invalidateQueries({ queryKey: ["chat-active", chatId] });
        },
      });
    },
  });
}

// ── Agent attempts (Claude-Code Phase C) ──────────────────────────────────────

export function useOpenAttemptForChat(chatId: string) {
  return useQuery({
    queryKey: ["open-attempt", chatId] as const,
    queryFn: () => api.getOpenAttemptForChat(chatId),
    enabled: !!chatId,
    // The attempt's fileCount changes after every agent edit_file
    // tool call, so don't over-cache.
    staleTime: 0,
  });
}

export function useChatAttempts(chatId: string) {
  return useQuery({
    queryKey: ["chat-attempts", chatId] as const,
    queryFn: () => api.listAttemptsForChat(chatId),
    enabled: !!chatId,
  });
}

export function useAttempt(attemptId: string) {
  return useQuery({
    queryKey: ["attempt", attemptId] as const,
    queryFn: () => api.getAttempt(attemptId),
    enabled: !!attemptId,
    retry: false,
  });
}

export function useApplyAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ attemptId, paths }: { attemptId: string; paths: string[] }) =>
      api.applyAttempt(attemptId, paths),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ["attempt", vars.attemptId] });
      void qc.invalidateQueries({ queryKey: ["open-attempt"] });
    },
  });
}

export function useAbandonAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => api.abandonAttempt(attemptId),
    onSuccess: (_r, attemptId) => {
      void qc.invalidateQueries({ queryKey: ["attempt", attemptId] });
      void qc.invalidateQueries({ queryKey: ["open-attempt"] });
    },
  });
}

// ── Staged edits (Claude-Code Phase A) ────────────────────────────────────────

export function useStagedManifest(runId: string) {
  return useQuery({
    queryKey: ["staged", runId] as const,
    queryFn: () => api.getStagedManifest(runId),
    enabled: !!runId,
    // Stage manifests are append-only during a run — caching them stops
    // the diff view from flicker-refetching on every tab focus.
    staleTime: 60_000,
    retry: false,
  });
}

export function useApplyStagedEdits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, paths }: { runId: string; paths: string[] }) =>
      api.applyStagedEdits(runId, paths),
    onSuccess: (_result, vars) => {
      void qc.invalidateQueries({ queryKey: ["staged", vars.runId] });
    },
  });
}

export function useDiscardStagedEdits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.discardStagedEdits(runId),
    onSuccess: (_r, runId) => {
      void qc.invalidateQueries({ queryKey: ["staged", runId] });
    },
  });
}

// ── Workspace history ─────────────────────────────────────────────────────────

export function useWorkspaceHistory(workspaceId: string, limit = 50) {
  return useQuery({
    queryKey: ["workspace-history", workspaceId, limit] as const,
    queryFn: () => api.listWorkspaceHistory(workspaceId, limit),
    enabled: !!workspaceId,
  });
}

export function useRewindWorkspaceCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, sha }: { workspaceId: string; sha: string }) =>
      api.rewindWorkspaceCommit(workspaceId, sha),
    onSuccess: (_r, { workspaceId }) => {
      void qc.invalidateQueries({ queryKey: ["workspace-history", workspaceId] });
    },
  });
}

/** Detail for one commit (each file's pre/post bodies). The full-history
 *  page lazy-loads these as the user expands rows. */
export function useCommitDetail(workspaceId: string, sha: string | null) {
  return useQuery({
    queryKey: ["commit", workspaceId, sha] as const,
    queryFn: () => api.getCommitDetail(workspaceId, sha as string),
    enabled: !!workspaceId && !!sha,
    // Commits are immutable; cache forever within a session.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export function useSchedules(workspaceId: string) {
  return useQuery({
    queryKey: ["schedules", workspaceId] as const,
    queryFn: () => api.listSchedules(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      input,
    }: {
      workspaceId: string;
      input: import("@ariadne/shared").CreateScheduleInput;
    }) => api.createSchedule(workspaceId, input),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["schedules", created.workspaceId] });
    },
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: import("@ariadne/shared").UpdateScheduleInput;
    }) => api.updateSchedule(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<ActionSchedule[]>(
        ["schedules", updated.workspaceId] as const,
        (prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev),
      );
    },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId: string }) =>
      api.deleteSchedule(id).then(() => ({ id, workspaceId })),
    onSuccess: ({ id, workspaceId }) => {
      qc.setQueryData<ActionSchedule[]>(
        ["schedules", workspaceId] as const,
        (prev) => (prev ? prev.filter((s) => s.id !== id) : prev),
      );
    },
  });
}

// ── Event triggers ──────────────────────────────────────────────────────────

export function useTriggers(workspaceId: string) {
  return useQuery({
    queryKey: ["triggers", workspaceId] as const,
    queryFn: () => api.listTriggers(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useCreateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      input,
    }: {
      workspaceId: string;
      input: import("@ariadne/shared").CreateTriggerInput;
    }) => api.createTrigger(workspaceId, input),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["triggers", created.workspaceId] });
    },
  });
}

export function useDeleteTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId: string }) =>
      api.deleteTrigger(id).then(() => ({ id, workspaceId })),
    onSuccess: ({ id, workspaceId }) => {
      qc.setQueryData<import("@ariadne/shared").ActionTrigger[]>(
        ["triggers", workspaceId] as const,
        (prev) => (prev ? prev.filter((tr) => tr.id !== id) : prev),
      );
    },
  });
}

// ── Alerts (notification inbox) ─────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"] as const,
    queryFn: api.listAlerts,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markAlertRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllAlertsRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAlert(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useAccountLimits() {
  return useQuery({
    queryKey: ["accountLimits"] as const,
    queryFn: api.getAccountLimits,
    staleTime: 30_000,
  });
}

// ── Skills ────────────────────────────────────────────────────────────────────

/**
 * The account's skills (+ built-ins). With a workspaceId, also includes that
 * workspace's scoped skills; the key is per-workspace so the global list and a
 * workspace list are cached separately.
 */
export function useSkills(workspaceId?: string) {
  return useQuery({
    queryKey: ["skills", workspaceId ?? null] as const,
    queryFn: () => api.listSkills(workspaceId),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createSkill,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: import("@ariadne/shared").UpdateSkillInput }) =>
      api.updateSkill(id, input),
    onSuccess: () => {
      // Invalidate every skill list (global + per-workspace keys).
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
