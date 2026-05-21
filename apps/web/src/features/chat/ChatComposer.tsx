/**
 * ChatComposer — textarea + attach + web-search toggle + workspace selector.
 * Enter sends, Shift+Enter inserts newline.
 * Files are read to base64 before sending.
 */
import { useRef, useState, useCallback } from "react";
import {
  Paperclip,
  Globe,
  Send,
  Square,
  X,
  FolderOpen,
  ChevronDown,
  File,
  Image,
  Cpu,
  AlertCircle,
  Bot,
} from "lucide-react";
import type { PostAttachmentInput } from "@ariadne/shared";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  MODEL_CHOICES,
  DEFAULT_MODELS,
} from "@ariadne/shared";
import type { ProviderId } from "@ariadne/shared";
import { Button } from "../../components/ui/Button";
import { useWorkspaces, useSettings, useUpdateSettings, useProviderStatus } from "../../lib/queries";
import { useUIStore } from "../../lib/store";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

export interface PendingAttachment {
  name: string;
  mediaType: string;
  dataBase64: string;
  kind: "image" | "file";
  previewUrl?: string;
}

/** Web-search mode: off (never), auto (the server decides), on (always). */
export type WebSearchMode = "off" | "auto" | "on";

export interface ChatComposerProps {
  onSend: (opts: {
    content: string;
    attachments: PostAttachmentInput[];
    webSearch: WebSearchMode;
    workspaceId: string | null;
    agentMode: boolean;
  }) => void;
  disabled?: boolean;
  pending?: boolean;
  /** When provided and `pending`, the send button becomes a stop button. */
  onStop?: () => void;
}

