/**
 * TanStack Query hooks for all server state.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Run, RunStatus, Chat, ChatMessage, AgentStep } from "@ariadne/shared";
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

// ── Actions ───────────────────────────────────────────────────────────────────

export function useActions(workspaceId: string) {
  return useQuery({
    queryKey: ["actions", workspaceId] as const,
    queryFn: () => api.getActions(workspaceId),
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

/** Streaming mutation — manages cache directly; no server round-trip response value. */
export function useSendMessage() {
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
        },
      });
    },
  });
}
