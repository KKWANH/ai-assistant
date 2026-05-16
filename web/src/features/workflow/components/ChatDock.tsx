import React, { useMemo, useState } from "react";
import { DockedChatComposer } from "../../../components/chat/DockedChatComposer";
import { fetchJson } from "../../../lib/api";
import type { AccountLike, ChatPayload } from "../../../components/chat/Composer";
import type { ModelMode } from "../../../lib/modelModes";

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
  const [rerunStatus, setRerunStatus] = useState("");
  const badge = useMemo(() => {
    if (context.path) return context.path;
    if (context.runId) return context.runId;
    if (context.resourceType) return context.resourceType;
    return context.label;
  }, [context]);

  if (!projectPath) {
    return null;
  }

  async function rerunScopedStep() {
    if (!context.runId) return;
    setRerunStatus("Rerunning scoped step...");
    try {
      const body = new URLSearchParams({
        project: projectPath || "",
        run_id: context.runId,
        step_id: context.viewerSlotId || context.kind,
      });
      const payload = await fetchJson<{ run?: { run_id?: string; status?: string } }>("/api/project-run/rerun-step", {
        method: "POST",
        body,
      });
      setRerunStatus(`Rerun created: ${payload.run?.run_id || "new run"} · ${payload.run?.status || "queued"}`);
    } catch (err) {
      setRerunStatus(err instanceof Error ? err.message : String(err));
    }
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
      {context.runId && (
        <button type="button" className="secondary-button" onClick={rerunScopedStep}>
          Rerun scoped step
        </button>
      )}
      {rerunStatus && <p className="muted">{rerunStatus}</p>}
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
