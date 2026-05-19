import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { TaskSuggestionsPanel, type CommandDefinition } from "../../components/actions/ActionPanels";
import { AttachmentList } from "../../components/chat/AttachmentList";
import { Composer } from "../../components/chat/Composer";
import { ContextReceiptCard } from "../../components/chat/ContextReceiptCard";
import { WaitingNotice } from "../../components/chat/WaitingNotice";
import { MarkdownRenderer } from "../../components/markdown/MarkdownRenderer";
import { COPY, copyForLocale } from "../../shared/copy/copy";
import { fetchJson } from "../../lib/api";
import { DEFAULT_MODEL, modelLabel, type ModelMode } from "../../lib/modelModes";
import type { AccountSummary } from "../../entities/workspace/types";
import type { ChatMessage } from "../../shared/contracts/workbench";
import type { ActivePath, ChatState, ProjectConfigState, RefreshFn, SetChatFn } from "../../shared/contracts/runtime";
import styles from "./ChatSurface.module.css";

export type ChatSurfaceProps = {
  chat: ChatState | null;
  activePath: ActivePath;
  account?: AccountSummary;
  models: ModelMode[];
  power: boolean;
  onAsk: SetChatFn;
  onPreview?: (attachment: unknown) => void;
  refreshWorkspace?: RefreshFn;
  contextOpen: boolean;
  onToggleContext: () => void;
  onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigState>>;
};

export function ChatSurface({
  chat,
  activePath,
  account,
  models,
  power,
  onAsk,
  onPreview,
  refreshWorkspace,
  contextOpen,
  onToggleContext,
  onProjectConfig,
}: ChatSurfaceProps) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const [composerDraft, setComposerDraft] = useState("");
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const latestReceipt = useMemo(() => [...(chat?.messages || [])].reverse().find((message) => message.context_receipt)?.context_receipt, [chat?.messages]);
  return (
    <section className={styles.surface}>
      <div className={styles.header}>
        <div>
          <p className={styles.scope}>{chat?.project?.hidden ? copy.chatHeader.chats : copy.chatHeader.workspace} / {chat?.project?.title || activePath.projectPath}</p>
          <EditableTitle chat={chat} activePath={activePath} onAsk={onAsk} refreshWorkspace={refreshWorkspace} />
        </div>
        <div className={styles.chips}>
          <span>{chat?.project?.hidden ? copy.chatHeader.privateChat : copy.chatHeader.projectMemory}</span>
          <span>{(chat?.attachments || []).length} {copy.chatHeader.files}</span>
          {Boolean(chat?.goal?.objective) && <span>{copy.chatHeader.goalSet}</span>}
          <span>{power ? `${String(chat?.latest?.provider || "ollama")} · ${modelLabel(String(chat?.latest?.model || DEFAULT_MODEL), models)}` : providerFriendlyLabel(String(chat?.latest?.provider || "ollama"))}</span>
          <button className={styles.chipButton} type="button" onClick={onToggleContext}>{contextOpen ? copy.chatHeader.close : copy.inspector.title}</button>
        </div>
      </div>
      {latestReceipt && <CompactReceiptLine receipt={latestReceipt as Record<string, unknown>} />}
      <MessageTimeline
        messages={chat?.messages || []}
        onPreview={onPreview}
        activePath={activePath}
        onEdit={(message: ChatMessage, index: number) => editFromMessage(message, index, activePath, onAsk, setComposerDraft, setComposerFocusSignal)}
        onRetry={(index: number) => retryFromMessage(chat?.messages || [], index, activePath, onAsk, setComposerDraft, setComposerFocusSignal)}
      />
      <TaskSuggestionsPanel
        activePath={activePath}
        suggestions={(chat?.task_suggestions || []) as CommandDefinition[]}
        onProjectConfig={onProjectConfig}
        onChat={onAsk}
        power={power}
        fetchJson={fetchJson}
      />
      <Composer
        activePath={activePath}
        onAsk={onAsk}
        account={account}
        power={power}
        models={models}
        initialContent={composerDraft}
        focusSignal={composerFocusSignal}
      />
    </section>
  );
}

type EditableTitleProps = {
  chat: ChatState | null;
  activePath: ActivePath;
  onAsk: SetChatFn;
  refreshWorkspace?: RefreshFn;
};

