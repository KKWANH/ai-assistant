import React, { useEffect, useRef, useState } from "react";
import { TaskSuggestionsPanel } from "../../components/actions/ActionPanels";
import { AttachmentList } from "../../components/chat/AttachmentList.jsx";
import { Composer } from "../../components/chat/Composer";
import { ContextReceiptCard } from "../../components/chat/ContextReceiptCard.jsx";
import { WaitingNotice } from "../../components/chat/WaitingNotice.jsx";
import { MarkdownRenderer } from "../../components/markdown/MarkdownRenderer.jsx";
import { StartPane } from "../../components/home/StartPane.jsx";
import { ProjectDashboard } from "../../components/project/ProjectDashboard.jsx";
import { AppsToolsCatalogPage } from "../../pages/AppsToolsCatalogPage.jsx";
import { COPY, copyForAccount, copyForLocale } from "../../shared/copy/copy";
import { fetchJson } from "../../lib/api.js";
import { DEFAULT_MODEL, modelLabel, normalizeModelCatalog } from "../../lib/modelModes.jsx";

export function CenterPane({ chat, activePath, account, projects, onAsk, onPreview, error, navigate, refreshWorkspace, contextOpen, onToggleContext, projectConfig, onProjectConfig, workspace, home, onHome, refreshHome }) {
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const models = normalizeModelCatalog(account?.model_catalog);
  if (activePath.view === "actions") {
    return <AppsToolsCatalogPage navigate={navigate} copy={copy} home={home} projects={projects} />;
  }
  if (activePath.projectPath && !activePath.sessionSlug) {
    const project = projects.find((item) => item.path === activePath.projectPath);
    return (
      <section className="center-pane project-workbench-page">
        <ProjectDashboard
          activePath={activePath}
          projectConfig={projectConfig}
          project={project}
          power={power}
          copy={copy}
          fetchJson={fetchJson}
          onProjectConfig={onProjectConfig}
          navigate={navigate}
        />
        <StartPane
          error={error}
          navigate={navigate}
          refreshWorkspace={refreshWorkspace}
          onAsk={onAsk}
          account={account}
          models={models}
          projectPath={activePath.projectPath}
          embedded
        />
      </section>
    );
  }
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <StartPane
        error={error}
        navigate={navigate}
        refreshWorkspace={refreshWorkspace}
        onAsk={onAsk}
        account={account}
        models={models}
        projectPath={activePath.projectPath}
        workspace={workspace}
        home={home}
        onHome={onHome}
        refreshHome={refreshHome}
      />
    );
  }

  return (
    <section className="center-pane">
      <div className="chat-header">
        <div>
          <p className="breadcrumb">{chat?.project?.hidden ? copy.chatHeader.chats : copy.chatHeader.workspace} / {chat?.project?.title || activePath.projectPath}</p>
          <EditableTitle chat={chat} activePath={activePath} onAsk={onAsk} refreshWorkspace={refreshWorkspace} />
        </div>
        <div className="context-chips">
          <span>{chat?.project?.hidden ? copy.chatHeader.privateChat : copy.chatHeader.projectMemory}</span>
          <span>{(chat?.attachments || []).length} {copy.chatHeader.files}</span>
          {chat?.goal?.objective && <span>{copy.chatHeader.goalSet}</span>}
          <span>{power ? `${chat?.latest?.provider || "ollama"} · ${modelLabel(chat?.latest?.model || DEFAULT_MODEL, models)}` : providerFriendlyLabel(chat?.latest?.provider || "ollama")}</span>
          <button className="chip-button" type="button" onClick={onToggleContext}>{contextOpen ? copy.chatHeader.close : copy.inspector.title}</button>
        </div>
      </div>
      <MessageTimeline messages={chat?.messages || []} onPreview={onPreview} activePath={activePath} onChat={onAsk} />
      <TaskSuggestionsPanel
        activePath={activePath}
        suggestions={chat?.task_suggestions || []}
        onProjectConfig={onProjectConfig}
        onChat={onAsk}
        power={power}
        fetchJson={fetchJson}
      />
      <Composer activePath={activePath} onAsk={onAsk} account={account} power={power} models={models} />
    </section>
  );
}

