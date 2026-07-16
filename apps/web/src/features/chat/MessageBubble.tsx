/**
 * Renders a single chat message.
 *
 * - User messages: right-aligned bubble.
 * - Assistant messages: background-less flowing document with real markdown.
 * - Agent messages: live step checklist above the final markdown answer.
 * - Streaming state: live status line / token cursor while generating.
 */
import { useState, useEffect, lazy, Suspense, memo } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  File,
  FileSpreadsheet,
  Download,
  Globe,
  Check,
  X,
  Loader2,
  Clock,
  Search,
  FileText,
  Image as ImageIcon,
  Brain,
  Play,
  AlertCircle,
  Pencil,
  History,
  ThumbsDown,
  Pin,
} from "lucide-react";
import type { ChatMessage, ChatAttachment, SearchResult, AgentStep, AgentTrace, AgentTool } from "@ariadne/shared";
import { Badge } from "../../components/ui/Badge";
import { useT } from "../../lib/i18n";
import { localizeStatus } from "../../lib/statusText";
import * as api from "../../lib/api";
import { useEditMessage } from "../../lib/queries";
import { parseCsv } from "../../lib/tableData";
import { TableSheet } from "./TableSheet";
import { ImageGrid } from "./ImageGrid";
import { PromoteCaseModal } from "../eval/PromoteCaseModal";
import { SaveToMemoryModal } from "../memory/SaveToMemoryModal";

// ── Markdown renderer (react-markdown + remark-gfm) ──────────────────────────
// Lazy-load: react-markdown + remark-gfm + remark-cjk-friendly is a ~52 kB gz
// bundle that only assistant messages need. User messages render plain text,
// and the empty home state has no messages at all — keeping this off the
// initial ChatView chunk speeds up first paint for cold landings.
const MarkdownContent = lazy(() => import("./MarkdownContent"));

// Tiny placeholder while the markdown chunk fetches on first assistant reply.
// Renders the raw content so screen readers / no-JS still see something, and
// so the layout doesn't jump once the styled version mounts.
function MarkdownFallback({ content }: { content: string }) {
  return (
    <div className="text-[15px] text-foreground leading-[1.75] whitespace-pre-wrap">{content}</div>
  );
}

// ── Tool icon ─────────────────────────────────────────────────────────────────
function ToolIcon({ tool }: { tool: AgentTool }) {
  const cls = "h-3 w-3 shrink-0";
  switch (tool) {
    case "web_search": return <Search className={cls} />;
    case "read_file": return <FileText className={cls} />;
    case "list_files": return <FileText className={cls} />;
    case "analyze_image": return <ImageIcon className={cls} />;
    case "run_template": return <Play className={cls} />;
    case "reason": return <Brain className={cls} />;
    default: return <Brain className={cls} />;
  }
}

// ── Agent step status icon ────────────────────────────────────────────────────
function StepStatusIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "pending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-3 w-3 text-accent animate-spin" />;
    case "done":
      return <Check className="h-3 w-3 text-success" />;
    case "failed":
      return <X className="h-3 w-3 text-destructive" />;
  }
}

