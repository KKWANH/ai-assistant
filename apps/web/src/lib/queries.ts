/**
 * TanStack Query hooks for all server state.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Run, RunStatus, Chat, ChatMessage, AgentStep, Report, Skill, ActionSchedule } from "@ariadne/shared";
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

export function useSnapshot(workspaceId: string) {
  return useQuery({
    queryKey: qk.snapshot(workspaceId),
    queryFn: () => api.getSnapshot(workspaceId),
    enabled: !!workspaceId,
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
export function useRuns(workspaceId?: string) {
  return useQuery({
    queryKey: qk.runs(workspaceId),
    queryFn: () => api.getRuns(workspaceId),
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
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      qc.removeQueries({ queryKey: ["chats", id] });
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
      // Streaming assistant placeholder id
      const streamingId = `__streaming_${Date.now()}`;

      await api.sendMessage(chatId, input, {
        onUserMessage: (userMsg) => {
          // Optimistically add user message to cache
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            const exists = (old.messages ?? []).some((m) => m.id === userMsg.id);
            if (exists) return old;
            return {
              ...old,
              messages: [...(old.messages ?? []), userMsg],
            };
          });

          // Insert streaming assistant placeholder
          const placeholder: ChatMessage = {
            id: streamingId,
            chatId,
            role: "assistant",
            content: "",
            attachments: [],
            webSearch: false,
            searchResults: null,
            agent: null,
            createdAt: new Date().toISOString(),
          };
          setCachedChat(qc, chatId, (old) => {
            if (!old) return old;
            return {
              ...old,
              messages: [...(old.messages ?? []), placeholder],
            };
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
          // Invalidate the chat list so the sidebar title updates
          void qc.invalidateQueries({ queryKey: ["chats"] });
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

// ── Workspace history ─────────────────────────────────────────────────────────

export function useWorkspaceHistory(workspaceId: string, limit = 50) {
  return useQuery({
    queryKey: ["workspace-history", workspaceId, limit] as const,
    queryFn: () => api.listWorkspaceHistory(workspaceId, limit),
    enabled: !!workspaceId,
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

// ── Skills ────────────────────────────────────────────────────────────────────

export function useSkills() {
  return useQuery({
    queryKey: ["skills"] as const,
    queryFn: api.listSkills,
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
    onSuccess: (updated) => {
      qc.setQueryData<Skill[]>(["skills"], (prev) =>
        prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
      );
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: (_, id) => {
      qc.setQueryData<Skill[]>(["skills"], (prev) =>
        prev ? prev.filter((s) => s.id !== id) : prev,
      );
    },
  });
}
