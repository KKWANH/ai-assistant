import React, { useMemo, useState } from "react";
import { DockedChatComposer } from "../../../components/chat/DockedChatComposer";
import type { AccountLike, ChatPayload, ModelMode } from "../../../components/chat/Composer";

type DockContext = {
  kind: "artifact" | "run" | "resource" | "workflow" | "workflow_step";
  label: string;
  path?: string;
  runId?: string;
  workflowAppId?: string;
  viewerSlotId?: string;
  resourceType?: string;
};

type ChatDockProps = {
  projectPath?: string;
  context: DockContext;
  account?: AccountLike;
  power?: boolean;
  models?: ModelMode[];
  navigate?: (path: string) => void;
};

export function ChatDock({ projectPath, context, account, power, models, navigate }: ChatDockProps) {
  const [sessionSlug, setSessionSlug] = useState("");
  const [chat, setChat] = useState<ChatPayload>({ messages: [] });
  const badge = useMemo(() => {
    if (context.path) return context.path;
    if (context.runId) return context.runId;
    if (context.resourceType) return context.resourceType;
    return context.label;
  }, [context]);

  if (!projectPath) {
    return null;
  }

  return (
    <aside className="chat-dock" aria-label="Workflow Chat Dock">
      <div className="section-row">
        <div>
          <p className="eyebrow">Chat Dock</p>
          <h3>Ask about this {context.kind}</h3>
        </div>
        <span className="soft-pill">{badge}</span>
      </div>
      <p className="muted">Use a small scoped chat for interpretation, errors, or partial edits without rerunning the whole Workflow App.</p>
      <DockedChatComposer
        activePath={{ projectPath, sessionSlug }}
        onAsk={setChat}
        account={account}
        power={Boolean(power)}
        models={models}
        dockContext={context}
        onSessionCreated={(session: { slug?: string }) => setSessionSlug(session.slug || "")}
      />
      <button
        type="button"
        className="secondary-button"
        disabled={!sessionSlug}
        onClick={() => sessionSlug && navigate?.(`/chat/${projectPath}/${sessionSlug}`)}
      >
        Open full chat session
      </button>
      {Array.isArray(chat.messages) && chat.messages.length > 0 && (
        <div className="dock-message-list">
          {(chat.messages as Array<{ role?: string; content?: string; pending?: boolean }>).slice(-4).map((message, index) => (
            <div className={`dock-message ${message.role || "system"}`} key={`${message.role}-${index}`}>
              <strong>{message.pending ? "working" : message.role || "system"}</strong>
              <p>{message.pending ? "Preparing scoped answer..." : message.content}</p>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
