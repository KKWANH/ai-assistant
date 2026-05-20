/**
 * Renders a single chat message.
 *
 * - User messages: right-aligned bubble.
 * - Assistant messages: background-less flowing document with real markdown.
 * - Agent messages: live step checklist above the final markdown answer.
 * - Streaming state: live status line / token cursor while generating.
 */
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  File,
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
import type { ChatMessage, ChatAttachment, SearchResult, AgentStep, AgentTool } from "@ariadne/shared";
import { Badge } from "../../components/ui/Badge";
import { useT } from "../../lib/i18n";
import * as api from "../../lib/api";

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
        className="px-1 rounded bg-surface-3 font-mono text-xs text-foreground"
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
        className="text-accent hover:underline"
      >
        {children}
      </a>
    );
  },
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm text-foreground leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
      <div className="flex items-center gap-2 py-1 rounded">
        <StepStatusIcon status={step.status} />
        <ToolIcon tool={step.tool} />
        <span
          className={[
            "text-xs flex-1 leading-snug",
            step.status === "done" ? "text-foreground/80" : "text-foreground",
            step.status === "failed" ? "line-through text-muted-foreground" : "",
          ].join(" ")}
        >
          {step.description}
        </span>
        {canExpand && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="ml-8 pl-2 border-l border-border text-xs text-muted-foreground leading-relaxed py-0.5">
          {step.result}
        </div>
      )}
    </div>
  );
}

// ── Agent checklist ───────────────────────────────────────────────────────────
function AgentChecklist({ steps }: { steps: AgentStep[] }) {
  const { t } = useT();
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
        <div className="px-3 pb-2 flex flex-col gap-0.5 divide-y divide-border/40">
          {steps.map((step) => (
            <AgentStepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attachment thumbnail/chip ─────────────────────────────────────────────────
function AttachmentItem({ att }: { att: ChatAttachment }) {
  if (att.kind === "image") {
    return (
      <a
        href={api.getUploadUrl(att.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <img
          src={api.getUploadUrl(att.id)}
          alt={att.name}
          className="max-w-[200px] max-h-[160px] rounded-lg border border-border object-cover"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[200px]">
          {att.name}
        </p>
      </a>
    );
  }
  return (
    <a
      href={api.getUploadUrl(att.id)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-2 hover:bg-surface-3 transition-colors text-xs"
    >
      <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[160px] text-foreground">{att.name}</span>
    </a>
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
              <p className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">
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
export function StreamingIndicator({ statusText }: { statusText: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{statusText || t("chat.streaming.generating")}</span>
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
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {time}
          </span>
          <div className="max-w-[540px] rounded-2xl rounded-br-sm px-3.5 py-2.5 bg-accent text-accent-foreground text-sm leading-relaxed">
            {message.content}
            {message.webSearch && (
              <Badge variant="default" className="ml-2 text-[10px] opacity-70">
                {t("chat.message.webSearch")}
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isAssistant) {
    const agentSteps = message.agent?.steps;
    const hasContent = message.content.length > 0;
    const isStreamingWithNoContent = isStreaming && !hasContent;

    return (
      <div className="flex flex-col items-start gap-1 group w-full">
        {/* Agent checklist */}
        {agentSteps && agentSteps.length > 0 && (
          <AgentChecklist steps={agentSteps} />
        )}

        {/* Live streaming status (before first delta arrives) */}
        {isStreamingWithNoContent && (
          <StreamingIndicator statusText={streamStatus} />
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
                <StreamingIndicator statusText={streamStatus} />
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
            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity block mt-1">
              {time}
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}
