import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { fetchJson } from "../../lib/api";
import { queryKeys } from "../../shared/api/client";
import type { ActiveChatPath, ChatPayload, ChatSession, DockContext, ModelMode } from "./Composer";

export type ChatSubmitMode = "normalChat" | "dockedContextChat" | "workflowStepChat";

export type ChatSubmitInput = {
  activePath: ActiveChatPath;
  content: string;
  files: File[];
  model: ModelMode;
  searchMode: string;
  mode: ChatSubmitMode;
  dockContext?: DockContext | null;
  allowRemote?: boolean;
  allowNetwork?: boolean;
  onSessionCreated?: (session: ChatSession) => void;
};

export function useChatSubmit(onAsk: (next: ChatPayload | ((current: ChatPayload | null) => ChatPayload)) => void) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onAsk((current) => ({
      ...(current || {}),
      messages: [
        ...(current?.messages || []).filter((message) => !message.pending),
        { role: "system", content: "Request stopped before AIWS received a final answer.", attachments: [] },
      ],
    }));
  }, [onAsk]);

  const submitMutation = useMutation({
    mutationFn: async (input: ChatSubmitInput) => {
      let targetPath = input.activePath;
      if (!input.activePath.sessionSlug) {
        const createUrl = input.activePath.projectPath ? `/api/sessions/${input.activePath.projectPath}` : "/api/chats";
        const title = input.mode === "normalChat" ? "" : `Dock: ${input.dockContext?.label || "Workflow context"}`;
        const sessionPayload = await fetchJson(createUrl, {
          method: "POST",
          body: new URLSearchParams({ title }),
        }) as { project_path?: string; session?: ChatSession };
        targetPath = {
          projectPath: input.activePath.projectPath || sessionPayload.project_path || "",
          sessionSlug: sessionPayload.session?.slug || "",
        };
        if (sessionPayload.session) {
          input.onSessionCreated?.({ ...sessionPayload.session, project_path: targetPath.projectPath });
        }
      }
      if (!targetPath.projectPath || !targetPath.sessionSlug) {
        throw new Error("Chat session is not ready.");
      }
      const form = new FormData();
      const scopedPrefix = input.mode !== "normalChat" && input.dockContext
        ? `Scoped context: ${input.dockContext.kind} · ${input.dockContext.path || input.dockContext.runId || input.dockContext.workflowAppId || input.dockContext.viewerSlotId || input.dockContext.resourceType || input.dockContext.label}\n\n`
        : "";
      form.set("content", `${scopedPrefix}${input.content}`);
      form.set("provider", input.model.provider);
      form.set("model", input.model.model);
      form.set("search_mode", input.searchMode);
      if (input.allowNetwork) form.set("allow_network", "1");
      if (input.allowRemote) {
        form.set("allow_remote", "1");
        form.set("confirm_cost", "1");
      }
      input.files.forEach((file) => form.append("attachment", file));
      const controller = new AbortController();
      abortRef.current = controller;
      const readyPath = { projectPath: targetPath.projectPath, sessionSlug: targetPath.sessionSlug };
      const payload = await fetchJson(`/api/ask/${readyPath.projectPath}/${readyPath.sessionSlug}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      }) as ChatPayload;
      return { payload, targetPath: readyPath };
    },
    onSuccess: ({ payload, targetPath }) => {
      onAsk(payload);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(targetPath.projectPath, targetPath.sessionSlug) });
      if (targetPath.projectPath) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectConfig(targetPath.projectPath) });
      }
    },
    onSettled: () => {
      abortRef.current = null;
    },
  });

  const submitChat = useCallback(async (input: ChatSubmitInput) => {
    const result = await submitMutation.mutateAsync(input);
    return result.payload;
  }, [submitMutation]);

  return { sending: submitMutation.isPending, submitChat, stop };
}
