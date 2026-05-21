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
import { useParams, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  FileText,
  Play,
  MessageSquarePlus,
  Globe,
} from "lucide-react";
import type { ChatMessage, GenerationStatus } from "@ariadne/shared";
import {
  useChat,
  useCreateChat,
  useSendMessage,
  useActiveGeneration,
  useStopGeneration,
} from "../../lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "../../lib/store";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble, StreamingIndicator } from "./MessageBubble";
import { Card } from "../../components/ui/Card";

// ── Empty state (new chat / no chat selected) ─────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate();
  const { setCreateWorkspaceOpen } = useUIStore();
  const { t } = useT();

  const examples = [
    {
      icon: <FileText className="h-4 w-4 text-muted-foreground" />,
      title: t("chat.example.files.title"),
      body: t("chat.example.files.body"),
      action: undefined,
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
    {
      icon: <Globe className="h-4 w-4 text-muted-foreground" />,
      title: t("chat.example.web.title"),
      body: t("chat.example.web.body"),
      action: undefined,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-8 py-12 max-w-2xl mx-auto w-full">
      <div className="mb-8 text-center">
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {t("chat.empty.title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("chat.empty.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
        {examples.map((ex) => (
          <Card
            key={ex.title}
            interactive={!!ex.action}
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
        ))}
      </div>

      <button
        className="mt-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={onCreate}
      >
        <MessageSquarePlus className="h-4 w-4" />
        {t("chat.empty.startNew")}
      </button>
    </div>
  );
}

// ── Message list ──────────────────────────────────────────────────────────────
function MessageList({
  messages,
  streaming,
  reconnectGen,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  reconnectGen: GenerationStatus | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

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
        agent:
          reconnectGen.agentSteps.length > 0
            ? { steps: reconnectGen.agentSteps }
            : null,
        createdAt: reconnectGen.startedAt,
      }
    : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6 px-5 py-5 max-w-4xl mx-auto">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
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
  const sendMessage = useSendMessage();
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const hasLocalPlaceholder = messages.some((m) => m.id.startsWith("__streaming_"));
  // Show the reconnect view only for a generation this tab is not streaming.
  const reconnectGen =
    activeGen && !streaming && !hasLocalPlaceholder ? activeGen : null;
  const busy = streaming || hasLocalPlaceholder || !!activeGen;

  const handleSend = async (opts: {
    content: string;
    attachments: { name: string; mediaType: string; dataBase64: string }[];
    webSearch: boolean;
    workspaceId: string | null;
    agentMode: boolean;
  }) => {
    setStreaming(true);
    try {
      await sendMessage.mutateAsync({
        chatId,
        input: {
          content: opts.content,
          attachments: opts.attachments,
          webSearch: opts.webSearch,
          agentMode: opts.agentMode || undefined,
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
      // Clear the polled status at once so the reconnect view never flashes.
      qc.setQueryData(["chat-active", chatId], { active: null });
    }
  };

  const handleStop = () => {
    void stopGeneration.mutateAsync(chatId).catch(() => {
      /* best-effort — the stream ends on its own once aborted */
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <MessageList messages={messages} streaming={streaming} reconnectGen={reconnectGen} />
      <div className="shrink-0 px-4 pb-4 pt-2 max-w-4xl mx-auto w-full">
        <ChatComposer
          onSend={(opts) => void handleSend(opts)}
          pending={busy}
          onStop={busy ? handleStop : undefined}
        />
      </div>
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
    webSearch: boolean;
    workspaceId: string | null;
    agentMode: boolean;
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

      // Send the message — streaming writes to the cache directly
      await sendMessage.mutateAsync({
        chatId: chat.id,
        input: {
          content: opts.content,
          attachments: opts.attachments,
          webSearch: opts.webSearch,
          agentMode: opts.agentMode || undefined,
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
    <div className="flex flex-col h-full overflow-hidden">
      <EmptyState onCreate={() => void handleCreateEmpty()} />
      <div className="shrink-0 px-4 pb-4 pt-2 max-w-4xl mx-auto w-full">
        <ChatComposer
          onSend={(opts) => void handleSend(opts)}
          pending={pending}
        />
      </div>
    </div>
  );
}