function EditableTitle({ chat, activePath, onAsk, refreshWorkspace }: EditableTitleProps) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat?.session?.title || activePath.sessionSlug);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(chat?.session?.title || activePath.sessionSlug);
  }, [chat?.session?.title, activePath.sessionSlug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setError("");
    try {
      const payload = await fetchJson<{ session: ChatState["session"] }>(`/api/session-title/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: new URLSearchParams({ title: clean }),
      });
      onAsk((current: ChatState | null) => ({ ...(current || {}), session: payload.session }));
      refreshWorkspace?.();
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.titleEdit.error);
    }
  }

  if (editing) {
    return (
      <form className={styles.titleForm} onSubmit={submit}>
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
        {error && <small className={styles.error}>{error}</small>}
      </form>
    );
  }

  return (
    <div className={styles.titleRow}>
      <h1>{chat?.session?.title || activePath.sessionSlug}</h1>
      <button className={styles.renameButton} type="button" onClick={() => setEditing(true)} aria-label={copy.titleEdit.rename}>{copy.titleEdit.rename}</button>
      {saved && <small>{copy.titleEdit.saved}</small>}
    </div>
  );
}

type MessageTimelineProps = {
  messages: ChatMessage[];
  onPreview?: (attachment: unknown) => void;
  activePath: ActivePath;
  onEdit: (message: ChatMessage, index: number) => void | Promise<void>;
  onRetry: (index: number) => void | Promise<void>;
};

function MessageTimeline({ messages, onPreview, activePath, onEdit, onRetry }: MessageTimelineProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (messages.length === 0) {
    return (
      <div className={`${styles.messages} ${styles.emptyThread}`}>
        <div className={styles.emptyCard}>
          <h2>{copy.chat.emptyTitle}</h2>
          <p>{copy.chat.emptyBody}</p>
          <div className={styles.emptyActions} aria-label="Suggested first actions">
            <span>파일 추가</span>
            <span>프로젝트 자료로 질문</span>
            <span>웹 검색 켜기</span>
            <span>산출물 만들기</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.messages}>
      {messages.map((message, index) => (
        <MessageCard key={`${index}-${message.role}`} message={message} index={index} onPreview={onPreview} activePath={activePath} onEdit={onEdit} onRetry={onRetry} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

type MessageCardProps = {
  message: ChatMessage;
  index: number;
  onPreview?: (attachment: unknown) => void;
  activePath: ActivePath;
  onEdit: (message: ChatMessage, index: number) => void | Promise<void>;
  onRetry: (index: number) => void | Promise<void>;
};

function MessageCard({ message, index, onPreview, activePath, onEdit, onRetry }: MessageCardProps) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const roleClass = message.role === "user" ? styles.user : message.role === "assistant" ? styles.assistant : message.role === "tool" ? styles.tool : styles.system;
  return (
    <article className={`${styles.messageCard} ${roleClass} ${message.pending ? styles.pending : ""}`}>
      <div className={styles.messageMeta}>
        <strong>{messageAuthorLabel(message)}</strong>
        {message.created_at && <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>}
        {message.provider && <span>{message.provider} {message.model}</span>}
        {message.estimated_cost !== null && message.estimated_cost !== undefined && <span>USD {message.estimated_cost}</span>}
      </div>
      {message.pending ? <WaitingNotice label={pendingStepLabel(message, copy)} compact /> : <MarkdownRenderer>{message.content || ""}</MarkdownRenderer>}
      {!message.pending && activePath?.projectPath && (
        <MessageActions message={message} index={index} copy={copy} onEdit={onEdit} onRetry={onRetry} />
      )}
      {message.context_receipt && <ContextReceiptCard receipt={message.context_receipt} compact />}
      {message.execution_plan && <PlannerTraceSummary plan={message.execution_plan as PlannerTrace} />}
      <AttachmentList attachments={message.attachments || []} onPreview={onPreview} />
    </article>
  );
}

type MessageActionsProps = {
  message: ChatMessage;
  index: number;
  copy?: typeof COPY;
  onEdit: (message: ChatMessage, index: number) => void | Promise<void>;
  onRetry: (index: number) => void | Promise<void>;
};

function MessageActions({ message, index, copy = COPY, onEdit, onRetry }: MessageActionsProps) {
  function downloadAnswer() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    const blob = new window.Blob([String(message?.content || "")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aiws-answer-${stamp}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div className={styles.messageActions}>
      {message.role === "user" && <button type="button" onClick={() => onEdit?.(message, index)}>수정</button>}
      {message.role === "assistant" && <button type="button" onClick={() => onRetry?.(index)}>다시 시도</button>}
      {message.role === "assistant" && <span className={styles.variantNav}>‹ 1 / 1 ›</span>}
      <button type="button" onClick={downloadAnswer}>{copy.messageActions.download || "Download"}</button>
    </div>
  );
}

async function editFromMessage(
  message: ChatMessage,
  index: number,
  activePath: ActivePath,
  onAsk: SetChatFn,
  setComposerDraft: React.Dispatch<React.SetStateAction<string>>,
  setComposerFocusSignal: React.Dispatch<React.SetStateAction<number>>,
) {
  if (!activePath?.projectPath || !activePath?.sessionSlug) return;
  const payload = await fetchJson<{ messages: ChatMessage[] }>(`/api/session-truncate/${activePath.projectPath}/${activePath.sessionSlug}`, {
    method: "POST",
    body: new URLSearchParams({ keep: String(index) }),
  });
  onAsk((current: ChatState | null) => ({ ...(current || {}), messages: payload.messages || [] }));
  setComposerDraft(message.content || "");
  setComposerFocusSignal((value) => value + 1);
}

async function retryFromMessage(
  messages: ChatMessage[],
  index: number,
  activePath: ActivePath,
  onAsk: SetChatFn,
  setComposerDraft: React.Dispatch<React.SetStateAction<string>>,
  setComposerFocusSignal: React.Dispatch<React.SetStateAction<number>>,
) {
  const userIndex = messages.slice(0, index).map((message, itemIndex) => ({ message, itemIndex })).reverse().find((item) => item.message.role === "user")?.itemIndex;
  if (userIndex === undefined) return;
  await editFromMessage(messages[userIndex], userIndex, activePath, onAsk, setComposerDraft, setComposerFocusSignal);
}

type PlanStep = { id?: string; type?: string; title?: string; status?: string };
type PlannerTrace = { steps?: PlanStep[]; estimated_model_calls?: number; requires_confirmation?: boolean };

function pendingStepLabel(message: ChatMessage, copy: typeof COPY) {
  const plan = message.execution_plan as PlannerTrace | undefined;
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const active = steps.find((step: PlanStep) => step.status === "running") || steps.find((step: PlanStep) => step.status === "pending");
  return active?.title || copy.chat.assistantThinking;
}

function PlannerTraceSummary({ plan }: { plan?: PlannerTrace }) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return null;
  const estimatedCalls = plan?.estimated_model_calls || 1;
  return (
    <details className={styles.plannerTrace}>
      <summary>Execution plan · {steps.length} steps · {estimatedCalls} model call budget</summary>
      <div>
        {steps.map((step: PlanStep) => (
          <span key={step.id || step.title}>
            <b>{step.status}</b> {step.title || step.type}
          </span>
        ))}
      </div>
      {plan?.requires_confirmation && <small>Web search runs only when selected. Sandbox/code execution still requires promotion into a Workflow App.</small>}
    </details>
  );
}

function CompactReceiptLine({ receipt }: { receipt: Record<string, unknown> }) {
  const files = Array.isArray(receipt.files_used) ? receipt.files_used.length : Array.isArray(receipt.included_files) ? receipt.included_files.length : 0;
  const chunks = Array.isArray(receipt.included_chunks) ? receipt.included_chunks.length : 0;
  const cost = typeof receipt.estimated_cost_usd === "number" ? receipt.estimated_cost_usd : typeof receipt.estimated_cost === "number" ? receipt.estimated_cost : 0;
  const mode = receipt.local === true ? "local" : receipt.cloud === true ? "cloud" : String(receipt.provider || "model");
  return <div className={styles.receiptLine}>Context used · {mode} · {files} files · {chunks} sources · USD {cost}</div>;
}

function messageAuthorLabel(message: ChatMessage) {
  if (message.role === "user") return message.actor_display || displayNameForId(message.actor);
  if (message.role === "assistant") return COPY.brandCompact;
  if (message.role === "system") return "System";
  if (message.role === "tool") return message.actor_display ? `Tool · ${message.actor_display}` : "Tool";
  return message.actor_display || displayNameForId(message.actor) || message.role || "message";
}

function displayNameForId(id?: string) {
  const map: Record<string, string> = {
    local: "Kwanho Kim",
    kwanho: "Kwanho Kim",
    kwanho0096: "Kwanho Kim",
    benetea: "Chungja Byun",
    dosadol: "Gunwoo Kim",
  };
  return map[id || "local"] || id || "Kwanho Kim";
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function providerFriendlyLabel(provider?: string) {
  return provider === "kimi" ? "High-context AI" : "Fast local AI";
}
