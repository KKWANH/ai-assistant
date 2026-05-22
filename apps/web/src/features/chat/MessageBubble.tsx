/**
 * Renders a single chat message.
 *
 * - User messages: right-aligned bubble.
 * - Assistant messages: background-less flowing document with real markdown.
 * - Agent messages: live step checklist above the final markdown answer.
 * - Streaming state: live status line / token cursor while generating.
 */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Lets `**bold**` / `*italic*` parse when the delimiters touch CJK characters
// (e.g. `**공**과`) — plain CommonMark flanking rules reject those as emphasis.
import remarkCjkFriendly from "remark-cjk-friendly";
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
} from "lucide-react";
import type { ChatMessage, ChatAttachment, SearchResult, AgentStep, AgentTrace, AgentTool } from "@ariadne/shared";
import { Badge } from "../../components/ui/Badge";
import { useT } from "../../lib/i18n";
import * as api from "../../lib/api";
import { parseCsv } from "../../lib/tableData";
import { TableSheet } from "./TableSheet";

// ── Markdown renderer (react-markdown + remark-gfm) ──────────────────────────
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Code blocks
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre className="my-2 rounded-md bg-surface-3 border border-border px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code
        className="px-1 rounded bg-surface-3 border border-border font-mono text-xs text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Headings
  h1({ children }) {
    return <h1 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h3>;
  },
  // Paragraphs
  p({ children }) {
    return <p className="mt-1.5 first:mt-0 leading-relaxed">{children}</p>;
  },
  // Lists
  ul({ children }) {
    return <ul className="my-1.5 ml-4 space-y-0.5 list-disc text-foreground">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-1.5 ml-4 space-y-0.5 list-decimal text-foreground">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  // Tables
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-xs border-collapse border border-border">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-surface-3">{children}</thead>;
  },
  th({ children }) {
    return <th className="border border-border px-2 py-1 text-left font-medium text-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>;
  },
  // Blockquote
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },
  // HR
  hr() {
    return <hr className="border-border my-3" />;
  },
  // Links
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground"
      >
        {children}
      </a>
    );
  },
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm text-foreground leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
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
            <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">
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
            <p className="text-[11px] text-muted-foreground leading-snug pt-0.5 pb-2 mb-1 border-b border-border/40">
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
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
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
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[220px]">
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
              <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
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
      <span className="animate-pulse">{statusText || t("chat.streaming.generating")}</span>
      {elapsed && <span className="font-mono text-muted-foreground/60">{elapsed}</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export interface MessageBubbleProps {
  message: ChatMessage & { _streamStatus?: string; _streamError?: string };
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const { t } = useT();

  // Detect if this is a live streaming placeholder (id starts with __streaming_)
  const isStreaming = message.id.startsWith("__streaming_");
  const streamStatus = (message as MessageBubbleProps["message"])._streamStatus ?? "";
  const streamError = (message as MessageBubbleProps["message"])._streamError;

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
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
          <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {time}
          </span>
          <div className="max-w-[540px] rounded-2xl rounded-br-sm border border-border px-3.5 py-2.5 bg-surface-3 text-foreground text-sm leading-relaxed">
            {message.content}
            {message.webSearch && (
              <Badge variant="default" className="ml-2 text-[11px] opacity-70">
                {t("chat.message.webSearch")}
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
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

        {/* Stream error */}
        {streamError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{streamError}</span>
          </div>
        )}

        {/* Assistant content — flowing document, no bubble */}
        {hasContent && (
          <div className="w-full">
            <MarkdownContent content={message.content} />

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

            {/* Attachments */}
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {message.attachments.map((att) => (
                  <AttachmentItem key={att.id} att={att} />
                ))}
              </div>
            )}

            {/* Timestamp on hover */}
            <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity block mt-1">
              {time}
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}
