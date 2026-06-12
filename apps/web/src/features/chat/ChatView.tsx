/**
 * ChatView — the main chat screen.
 * Routes: / (newest chat or empty state) and /chat/:id
 *
 * Empty state: welcoming panel with example actions.
 * Active thread: scrollable message list + pinned composer.
 *
 * Single source of truth = TanStack Query cache for the chat.
 * No local message arrays — streaming writes directly to the cache.
 */
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  FolderOpen,
  FileText,
  Play,
  MessageSquarePlus,
  KeyRound,
} from "lucide-react";
import type { Chat, ChatMessage, GenerationStatus } from "@ariadne/shared";
import { ChatSkeleton } from "./ChatSkeleton";
import {
  useChat,
  useCreateChat,
  useSendMessage,
  useActiveGeneration,
  useStopGeneration,
  useRunAction,
  useOpenAttemptForChat,
  useChatAttempts,
  useProviderStatus,
} from "../../lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "../../lib/store";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { ChatComposer, type WebSearchMode } from "./ChatComposer";
import { MessageBubble, StreamingIndicator } from "./MessageBubble";
import { WorkspaceContextStrip } from "./WorkspaceContextStrip";
import { Card } from "../../components/ui/Card";
import { NotFoundRedirect } from "../../components/NotFoundRedirect";