const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({ onSend, disabled, pending, onStop }: ChatComposerProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  // Plain chat is the default: agent mode is opt-in, web search is "auto"
  // (the server decides per message). Both stay sticky across messages.
  const [webMode, setWebMode] = useState<WebSearchMode>("auto");
  const [agentMode, setAgentMode] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { t } = useT();

  const { chatComposerWorkspaceId, setChatComposerWorkspaceId } = useUIStore();
  const { data: workspaces } = useWorkspaces();
  const { data: settings } = useSettings();
  const { data: providerStatus } = useProviderStatus();
  const updateSettings = useUpdateSettings();

  const selectedWs = workspaces?.find((w) => w.id === chatComposerWorkspaceId);

  const currentProvider = (settings?.provider ?? "mock") as ProviderId;
  const currentModel = settings?.model ?? "mock";

  // For ollama: use installed models if reachable, otherwise fall back to defaults
  const ollamaStatus = providerStatus?.find((p) => p.id === "ollama");
  const ollamaReachable = ollamaStatus?.configured ?? false;

  const modelOptionsForProvider = (provider: ProviderId): string[] => {
    if (provider === "ollama" && ollamaReachable && ollamaStatus?.models?.length) {
      return ollamaStatus.models;
    }
    return (MODEL_CHOICES as Record<string, string[]>)[provider] ?? [];
  };

  const handleProviderChange = async (provider: ProviderId) => {
    const models = modelOptionsForProvider(provider);
    const model = models[0] ?? DEFAULT_MODELS[provider] ?? provider;
    const configured = providerStatus?.find((s) => s.id === provider)?.configured ?? false;
    try {
      await updateSettings.mutateAsync({ provider, model });
      if (!configured) {
        toast({ title: t("chat.composer.providerNoKey"), variant: "warning" });
      }
    } catch {
      toast({ title: t("chat.composer.failedProvider"), variant: "error" });
    }
  };

  const handleModelChange = async (model: string) => {
    try {
      await updateSettings.mutateAsync({ provider: currentProvider, model });
      setModelMenuOpen(false);
    } catch {
      toast({ title: t("chat.composer.failedModel"), variant: "error" });
    }
  };

  const handleFiles = useCallback(async (files: FileList) => {
    const newAtts: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      const base64 = await fileToBase64(file);
      const isImage = IMAGE_TYPES.includes(file.type);
      newAtts.push({
        name: file.name,
        mediaType: file.type || "application/octet-stream",
        dataBase64: base64,
        kind: isImage ? "image" : "file",
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }
    setAttachments((prev) => [...prev, ...newAtts]);
  }, []);

  const removeAttachment = (i: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      const att = next[i];
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      next.splice(i, 1);
      return next;
    });
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;

    onSend({
      content: trimmed,
      attachments: attachments.map((a) => ({
        name: a.name,
        mediaType: a.mediaType,
        dataBase64: a.dataBase64,
      })),
      webSearch: webMode,
      workspaceId: chatComposerWorkspaceId,
      agentMode,
    });

    setContent("");
    setAttachments([]);
    // webMode & agentMode stay sticky across messages within a chat.
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !pending) handleSend();
    }
  };

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !disabled && !pending;

  return (
    <div className="flex flex-col gap-2" data-tour="composer">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((att, i) => (
            <div
              key={`${att.name}-${i}`}
              className="relative group flex items-center gap-1.5"
            >
              {att.kind === "image" && att.previewUrl ? (
                <div className="relative">
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="h-14 w-14 rounded-lg object-cover border border-border"
                  />
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={t("chat.composer.removeAttachment")}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  <Image className="absolute bottom-1 left-1 h-3 w-3 text-white/70 pointer-events-none" />
                </div>
              ) : (
                <div className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-2 text-xs">
                  <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground max-w-[120px] truncate">{att.name}</span>
                  <button
                    onClick={() => removeAttachment(i)}
                    className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t("chat.composer.removeAttachment")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main composer box */}
      <div className="relative flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-3 pt-3 pb-2 focus-within:border-border-strong transition-colors">
        <textarea
          ref={textareaRef}
          rows={1}
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
          style={{ minHeight: "40px", maxHeight: "200px", overflow: "auto" }}
          placeholder={t("chat.composer.placeholder")}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            // Auto-grow
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />

        {/* Toolbar */}
        <div className="flex items-end gap-1.5">
          {/* Controls — wrap to a second row on narrow screens */}
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {/* Attach */}
          <button
            type="button"
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title={t("chat.composer.attachFiles")}
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span className="sr-only">{t("chat.composer.attachFiles")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.docx,.xlsx,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Web search toggle — cycles Off → Auto → On */}
          <button
            type="button"
            className={[
              "shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
              webMode !== "off"
                ? "text-accent bg-accent/10 border border-accent/20"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-3",
            ].join(" ")}
            onClick={() =>
              setWebMode((m) => (m === "off" ? "auto" : m === "auto" ? "on" : "off"))
            }
            disabled={disabled}
            title={t("chat.composer.webSearchCycle")}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>
              {webMode === "on"
                ? t("chat.composer.webOn")
                : webMode === "auto"
                  ? t("chat.composer.webAuto")
                  : t("chat.composer.web")}
            </span>
          </button>

          {/* Agent mode toggle */}
          <button
            type="button"
            className={[
              "shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
              agentMode
                ? "text-accent bg-accent/10 border border-accent/20"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-3",
            ].join(" ")}
            onClick={() => setAgentMode((v) => !v)}
            disabled={disabled}
            title={agentMode ? t("chat.composer.agentOn") : t("chat.composer.enableAgent")}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>{agentMode ? t("chat.composer.agentOn") : t("chat.composer.agent")}</span>
          </button>

          {/* Workspace selector */}
          <div className="relative max-md:static shrink-0">
            <button
              type="button"
              className={[
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                selectedWs
                  ? "text-accent bg-accent/10 border border-accent/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-3",
              ].join(" ")}
              onClick={() => setWsMenuOpen((v) => !v)}
              disabled={disabled}
              title={t("chat.composer.connectWorkspace")}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="max-w-[100px] truncate">
                {selectedWs ? selectedWs.name : t("chat.composer.workspace")}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {wsMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setWsMenuOpen(false)}
                />
                <div className="absolute bottom-full left-0 mb-1 z-20 w-52 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1 text-xs">
                  <button
                    className="w-full text-left px-3 py-1.5 text-muted-foreground hover:bg-surface-3 hover:text-foreground transition-colors"
                    onClick={() => {
                      setChatComposerWorkspaceId(null);
                      setWsMenuOpen(false);
                    }}
                  >
                    {t("chat.composer.noneGeneral")}
                  </button>
                  {workspaces && workspaces.length > 0 && (
                    <div className="border-t border-border mt-1 pt-1">
                      {workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          className={[
                            "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors",
                            ws.id === chatComposerWorkspaceId
                              ? "text-accent bg-accent/5"
                              : "text-foreground hover:bg-surface-3",
                          ].join(" ")}
                          onClick={() => {
                            setChatComposerWorkspaceId(ws.id);
                            setWsMenuOpen(false);
                          }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{ws.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(!workspaces || workspaces.length === 0) && (
                    <p className="px-3 py-1.5 text-muted-foreground italic">
                      {t("chat.composer.noWorkspaces")}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Model selector */}
          <div className="relative max-md:static shrink-0">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
              onClick={() => setModelMenuOpen((v) => !v)}
              disabled={disabled || updateSettings.isPending}
              title={t("chat.composer.changeModel")}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span className="max-w-[80px] truncate font-mono">
                {currentModel}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {modelMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setModelMenuOpen(false)}
                />
                <div className="absolute bottom-full left-0 mb-1 z-20 w-64 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1 text-xs">
                  {/* Ollama reachability notice */}
                  {currentProvider === "ollama" && !ollamaReachable && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-warning border-b border-border">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{t("chat.composer.ollamaNotRunning")}</span>
                    </div>
                  )}

                  {/* Provider selector */}
                  <div className="px-3 py-1.5 border-b border-border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      {t("chat.composer.provider")}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {PROVIDERS.map((p) => {
                        const status = providerStatus?.find((s) => s.id === p);
                        const reachable = status?.configured ?? false;
                        const isActive = p === currentProvider;
                        return (
                          <button
                            key={p}
                            className={[
                              "flex items-center justify-between w-full px-2 py-1 rounded transition-colors",
                              isActive
                                ? "bg-accent/10 text-accent"
                                : "text-foreground hover:bg-surface-3",
                            ].join(" ")}
                            onClick={() => void handleProviderChange(p)}
                          >
                            <span>{PROVIDER_LABELS[p]}</span>
                            {p !== "mock" && (
                              <span
                                className={[
                                  "text-[10px]",
                                  reachable ? "text-success" : "text-muted-foreground",
                                ].join(" ")}
                              >
                                {reachable ? "✓" : "—"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Model selector for current provider */}
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      {t("chat.composer.model")}
                    </p>
                    {modelOptionsForProvider(currentProvider).length > 0 ? (
                      modelOptionsForProvider(currentProvider).map((m) => (
                        <button
                          key={m}
                          className={[
                            "flex items-center w-full px-2 py-1 rounded font-mono transition-colors",
                            m === currentModel
                              ? "bg-accent/10 text-accent"
                              : "text-foreground hover:bg-surface-3",
                          ].join(" ")}
                          onClick={() => void handleModelChange(m)}
                        >
                          {m}
                        </button>
                      ))
                    ) : (
                      <p className="text-muted-foreground italic px-2 py-1">
                        {currentProvider === "ollama" && !ollamaReachable
                          ? t("chat.composer.startOllama")
                          : t("chat.composer.noModels")}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          </div>

          {/* Hint */}
          <span className="shrink-0 self-center text-[10px] text-muted-foreground hidden sm:block">
            {pending ? t("chat.composer.waiting") : t("chat.composer.hint")}
          </span>

          {/* Send / Stop button */}
          {pending && onStop ? (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={onStop}
              aria-label={t("chat.composer.stop")}
              title={t("chat.composer.stop")}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              onClick={handleSend}
              disabled={!canSend}
              loading={pending}
              aria-label={t("chat.composer.send")}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