// ── Agent step row ────────────────────────────────────────────────────────────
function AgentStepRow({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = !!step.result;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2 py-1 rounded">
        <span className="mt-0.5 shrink-0"><StepStatusIcon status={step.status} /></span>
        <span className="mt-0.5 shrink-0"><ToolIcon tool={step.tool} /></span>
        <div className="flex-1 min-w-0">
          <span
            className={[
              "block text-xs leading-snug",
              step.status === "done" ? "text-foreground/80" : "text-foreground",
              step.status === "failed" ? "line-through text-muted-foreground" : "",
            ].join(" ")}
          >
            {step.description}
          </span>
          {step.note && (
            <span className="block text-2xs text-muted-foreground leading-snug mt-0.5">
              {step.note}
            </span>
          )}
        </div>
        {canExpand && (
          <button
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
      {expanded && step.result && (
        <div className="ml-8 pl-2 border-l border-border text-xs text-muted-foreground leading-relaxed py-0.5 whitespace-pre-wrap">
          {step.result}
        </div>
      )}
    </div>
  );
}

// ── Agent checklist ───────────────────────────────────────────────────────────
function AgentChecklist({ trace }: { trace: AgentTrace }) {
  const { t } = useT();
  const steps = trace.steps;
  const [collapsed, setCollapsed] = useState(false);
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "failed").length;
  const isRunning = steps.some((s) => s.status === "running");

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-2 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-3 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 text-success shrink-0" />
        )}
        <span className="flex-1 text-left">
          {t("chat.agent.steps", { done: String(doneCount), total: String(steps.length) })}
        </span>
        {collapsed ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {!collapsed && (
        <div className="px-3 pb-2">
          {trace.summary && (
            <p className="text-2xs text-muted-foreground leading-snug pt-0.5 pb-2 mb-1 border-b border-border/40">
              {trace.summary}
            </p>
          )}
          <div className="flex flex-col gap-0.5 divide-y divide-border/40">
            {steps.map((step) => (
              <AgentStepRow key={step.id} step={step} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Attachment preview helpers ────────────────────────────────────────────────
const TEXT_PREVIEW_EXT = [
  "txt", "text", "md", "markdown", "csv", "tsv", "json", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "sh", "bash",
  "html", "css", "scss", "xml", "sql", "toml", "ini", "log", "conf",
];

function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

type PreviewKind = "image" | "pdf" | "text" | "table" | "other";

function previewKind(att: ChatAttachment): PreviewKind {
  if (att.kind === "image") return "image";
  const ext = fileExt(att.name);
  if (att.mediaType === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "csv" || ext === "tsv" || att.mediaType === "text/csv") return "table";
  if (att.mediaType.startsWith("text/") || TEXT_PREVIEW_EXT.includes(ext)) return "text";
  return "other";
}

function FileTypeIcon({ att }: { att: ChatAttachment }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  const ext = fileExt(att.name);
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return <FileSpreadsheet className={cls} />;
  const kind = previewKind(att);
  if (kind === "text" || kind === "pdf") return <FileText className={cls} />;
  return <File className={cls} />;
}

// ── Attachment viewer modal ───────────────────────────────────────────────────
function AttachmentViewer({ att, onClose }: { att: ChatAttachment; onClose: () => void }) {
  const { t } = useT();
  const url = api.getUploadUrl(att.id);
  const kind = previewKind(att);
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    if (kind !== "text" && kind !== "table") return;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("fetch failed"))))
      .then((tx) => { if (!cancelled) setText(tx); })
      .catch(() => { if (!cancelled) setTextError(true); });
    return () => { cancelled = true; };
  }, [kind, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card/85 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.1] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border">
          <FileTypeIcon att={att} />
          <span className="flex-1 truncate text-sm font-medium text-foreground">{att.name}</span>
          <a
            href={url}
            download={att.name}
            className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            title={t("chat.attachment.download")}
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-surface-2">
          {kind === "image" && (
            <div className="flex items-center justify-center h-full p-4">
              <img src={url} alt={att.name} className="max-w-full max-h-full object-contain rounded" />
            </div>
          )}
          {kind === "pdf" && (
            <iframe src={url} title={att.name} className="w-full h-[72vh] border-0 bg-white" />
          )}
          {kind === "text" &&
            (text !== null ? (
              <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                {text}
              </pre>
            ) : textError ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                {t("chat.attachment.previewFailed")}
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ))}
          {kind === "table" &&
            (text !== null ? (
              <div className="p-4">
                <TableSheet rows={parseCsv(text)} />
              </div>
            ) : textError ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                {t("chat.attachment.previewFailed")}
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ))}
          {kind === "other" && (
            <div className="flex flex-col items-center justify-center gap-3 h-56 px-8 text-center">
              <File className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("chat.attachment.noPreview")}</p>
              <a
                href={url}
                download={att.name}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t("chat.attachment.download")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Attachment thumbnail/chip ─────────────────────────────────────────────────
function AttachmentItem({ att }: { att: ChatAttachment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {att.kind === "image" ? (
        <button type="button" onClick={() => setOpen(true)} className="block text-left group">
          <img
            src={api.getUploadUrl(att.id)}
            alt={att.name}
            className="max-w-[220px] max-h-[180px] rounded-lg border border-border object-cover group-hover:opacity-90 transition-opacity"
          />
          <p className="text-2xs text-muted-foreground mt-0.5 truncate max-w-[220px]">
            {att.name}
          </p>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-2 hover:bg-surface-3 transition-colors text-xs"
        >
          <FileTypeIcon att={att} />
          <span className="truncate max-w-[160px] text-foreground">{att.name}</span>
        </button>
      )}
      {open && <AttachmentViewer att={att} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Search sources ─────────────────────────────────────────────────────────────
function SearchSources({ results }: { results: SearchResult[] }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const label =
    results.length === 1
      ? t("chat.message.sources", { n: results.length })
      : t("chat.message.sourcesPlural", { n: results.length });
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Globe className="h-3.5 w-3.5" />
        <span>{label}</span>
        {open ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {results.map((r, i) => (
            <div
              key={`${r.url}-${i}`}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2"
            >
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <span className="truncate">{r.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <p className="text-2xs font-mono text-muted-foreground truncate mt-0.5">
                {r.url}
              </p>
              {r.snippet && (
                <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{r.snippet}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Streaming status line ─────────────────────────────────────────────────────

/** Live "M:SS" elapsed timer since `startedAt`; re-renders every second. */
function useElapsed(startedAt?: string): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60).toString()}:${String(s % 60).padStart(2, "0")}`;
}

export function StreamingIndicator({
  statusText,
  startedAt,
}: {
  statusText: string;
  startedAt?: string;
}) {
  const { t } = useT();
  const elapsed = useElapsed(startedAt);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      <span className="animate-pulse">{localizeStatus(statusText, t) || t("chat.streaming.generating")}</span>
      {elapsed && <span className="font-mono text-muted-foreground/60">{elapsed}</span>}
    </div>
  );
}

// ── User message — extracted so edit / history state stays scoped ─────────
function UserMessageBubble({
  message,
  time,
}: {
  message: ChatMessage;
  time: string;
}) {
  const { t } = useT();
  const editMessage = useEditMessage();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [historyOpen, setHistoryOpen] = useState(false);

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(message.content);
  };
  const commitEdit = () => {
    const next = draft.trim();
    if (!next || next === message.content) {
      cancelEdit();
      return;
    }
    // Close the editor immediately — the streamed regenerate plays out in
    // the assistant bubble below while the user message shows the new text.
    setEditing(false);
    void editMessage.mutateAsync({
      chatId: message.chatId,
      messageId: message.id,
      content: next,
    });
  };

  const revisionCount = message.revisions?.length ?? 0;

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="w-[540px] max-w-full rounded-2xl border border-accent px-3 py-2.5 bg-surface-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commitEdit();
              }
            }}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground"
            placeholder={t("chat.message.editPlaceholder")}
            disabled={editMessage.isPending}
          />
          <div className="mt-2 flex items-center justify-end gap-2 text-2xs">
            <span className="text-muted-foreground mr-auto">
              {t("chat.message.editHint")}
            </span>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={editMessage.isPending}
              className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={commitEdit}
              disabled={editMessage.isPending || !draft.trim() || draft.trim() === message.content}
              className="px-2.5 py-1 rounded-md bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editMessage.isPending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 group">
      {message.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2 max-w-[540px]">
          {message.attachments.map((att) => (
            <AttachmentItem key={att.id} att={att} />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        {/* Left-of-bubble controls: edit pencil + clock — appear on hover. */}
        <div className="flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={startEdit}
            aria-label={t("chat.message.edit")}
            title={t("chat.message.edit")}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <span className="text-2xs text-muted-foreground px-1">{time}</span>
        </div>
        <div className="max-w-[540px] rounded-2xl rounded-br-sm border border-border px-3.5 py-2.5 bg-surface-3 text-foreground text-[15px] leading-[1.7] whitespace-pre-wrap break-words">
          {message.content}
          {message.webSearch && (
            <Badge variant="default" className="ml-2 text-2xs opacity-70">
              {t("chat.message.webSearch")}
            </Badge>
          )}
        </div>
      </div>
      {/* "edited" affordance — clicking opens the revision history popover. */}
      {revisionCount > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <History className="h-3 w-3" />
            {t("chat.message.edited", { n: revisionCount })}
          </button>
          {historyOpen && (
            <RevisionHistoryPopover
              message={message}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Small popover listing the message's revisions (oldest first). */
function RevisionHistoryPopover({
  message,
  onClose,
}: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* click-outside scrim */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-30 w-[420px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card/72 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.08] shadow-lg p-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-xs font-medium text-foreground">
            {t("chat.message.editHistory")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ol className="flex flex-col gap-1.5">
          {(message.revisions ?? []).map((rev, i) => (
            <li
              key={`${rev.editedAt}-${i.toString()}`}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-2"
            >
              <div className="text-2xs text-muted-foreground mb-1">
                {new Date(rev.editedAt).toLocaleString()}
              </div>
              <div className="text-xs text-foreground whitespace-pre-wrap break-words">
                {rev.content}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export interface MessageBubbleProps {
  message: ChatMessage & { _streamStatus?: string; _streamError?: string };
  /** When this chat is scoped to a workspace, the 👎 → "Save as eval case"
   *  affordance shows on assistant messages. Without a workspace, there's
   *  nowhere to attach the case. */
  workspaceId?: string | null;
  /** The user message text that produced this assistant reply, used as
   *  the query when promoting to an eval case. ChatView computes this
   *  from the message list and passes it in. */
  queryHint?: string;
}

function MessageBubbleImpl({ message, workspaceId, queryHint }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const { t, locale } = useT();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [saveMemOpen, setSaveMemOpen] = useState(false);

  // Detect if this is a live streaming placeholder (id starts with __streaming_)
  const isStreaming = message.id.startsWith("__streaming_");
  const streamStatus = (message as MessageBubbleProps["message"])._streamStatus ?? "";
  const streamError = (message as MessageBubbleProps["message"])._streamError;

  // Format the message time in the user's chosen locale, not the
  // browser default. Without explicit locale tag, a Korean OS shows
  // "오후 2:14" even when the UI language is English (non-dev
  // report N5).
  const time = new Date(message.createdAt).toLocaleTimeString(
    locale === "ko" ? "ko-KR" : "en-US",
    { hour: "2-digit", minute: "2-digit" },
  );

  if (isUser) {
    // Don't allow editing while a streaming placeholder for this turn is
    // still resolving — the id `__streaming_*` only applies to the assistant
    // bubble, so user messages with a real id are always editable.
    return <UserMessageBubble message={message} time={time} />;
  }

  if (isAssistant) {
    const agentTrace = message.agent;
    const hasContent = message.content.length > 0;
    const isStreamingWithNoContent = isStreaming && !hasContent;

    return (
      <div className="flex flex-col items-start gap-1 group w-full">
        {/* Agent checklist */}
        {agentTrace && agentTrace.steps.length > 0 && (
          <AgentChecklist trace={agentTrace} />
        )}

        {/* Live streaming status (before first delta arrives) */}
        {isStreamingWithNoContent && (
          <StreamingIndicator statusText={streamStatus} startedAt={message.createdAt} />
        )}

        {/* Stream error — role=alert + aria-live so screen readers announce
            the failure the moment it appears, not only when navigated to. */}
        {streamError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-center gap-2 text-xs text-destructive"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{streamError}</span>
          </div>
        )}

        {/* Assistant content — flowing document, no bubble */}
        {hasContent && (
          <div className="w-full">
            <Suspense fallback={<MarkdownFallback content={message.content} />}>
              <MarkdownContent content={message.content} />
            </Suspense>

            {/* Live streaming cursor at end */}
            {isStreaming && (
              <span className="inline-block ml-0.5 mt-1">
                <StreamingIndicator statusText={streamStatus} startedAt={message.createdAt} />
              </span>
            )}

            {/* Search sources */}
            {message.searchResults && message.searchResults.length > 0 && (
              <SearchSources results={message.searchResults} />
            )}

            {message.images && message.images.length > 0 && (
              <ImageGrid images={message.images} />
            )}

            {/* Attachments */}
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {message.attachments.map((att) => (
                  <AttachmentItem key={att.id} att={att} />
                ))}
              </div>
            )}

            {/* Footer: timestamp + provider/model (hover-revealed). Model
                metadata is stamped per-message at insert time — older rows
                may be null and just hide the badge. */}
            <span className="text-2xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-2">
              <span>{time}</span>
              {(message.provider || message.model) && (
                <span className="font-mono">
                  · {[message.provider, message.model].filter(Boolean).join(" / ")}
                </span>
              )}
              {workspaceId && !isStreaming && (
                <button
                  type="button"
                  className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-3"
                  onClick={() => setSaveMemOpen(true)}
                  title={t("memory.save.openHint")}
                  aria-label={t("memory.save.openLabel")}
                >
                  <Pin className="h-3 w-3" />
                  <span>{t("memory.save.openLabel")}</span>
                </button>
              )}
              {workspaceId && queryHint && !isStreaming && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-surface-3"
                  onClick={() => setPromoteOpen(true)}
                  title={t("eval.promote.openHint")}
                  aria-label={t("eval.promote.openLabel")}
                >
                  <ThumbsDown className="h-3 w-3" />
                  <span>{t("eval.promote.openLabel")}</span>
                </button>
              )}
            </span>
          </div>
        )}
        {workspaceId && queryHint && promoteOpen && (
          <PromoteCaseModal
            open
            onClose={() => setPromoteOpen(false)}
            workspaceId={workspaceId}
            query={queryHint}
            source="chat"
            sourceRef={message.id}
          />
        )}
        {workspaceId && saveMemOpen && (
          <SaveToMemoryModal
            open
            onClose={() => setSaveMemOpen(false)}
            workspaceId={workspaceId}
            initialText={message.content}
            source={{ kind: "chat", ref: message.id }}
          />
        )}
      </div>
    );
  }

  return null;
}

/** Memoized so the 2s /active poll (and every streaming token re-rendering the
 *  parent MessageList) doesn't re-render every bubble — props are stable per
 *  message. The assistant markdown is already memoized inside MarkdownContent. */
export const MessageBubble = memo(MessageBubbleImpl);