function EditableTitle({ chat, activePath, onAsk, refreshWorkspace }) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat?.session?.title || activePath.sessionSlug);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(chat?.session?.title || activePath.sessionSlug);
  }, [chat?.session?.title, activePath.sessionSlug]);

  async function submit(event) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setError("");
    try {
      const payload = await fetchJson(`/api/session-title/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: new URLSearchParams({ title: clean }),
      });
      onAsk((current) => ({ ...(current || {}), session: payload.session }));
      refreshWorkspace?.();
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err.message || copy.titleEdit.error);
    }
  }

  if (editing) {
    return (
      <form className="title-edit-form" onSubmit={submit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setTitle(chat?.session?.title || activePath.sessionSlug);
              setEditing(false);
            }
          }}
          autoFocus
        />
        <button type="submit">{copy.titleEdit.save}</button>
        <button type="button" onClick={() => setEditing(false)}>{copy.titleEdit.cancel}</button>
        {error && <small className="error-text">{error}</small>}
      </form>
    );
  }

  return (
    <div className="editable-title">
      <h1>{chat?.session?.title || activePath.sessionSlug}</h1>
      <button type="button" onClick={() => setEditing(true)} aria-label={copy.titleEdit.rename}>{copy.titleEdit.rename}</button>
      {saved && <small>{copy.titleEdit.saved}</small>}
    </div>
  );
}

function MessageTimeline({ messages, onPreview, activePath, onChat }) {
  const endRef = useRef(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (messages.length === 0) {
    return (
      <div className="messages empty-thread">
        <div className="desk-note">
          <h2>{copy.chat.emptyTitle}</h2>
          <p>{copy.chat.emptyBody}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="messages">
      {messages.map((message, index) => (
        <MessageCard key={`${index}-${message.role}`} message={message} onPreview={onPreview} activePath={activePath} onChat={onChat} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function MessageCard({ message, onPreview, activePath, onChat }) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  return (
    <article className={`message-card ${message.role} ${message.pending ? "is-pending" : ""}`}>
      <div className="message-meta">
        <strong>{messageAuthorLabel(message)}</strong>
        {message.created_at && <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>}
        {message.provider && <span>{message.provider} {message.model}</span>}
        {message.estimated_cost !== null && message.estimated_cost !== undefined && <span>USD {message.estimated_cost}</span>}
      </div>
      {message.pending ? <WaitingNotice label={copy.chat.assistantThinking} compact /> : <MarkdownRenderer>{message.content || ""}</MarkdownRenderer>}
      {message.role === "assistant" && !message.pending && activePath?.projectPath && (
        <MessageActions activePath={activePath} onChat={onChat} copy={copy} />
      )}
      {message.context_receipt && <ContextReceiptCard receipt={message.context_receipt} compact />}
      {message.execution_plan && <PlannerTraceSummary plan={message.execution_plan} />}
      <AttachmentList attachments={message.attachments || []} onPreview={onPreview} />
    </article>
  );
}

function MessageActions({ activePath, onChat, copy = COPY }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  async function saveArtifact() {
    if (!activePath?.projectPath || !activePath?.sessionSlug) return;
    setSaving(true);
    setError("");
    try {
      const payload = await fetchJson(`/api/chat-artifact/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: new URLSearchParams({ title: "Assistant Answer" }),
      });
      onChat((current) => ({
        ...(current || {}),
        work_session: {
          ...(current?.work_session || {}),
          artifacts: [...(current?.work_session?.artifacts || []), payload.artifact],
        },
      }));
      setSaved(true);
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="message-actions">
      <button type="button" onClick={saveArtifact} disabled={saving || saved}>
        {saving ? copy.messageActions.saving : saved ? copy.messageActions.saved : copy.messageActions.saveArtifact}
      </button>
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

function PlannerTraceSummary({ plan }) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return null;
  return (
    <details className="planner-trace-summary">
      <summary>Agent plan · {steps.length} steps · {plan.estimated_model_calls || 1} model call budget</summary>
      <div>
        {steps.map((step) => (
          <span key={step.id || step.title}>
            <b>{step.status}</b> {step.title || step.type}
          </span>
        ))}
      </div>
      {plan.requires_confirmation && <small>Web search runs only when selected. Sandbox/code execution still requires promotion into a Workflow App.</small>}
    </details>
  );
}

function messageAuthorLabel(message) {
  if (message.role === "user") return message.actor_display || displayNameForId(message.actor);
  if (message.role === "assistant") return COPY.brandCompact;
  if (message.role === "system") return "System";
  if (message.role === "tool") return message.actor_display ? `Tool · ${message.actor_display}` : "Tool";
  return message.actor_display || displayNameForId(message.actor) || message.role || "message";
}

function displayNameForId(id) {
  const map = {
    local: "Kwanho Kim",
    kwanho: "Kwanho Kim",
    kwanho0096: "Kwanho Kim",
    benetea: "Chungja Byun",
    dosadol: "Gunwoo Kim",
  };
  return map[id || "local"] || id || "Kwanho Kim";
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function providerFriendlyLabel(provider) {
  return provider === "kimi" ? "High-context AI" : "Fast local AI";
}

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}