/** Format a chat's creation timestamp for the "started" line, localised. */
function formatStarted(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

// ── Empty state (new chat / no chat selected) ─────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  const { setCreateWorkspaceOpen, pulseComposer } = useUIStore();
  const { t } = useT();

  // BK1 — first-run provider guard. Until a real (non-mock) provider is
  // configured, typing into the composer silently goes nowhere; surface a calm
  // setup prompt instead. Default to "has provider" while the status loads so
  // the card never flashes for already-configured users.
  const { data: providerStatus } = useProviderStatus();
  const hasRealProvider = providerStatus
    ? providerStatus.some((p) => p.id !== "mock" && p.configured)
    : true;

  // EVERY chip is actionable. Mom's real-world test showed dashed
  // informational tips read as "broken buttons" — clicking them did
  // nothing and she gave up. The file + web chips now drive the
  // composer via the composerPulse store action (works across the
  // sibling-component boundary).
  const examples = [
    {
      icon: <FileText className="h-4 w-4 text-muted-foreground" />,
      title: t("chat.example.files.title"),
      body: t("chat.example.files.body"),
      action: () => pulseComposer("open_file_picker"),
      actionLabel: t("chat.example.files.action"),
    },
    {
      icon: <FolderOpen className="h-4 w-4 text-muted-foreground" />,
      title: t("chat.example.workspace.title"),
      body: t("chat.example.workspace.body"),
      action: () => setCreateWorkspaceOpen(true),
      actionLabel: t("chat.example.workspace.action"),
    },
    {
      icon: <Play className="h-4 w-4 text-muted-foreground" />,
      title: t("chat.example.template.title"),
      body: t("chat.example.template.body"),
      action: () => navigate("/workspaces"),
      actionLabel: t("chat.example.template.action"),
    },
    // Removed: web-search chip. The composer already has a permanent
    // web toggle visible on every chat — promoting it as an empty-state
    // chip duplicated discoverability without adding value.
  ];

  return (
    <div className="flex flex-col items-center justify-start sm:justify-center flex-1 min-h-0 overflow-y-auto px-8 py-12 max-w-2xl mx-auto w-full">
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("chat.empty.title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("chat.empty.subtitle")}
        </p>
      </div>

      {!hasRealProvider && (
        <Card className="w-full flex items-start gap-3 px-4 py-3.5 mb-3 border-warning/40 bg-warning/5">
          <KeyRound className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{t("chat.empty.noProvider.title")}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              {t("chat.empty.noProvider.body")}
            </p>
            <button
              className="self-start text-xs text-accent hover:underline mt-1.5"
              onClick={() => navigate("/settings")}
            >
              {t("chat.empty.noProvider.action")} →
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
        {examples.map((ex) =>
          ex.action ? (
            // Actionable — a real card with hover + an action link.
            <Card
              key={ex.title}
              interactive
              className="flex flex-col gap-2 px-4 py-3.5"
              onClick={ex.action}
            >
              <div className="flex items-center gap-2">
                {ex.icon}
                <p className="text-sm font-medium text-foreground">{ex.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{ex.body}</p>
              {ex.actionLabel && (
                <button
                  className="self-start text-xs text-accent hover:underline mt-0.5"
                  onClick={(e) => { e.stopPropagation(); ex.action?.(); }}
                >
                  {ex.actionLabel} →
                </button>
              )}
            </Card>
          ) : (
            // Informational tip — dashed + muted so it doesn't read as a button.
            <div
              key={ex.title}
              className="flex flex-col gap-2 px-4 py-3.5 rounded-xl border border-dashed border-border/70"
            >
              <div className="flex items-center gap-2">
                {ex.icon}
                <p className="text-sm font-medium text-muted-foreground">{ex.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{ex.body}</p>
            </div>
          )
        )}
      </div>

      <button
        className="mt-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={onCreate}
      >
        <MessageSquarePlus className="h-4 w-4" />
        {t("chat.empty.startNew")}
      </button>
      <button
        className="mt-2 text-xs text-accent hover:underline"
        onClick={() => navigate("/tutorial")}
      >
        {t("chat.empty.tutorialLink")} →
      </button>
    </div>
  );
}

// ── Message list ──────────────────────────────────────────────────────────────
function MessageList({
  messages,
  streaming,
  reconnectGen,
  chat,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  reconnectGen: GenerationStatus | null;
  chat: Chat | undefined;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useT();

  // A generation running on the server that this tab is not live-streaming
  // (another tab, or a reload mid-generation) — rendered as a streaming
  // assistant message so the live view resumes seamlessly.
  const synthetic: ChatMessage | null = reconnectGen
    ? {
        id: "__streaming_reconnect",
        chatId: reconnectGen.chatId,
        role: "assistant",
        content: reconnectGen.content,
        attachments: [],
        webSearch: false,
        searchResults: null,
        images: null,
        agent:
          reconnectGen.agentSteps.length > 0
            ? { steps: reconnectGen.agentSteps }
            : null,
        createdAt: reconnectGen.startedAt,
      }
    : null;

  useEffect(() => {
    // Instant (not smooth) — during streaming this fires on every token, and
    // a queued smooth animation just fights itself into jank.
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, streaming, reconnectGen]);

  if (messages.length === 0 && !streaming && !synthetic) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-muted-foreground italic">
          {t("chat.empty.sendToStart")}
        </p>
      </div>
    );
  }

  return (
    // `min-h-0` is the fix for the iPhone-SE composer-disappears bug. A
    // `flex-1 overflow-y-auto` child inside a `flex flex-col` parent will
    // ignore its parent's bounds (default `min-height: auto`) and the
    // following `shrink-0` siblings get pushed off-screen. `min-h-0`
    // restores the expected clipping.
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-6 px-3 sm:px-5 py-4 sm:py-5 max-w-4xl mx-auto">
        {chat && (
          <div className="flex flex-col items-center gap-1.5">
            <div className="text-center text-xs text-muted-foreground">
              {chat.createdByName && (
                <span className="font-medium text-foreground/70">{chat.createdByName}</span>
              )}
              {chat.createdByName ? "  ·  " : ""}
              {formatStarted(chat.createdAt, locale)}
            </div>
            {chat.workspaceId && <WorkspaceContextStrip workspaceId={chat.workspaceId} />}
          </div>
        )}
        {(() => {
          // One pass: for each assistant message, attach the text of the
          // most recent preceding user message. The eval-case promotion
          // modal uses it as the question to file. O(n) instead of the
          // n × n/2 backwards walk per render.
          const hints: (string | undefined)[] = [];
          let lastUserContent: string | undefined;
          for (const m of messages) {
            if (m.role === "user") lastUserContent = m.content;
            hints.push(m.role === "assistant" ? lastUserContent : undefined);
          }
          return messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              workspaceId={chat?.workspaceId ?? null}
              queryHint={hints[i]}
            />
          ));
        })()}
        {synthetic && <MessageBubble key={synthetic.id} message={synthetic} />}
        {streaming && messages.length === 0 && <StreamingIndicator statusText="" />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Thread view ───────────────────────────────────────────────────────────────
function ThreadView({ chatId }: { chatId: string }) {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const runAction = useRunAction();
  const [suggestion, setSuggestion] = useState<
    { actionId: string; actionName: string; reason: string } | null
  >(null);
  const sendMessage = useSendMessage({ onIntentSuggestion: setSuggestion });
  const stopGeneration = useStopGeneration();
  const { data: chat, isLoading } = useChat(chatId);
  const { data: activeData } = useActiveGeneration(chatId);
  const [streaming, setStreaming] = useState(false);

  // Query cache is the single source of truth — no local messages
  const messages: ChatMessage[] = chat?.messages ?? [];
  const activeGen = activeData?.active ?? null;

  // When a server generation finishes (active → null), pull the saved message.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const isActive = !!activeGen;
    if (wasActiveRef.current && !isActive) {
      void qc.invalidateQueries({ queryKey: ["chats", chatId] });
      void qc.invalidateQueries({ queryKey: ["chats"] });
    }
    wasActiveRef.current = isActive;
  }, [activeGen, chatId, qc]);

  // Keep a disconnected placeholder reconciled with the server-side
  // generation: feed it the /active poll while it runs, then pull the saved
  // message once it ends. Without this, a dropped stream looks like the
  // answer vanished.
  const reconciledRef = useRef<string | null>(null);
  useEffect(() => {
    const placeholder = messages.find(
      (m) =>
        m.id.startsWith("__streaming_") &&
        (m as ChatMessage & { _disconnected?: boolean })._disconnected,
    );
    if (!placeholder) {
      reconciledRef.current = null;
      return;
    }
    if (activeGen) {
      reconciledRef.current = null;
      if (placeholder.content === activeGen.content) return;
      qc.setQueryData<Chat>(["chats", chatId], (old) =>
        old
          ? {
              ...old,
              messages: (old.messages ?? []).map((m) =>
                m.id === placeholder.id
                  ? {
                      ...m,
                      content: activeGen.content || m.content,
                      agent:
                        activeGen.agentSteps.length > 0
                          ? { steps: activeGen.agentSteps }
                          : m.agent,
                    }
                  : m,
              ),
            }
          : old,
      );
    } else if (reconciledRef.current !== placeholder.id) {
      reconciledRef.current = placeholder.id;
      void qc.invalidateQueries({ queryKey: ["chats", chatId] });
    }
  }, [activeGen, messages, chatId, qc]);

  if (isLoading) {
    return <ChatSkeleton />;
  }

  // Loading finished but no chat came back — it was deleted (or never existed).
  // Bounce home instead of showing an empty, broken thread.
  if (!chat) return <NotFoundRedirect />;

  const hasLocalPlaceholder = messages.some((m) => m.id.startsWith("__streaming_"));
  // Show the reconnect view only for a generation this tab is not streaming.
  const reconnectGen =
    activeGen && !streaming && !hasLocalPlaceholder ? activeGen : null;
  const busy = streaming || hasLocalPlaceholder || !!activeGen;

  const handleSend = async (opts: {
    content: string;
    attachments: { name: string; mediaType: string; dataBase64: string }[];
    webSearch: WebSearchMode;
    workspaceId: string | null;
    replyMode: import("./ChatComposer").ReplyMode;
  }) => {
    setSuggestion(null); // clear any stale chip from the previous turn
    setStreaming(true);
    try {
      // Map the single-axis ReplyMode back to the server's (mode, agentMode)
      // pair. The composer surface stays clean; the API contract stays
      // backwards-compatible.
      const apiMode = opts.replyMode === "instant" ? "instant" : undefined;
      const apiAgentMode =
        opts.replyMode === "deep" ? "deep" :
        opts.replyMode === "agent" ? "on" :
        opts.replyMode === "auto" ? "auto" : undefined;
      await sendMessage.mutateAsync({
        chatId,
        input: {
          content: opts.content,
          attachments: opts.attachments,
          webSearch: opts.webSearch,
          agentMode: apiAgentMode,
          mode: apiMode,
        },
      });
    } catch (err) {
      toast({
        title: t("chat.failed.send"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleStop = () => {
    void stopGeneration.mutateAsync(chatId).catch(() => {
      /* best-effort — the stream ends on its own once aborted */
    });
  };

  const handleRunSuggestion = async () => {
    if (!suggestion || !chat?.workspaceId) return;
    try {
      const run = await runAction.mutateAsync({
        workspaceId: chat.workspaceId,
        actionId: suggestion.actionId,
      });
      setSuggestion(null);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      toast({
        title: t("actions.runFailed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <MessageList messages={messages} streaming={streaming} reconnectGen={reconnectGen} chat={chat} />
      <div className="shrink-0 px-3 sm:px-4 pt-2 max-w-4xl mx-auto w-full pb-[max(1rem,env(safe-area-inset-bottom))]">
        <OpenAttemptChip chatId={chatId} />
        <ChatComposer
          onSend={(opts) => void handleSend(opts)}
          pending={busy}
          onStop={busy ? handleStop : undefined}
          suggestion={suggestion}
          onRunSuggestion={() => void handleRunSuggestion()}
          onDismissSuggestion={() => setSuggestion(null)}
        />
      </div>
    </div>
  );
}

/** Compact chip above the composer when the chat has an open agent
 *  attempt (i.e. the agent staged file edits the user hasn't dispositioned
 *  yet). Links to the diff review page. */
function OpenAttemptChip({ chatId }: { chatId: string }) {
  const { t } = useT();
  const { data: attempt } = useOpenAttemptForChat(chatId);
  const { data: allAttempts } = useChatAttempts(chatId);
  const closedCount = (allAttempts ?? []).filter((a) => a.status !== "open").length;

  // Nothing to surface — no open attempt with files AND no historical
  // attempts. The chat shows zero chrome.
  if ((!attempt || attempt.fileCount === 0) && closedCount === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-2">
      {attempt && attempt.fileCount > 0 && (
        <Link
          to={`/attempts/${attempt.id}/diff`}
          className="flex-1 block px-3 py-2 rounded-lg border border-accent/40 bg-accent/10 text-xs text-accent hover:bg-accent/15 transition-colors"
        >
          {t("attempts.chipSummary", { n: attempt.fileCount })}
        </Link>
      )}
      {closedCount > 0 && (
        <Link
          to={`/chat/${chatId}/attempts`}
          className="px-3 py-2 rounded-lg border border-border bg-surface-2 text-2xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors shrink-0"
        >
          {t("attempts.viewAllN", { n: closedCount })}
        </Link>
      )}
    </div>
  );
}

// ── Root: empty state → create chat on send; thread if id given ───────────────
export function ChatView() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const createChat = useCreateChat();
  const sendMessage = useSendMessage();
  const qc = useQueryClient();

  const [pending, setPending] = useState(false);

  // If we have an id, render the thread
  if (id) {
    return <ThreadView chatId={id} />;
  }

  // Empty state: send creates a chat then sends the first message
  const handleSend = async (opts: {
    content: string;
    attachments: { name: string; mediaType: string; dataBase64: string }[];
    webSearch: WebSearchMode;
    workspaceId: string | null;
    replyMode: import("./ChatComposer").ReplyMode;
  }) => {
    setPending(true);
    try {
      const chat = await createChat.mutateAsync({
        workspaceId: opts.workspaceId ?? undefined,
      });

      // Seed the new chat cache with an empty messages array so ThreadView
      // never gets undefined messages on navigation
      qc.setQueryData(["chats", chat.id], { ...chat, messages: [] });

      // Navigate immediately so user sees the thread
      navigate(`/chat/${chat.id}`, { replace: true });

      const apiMode = opts.replyMode === "instant" ? "instant" : undefined;
      const apiAgentMode =
        opts.replyMode === "deep" ? "deep" :
        opts.replyMode === "agent" ? "on" :
        opts.replyMode === "auto" ? "auto" : undefined;
      // Send the message — streaming writes to the cache directly
      await sendMessage.mutateAsync({
        chatId: chat.id,
        input: {
          content: opts.content,
          attachments: opts.attachments,
          webSearch: opts.webSearch,
          agentMode: apiAgentMode,
          mode: apiMode,
        },
      });
    } catch (err) {
      toast({
        title: t("chat.failed.send.short"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    } finally {
      setPending(false);
    }
  };

  const handleCreateEmpty = async () => {
    try {
      const chat = await createChat.mutateAsync({});
      navigate(`/chat/${chat.id}`);
    } catch {
      toast({ title: t("chat.failed.create"), variant: "error" });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <EmptyState onCreate={() => void handleCreateEmpty()} />
      <div className="shrink-0 px-3 sm:px-4 pt-2 max-w-4xl mx-auto w-full pb-[max(1rem,env(safe-area-inset-bottom))]">
        <ChatComposer
          onSend={(opts) => void handleSend(opts)}
          pending={pending}
        />
      </div>
    </div>
  );
}
