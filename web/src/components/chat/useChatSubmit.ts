import { useCallback, useRef, useState } from "react";
import { fetchJson } from "../../lib/api";
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
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    onAsk((current) => ({
      ...(current || {}),
      messages: [
        ...(current?.messages || []).filter((message) => !message.pending),
        { role: "system", content: "Request stopped before AIWS received a final answer.", attachments: [] },
      ],
    }));
  }, [onAsk]);

  const submitChat = useCallback(async (input: ChatSubmitInput) => {
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
    if (!targetPath.projectPath || !targetPath.sessionSlug) return null;
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
    setSending(true);
    try {
      const payload = await fetchJson(`/api/ask/${targetPath.projectPath}/${targetPath.sessionSlug}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      }) as ChatPayload;
      onAsk(payload);
      return payload;
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [onAsk]);

  return { sending, submitChat, stop };
}
