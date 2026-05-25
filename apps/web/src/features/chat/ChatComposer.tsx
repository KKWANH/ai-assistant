/**
 * ChatComposer — textarea + attach + web-search toggle + workspace selector.
 * Enter sends, Shift+Enter inserts newline.
 * Files are read to base64 before sending.
 */
import { useRef, useState, useCallback, useEffect } from "react";
import {
  Paperclip,
  Globe,
  Send,
  Square,
  X,
  FolderOpen,
  ChevronDown,
  File,
  FileSpreadsheet,
  Image,
  Cpu,
  AlertCircle,
  Zap,
  Play,
  Sparkles,
} from "lucide-react";
import type { PostAttachmentInput } from "@ariadne/shared";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  MODEL_CHOICES,
  DEFAULT_MODELS,
  modelHasVision,
} from "@ariadne/shared";
import type { ProviderId } from "@ariadne/shared";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/Tooltip";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useWorkspaces, useSettings, useUpdateSettings, useProviderStatus, useMe, useSkills } from "../../lib/queries";
import { useUIStore } from "../../lib/store";
import { modelInfo, modelPrice } from "../../lib/modelInfo";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import {
  looksLikeTable,
  parseTsv,
  toCsv,
  isTableFile,
  textToBase64,
  base64ToText,
} from "../../lib/tableData";
import { TableEditorModal } from "./TableSheet";

export interface PendingAttachment {
  name: string;
  mediaType: string;
  dataBase64: string;
  kind: "image" | "file";
  previewUrl?: string;
}

/** Web-search mode: off (never), auto (the server decides), on (always). */
export type WebSearchMode = "off" | "auto" | "on";
/** Public, single-axis reply mode that wraps the prior server-side
 *  (mode, agentMode) pair into one ergonomic state:
 *    - "instant" → fastest path, skips every classifier + retrieval +
 *      memory. Direct provider stream. (server: mode="instant")
 *    - "auto" → standard pipeline; the server's classifier decides
 *      whether to spin up the plan-and-execute agent per message.
 *      The everyday default. (server: mode="standard", agentMode="auto")
 *    - "agent" → standard pipeline + always-on agent loop. For
 *      multi-step research / coding work. (server: mode="standard",
 *      agentMode="on") */
export type ReplyMode = "instant" | "auto" | "agent";
/** Legacy alias kept so older callers that destructure {agentMode}
 *  from onSend still compile. New code should use ReplyMode. */
export type AgentMode = "off" | "auto" | "on";

export interface ChatComposerProps {
  onSend: (opts: {
    content: string;
    attachments: PostAttachmentInput[];
    webSearch: WebSearchMode;
    workspaceId: string | null;
    replyMode: ReplyMode;
  }) => void;
  disabled?: boolean;
  pending?: boolean;
  /** When provided and `pending`, the send button becomes a stop button. */
  onStop?: () => void;
  /** When set, render a chip above the composer suggesting a matched action. */
  suggestion?: { actionId: string; actionName: string; reason: string } | null;
  onRunSuggestion?: () => void;
  onDismissSuggestion?: () => void;
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

/**
 * Replace `{key}` placeholders in `prompt` with the supplied values.
 * Missing keys are left unchanged (the user sees `{key}` and can edit).
 */
function fillPromptVariables(prompt: string, values: Record<string, string>): string {
  return prompt.replace(/\{([a-z][a-z0-9_]*)\}/gi, (match, key: string) => {
    const v = values[key];
    return v == null || v === "" ? match : v;
  });
}

/**
 * Modal that collects variable values for a skill before insert. Multi-line
 * inputs for keys that look long ("text", "code", "error", "draft" or any
 * key with a default >60 chars). Cmd/Ctrl+Enter submits.
 */
function SkillFillModal({
  skill,
  onSubmit,
  onClose,
}: {
  skill: import("@ariadne/shared").Skill;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const vars = skill.variables ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of vars) init[v.key] = v.default ?? "";
    return init;
  });
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-4 flex flex-col gap-3 max-h-[85vh] overflow-y-auto">
          <div>
            <p className="text-sm font-semibold text-foreground">/{skill.name}</p>
            {skill.description && (
              <p className="text-2xs text-muted-foreground mt-0.5">{skill.description}</p>
            )}
          </div>
          {vars.map((v) => {
            const isLong =
              ["text", "code", "error", "draft", "content"].includes(v.key) ||
              (v.default && v.default.length > 60);
            return (
              <div key={v.key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {v.label ?? v.key}
                  <span className="ml-1 text-muted-foreground font-mono text-2xs">{`{${v.key}}`}</span>
                </label>
                {isLong ? (
                  <textarea
                    autoFocus={v === vars[0]}
                    rows={4}
                    className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-2 text-xs font-mono text-foreground focus:outline-none focus:border-accent resize-none"
                    style={{ minHeight: "80px", maxHeight: "240px" }}
                    value={values[v.key] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        onSubmit(values);
                      }
                    }}
                  />
                ) : (
                  <input
                    autoFocus={v === vars[0]}
                    className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-2 text-xs text-foreground focus:outline-none focus:border-accent"
                    value={values[v.key] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onSubmit(values);
                      }
                    }}
                  />
                )}
                {v.hint && (
                  <p className="text-2xs text-muted-foreground">{v.hint}</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onSubmit(values)}
              className="px-3 py-1 rounded-md text-xs bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
            >
              {t("chat.composer.skillsInsert")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Small dropdown listing skills, optionally filtered by the slash-command
 * keyword the user is typing. Built-in skills are marked. Skills with
 * variables open a fill modal before insert; static skills insert directly.
 */
function SkillsDropdown({
  skills,
  filter,
  onPick,
  onClose,
}: {
  skills: import("@ariadne/shared").Skill[];
  filter: string;
  /** Called with the FINAL prompt text (variables already substituted). */
  onPick: (finalPrompt: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [fillFor, setFillFor] = useState<import("@ariadne/shared").Skill | null>(null);
  const filtered = filter
    ? skills.filter((s) => s.name.toLowerCase().includes(filter))
    : skills;
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute bottom-full mb-1 left-0 z-30 w-80 max-w-[calc(100vw-2rem)] max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg p-1">
        {filtered.length > 0 ? (
          <ul className="flex flex-col">
            {filtered.map((s) => {
              const hasVars = (s.variables?.length ?? 0) > 0;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (hasVars) {
                        setFillFor(s);
                      } else {
                        onPick(s.prompt);
                      }
                    }}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-surface-3 transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      /{s.name}
                      {s.builtin && (
                        <span className="text-2xs text-muted-foreground font-normal">·</span>
                      )}
                      {s.builtin && (
                        <span className="text-2xs text-muted-foreground font-normal">
                          {t("runs.template.builtIn")}
                        </span>
                      )}
                      {hasVars && (
                        <span className="ml-auto text-2xs text-accent font-normal">
                          {t("skills.inputCount", { n: s.variables?.length ?? 0 })}
                        </span>
                      )}
                    </span>
                    <span className="text-2xs text-muted-foreground truncate">
                      {s.description ?? s.prompt.slice(0, 100)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center">
            {skills.length === 0
              ? t("chat.composer.skillsEmpty")
              : t("chat.composer.skillsNoMatch")}
          </div>
        )}
        <div className="border-t border-border mt-1 pt-1">
          <a
            href="/settings"
            className="block px-3 py-2 rounded-md text-2xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
          >
            {t("chat.composer.skillsManage")} →
          </a>
        </div>
      </div>
      {fillFor && (
        <SkillFillModal
          skill={fillFor}
          onSubmit={(values) => {
            onPick(fillPromptVariables(fillFor.prompt, values));
            setFillFor(null);
          }}
          onClose={() => setFillFor(null)}
        />
      )}
    </>
  );
}

export function ChatComposer({
  onSend,
  disabled,
  pending,
  onStop,
  suggestion,
  onRunSuggestion,
  onDismissSuggestion,
}: ChatComposerProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  // Plain chat is the default: web search is "auto" (server decides
  // per message), reply mode is "auto" (server's classifier picks
  // between standard chat and the agent loop per message). Both stay
  // sticky across messages within a chat.
  const [webMode, setWebMode] = useState<WebSearchMode>("auto");
  const [replyMode, setReplyMode] = useState<ReplyMode>("auto");
  // Skill picker — opens via the Sparkles button OR when the composer
  // starts with "/" (slash-command autocomplete). The state below tracks
  // which trigger opened it so the filter logic stays separate.
  const [skillsOpenMode, setSkillsOpenMode] = useState<"button" | "slash" | null>(null);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  // Table feature: pasted TSV awaiting a "convert to table" decision, and the
  // index of the table attachment currently open in the editor.
  const [tablePaste, setTablePaste] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Empty-state chips drive the composer via a store pulse — see
  // store.ts composerPulse. We use the pulse counter as the effect
  // dep so repeat clicks fire repeat actions.
  const composerPulse = useUIStore((s) => s.composerPulse);
  useEffect(() => {
    if (!composerPulse) return;
    if (composerPulse.kind === "open_file_picker") {
      fileInputRef.current?.click();
    } else if (composerPulse.kind === "toggle_web_search") {
      // Cycle off→auto→on to "on" directly when the empty-state chip
      // is clicked — mom expected web search to be turned on, not just
      // "considered."
      setWebMode("on");
    }
  }, [composerPulse]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { t } = useT();

  const { chatComposerWorkspaceId, setChatComposerWorkspaceId } = useUIStore();
  const { data: workspaces } = useWorkspaces();
  const { data: skills } = useSkills();
  const { data: settings } = useSettings();
  const { data: providerStatus } = useProviderStatus();
  const updateSettings = useUpdateSettings();
  const { data: me } = useMe();
  // Easy mode shows friendly model names + a one-line trait instead of raw ids.
  const isSimple = me?.account.mode === "simple";

  // Simple-mode default: "instant" for chats with no workspace
  // (mom asks "what time is it?" — wants fast answer, no pipeline).
  // But for workspace-scoped chats, default to "auto" so questions
  // like "what's in this folder?" actually see the workspace context
  // instead of hallucinating a labyrinth (non-dev report N5). The
  // user can still pick any of the three modes manually; this is
  // just a smarter default.
  useEffect(() => {
    if (!isSimple) return;
    setReplyMode(chatComposerWorkspaceId ? "auto" : "instant");
  }, [isSimple, chatComposerWorkspaceId]);

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
      // Spreadsheets become a CSV table attachment (first sheet) so they open
      // in the table editor like any other table.
      if (/\.xlsx?$/i.test(file.name)) {
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer());
          const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
          const csv = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
          newAtts.push({
            name: file.name.replace(/\.xlsx?$/i, ".csv"),
            mediaType: "text/csv",
            dataBase64: textToBase64(csv),
            kind: "file",
          });
          continue;
        } catch {
          /* parsing failed — fall through and attach the raw file */
        }
      }
      const base64 = await fileToBase64(file);
      const isImage = IMAGE_TYPES.includes(file.type);
      const isCsv = /\.(csv|tsv)$/i.test(file.name);
      newAtts.push({
        name: file.name,
        mediaType: isCsv ? "text/csv" : file.type || "application/octet-stream",
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

  // Offer to turn pasted tab-separated text into a table file.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (text && looksLikeTable(text)) setTablePaste(text);
  };

  const convertPastedTable = () => {
    if (!tablePaste) return;
    const csv = toCsv(parseTsv(tablePaste));
    setAttachments((prev) => [
      ...prev,
      { name: "표.csv", mediaType: "text/csv", dataBase64: textToBase64(csv), kind: "file" },
    ]);
    setContent((c) => c.replace(tablePaste, ""));
    setTablePaste(null);
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
      replyMode,
    });

    setContent("");
    setAttachments([]);
    // webMode & replyMode stay sticky across messages within a chat.
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !pending) handleSend();
    }
  };

  // Vision guard — if the user attached images but the active model
  // can't see them, surface the warning + block send. Without this
  // the user sends an image, the model cheerfully accepts then replies
  // "I cannot view images", which reads as a broken app (non-dev
  // report N4). The chip below the composer points at the fix.
  const hasImageAttachment = attachments.some((a) => IMAGE_TYPES.includes(a.mediaType));
  const visionBlocked = hasImageAttachment && !modelHasVision(currentModel);

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !disabled && !pending && !visionBlocked;
  const editingAtt = editingIndex !== null ? attachments[editingIndex] ?? null : null;

  // Rich hover tooltip for the model picker — friendly name, what it's good
  // at, relative speed, and price (exact $ in standard mode, a tier in easy).
  const currentModelInfo = modelInfo(currentModel);
  const currentModelPrice = modelPrice(currentModel);
  const modelIsFree =
    currentModelPrice !== null &&
    currentModelPrice.inUsd === 0 &&
    currentModelPrice.outUsd === 0;
  const modelTooltip = (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-foreground">{currentModelInfo.label}</span>
      <span className="text-muted-foreground">{t(currentModelInfo.traitKey)}</span>
      <span className="text-2xs text-muted-foreground">
        {t("model.tip.speed")}: {t(`model.speed.${currentModelInfo.speed}`)}
      </span>
      <span className="text-2xs text-muted-foreground">
        {modelIsFree
          ? t("model.price.free")
          : !isSimple && currentModelPrice
            ? t("model.price.perMillion", {
                in: `$${currentModelPrice.inUsd}`,
                out: `$${currentModelPrice.outUsd}`,
              })
            : `${t("model.tip.cost")}: ${t(`model.cost.${currentModelInfo.costTier}`)}`}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2" data-tour="composer">
      {/* Detected intent → suggest running a matching workspace action */}
      {suggestion && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
          <Zap className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="flex-1 min-w-0 text-foreground truncate">
            <span className="font-medium">{suggestion.actionName}</span>
            {suggestion.reason ? (
              <span className="ml-1.5 text-muted-foreground">· {suggestion.reason}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onRunSuggestion}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground hover:bg-accent/90"
          >
            <Play className="h-3 w-3" />
            {t("composer.intent.run")}
          </button>
          <button
            type="button"
            onClick={onDismissSuggestion}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("composer.intent.dismiss")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Pasted tab-separated text → offer to make it a table file */}
      {tablePaste && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
          <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="flex-1 text-foreground">{t("composer.tablePaste")}</span>
          <button
            type="button"
            onClick={convertPastedTable}
            className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground hover:bg-accent/90"
          >
            {t("composer.tablePaste.convert")}
          </button>
          <button
            type="button"
            onClick={() => setTablePaste(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("composer.tablePaste.dismiss")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Table editor — opened by clicking a pending table attachment */}
      {editingAtt && editingIndex !== null && (
        <TableEditorModal
          title={editingAtt.name}
          initialCsv={base64ToText(editingAtt.dataBase64)}
          onSave={(csv) =>
            setAttachments((prev) =>
              prev.map((a, i) =>
                i === editingIndex ? { ...a, dataBase64: textToBase64(csv) } : a,
              ),
            )
          }
          onClose={() => setEditingIndex(null)}
        />
      )}

      {/* Vision-guard banner — shown when at least one image is attached
          but the active model can't read images. Without this the user
          sends the image, model replies "I cannot view images", and the
          app reads as broken. The banner blocks send and tells the
          user exactly what to do. */}
      {visionBlocked && (
        <div className="mx-1 mt-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2 text-2xs">
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <span className="text-foreground">
            {t("chat.composer.visionBlocked", { model: currentModelInfo.label })}
          </span>
        </div>
      )}

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
                  {isTableFile(att.name, att.mediaType) ? (
                    <button
                      type="button"
                      onClick={() => setEditingIndex(i)}
                      className="flex min-w-0 items-center gap-1.5 text-foreground hover:text-accent transition-colors"
                      title={t("composer.editTable")}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                      <span className="max-w-[120px] truncate">{att.name}</span>
                    </button>
                  ) : (
                    <>
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground max-w-[120px] truncate">{att.name}</span>
                    </>
                  )}
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
            const value = e.target.value;
            setContent(value);
            // Auto-grow
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            // Slash-command autocomplete: open the skill picker as the
            // user types `/abc`. Close it once they keep typing past a
            // word boundary (so a literal slash in real text won't keep
            // the picker stuck open).
            if (/^\/[a-z0-9가-힣_-]*$/i.test(value)) {
              setSkillsOpenMode("slash");
            } else if (skillsOpenMode === "slash") {
              setSkillsOpenMode(null);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
        />

        {/* Toolbar */}
        <div className="flex items-end gap-1.5">
          {/* Controls — wrap to a second row on narrow screens */}
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {/* Attach */}
          <Tooltip content={t("chat.composer.attachFiles")} className="shrink-0">
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              <Paperclip className="h-3.5 w-3.5" />
              <span className="sr-only">{t("chat.composer.attachFiles")}</span>
            </button>
          </Tooltip>
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

          {/* Reply mode — single tri-state selector replacing the prior
              Instant + Agent toggles. Visible in BOTH simple and standard
              modes so non-developers also discover that "Agent" is an
              option, not a hidden feature. */}
          <Tooltip content={t(isSimple ? "chat.composer.replyModeTip.simple" : "chat.composer.replyModeTip")} rich className="shrink-0">
            <span>
              <SegmentedControl<ReplyMode>
                ariaLabel={t("chat.composer.replyModeLabel")}
                options={[
                  { value: "instant", label: t("chat.composer.replyMode.instant") },
                  { value: "auto", label: t("chat.composer.replyMode.auto") },
                  { value: "agent", label: t("chat.composer.replyMode.agent") },
                ]}
                value={replyMode}
                onChange={setReplyMode}
                disabled={disabled}
              />
            </span>
          </Tooltip>

          {/* Web search toggle — cycles Off → Auto → On.
              Mobile (<sm): icon only with tooltip. ≥sm: icon + label. */}
          <Tooltip content={t("chat.composer.webSearchCycle")} className="shrink-0">
            <button
              type="button"
              aria-label={t("chat.composer.webSearchCycle")}
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
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {webMode === "on"
                  ? t("chat.composer.webOn")
                  : webMode === "auto"
                    ? t("chat.composer.webAuto")
                    : t("chat.composer.web")}
              </span>
            </button>
          </Tooltip>

          {/* Skills picker — account-scoped reusable prompt snippets.
              Opens via this button or via slash-command autocomplete in the
              textarea above. */}
          <div className="relative shrink-0">
            <Tooltip content={t("chat.composer.skillsHint")} className="shrink-0">
              <button
                type="button"
                className={[
                  "shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                  skillsOpenMode
                    ? "text-foreground bg-surface-3"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-3",
                ].join(" ")}
                onClick={() => setSkillsOpenMode((m) => (m ? null : "button"))}
                disabled={disabled}
                aria-label={t("chat.composer.skills")}
                title={t("chat.composer.skills")}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("chat.composer.skills")}</span>
              </button>
            </Tooltip>
            {skillsOpenMode && (
              <SkillsDropdown
                skills={skills ?? []}
                filter={
                  skillsOpenMode === "slash"
                    ? content.replace(/^\//, "").toLowerCase()
                    : ""
                }
                onPick={(finalPrompt) => {
                  // Replace a leading "/foo" with the final (variable-filled)
                  // prompt; otherwise append at the cursor / end. Either way
                  // close the picker and refocus the textarea.
                  setContent((cur) =>
                    /^\/[a-z0-9가-힣_-]*$/i.test(cur)
                      ? finalPrompt
                      : (cur ? cur + (cur.endsWith("\n") ? "" : "\n") : "") + finalPrompt,
                  );
                  setSkillsOpenMode(null);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }}
                onClose={() => setSkillsOpenMode(null)}
              />
            )}
          </div>

          {/* Workspace selector */}
          <div className="relative max-md:static shrink-0">
            <Tooltip content={t("chat.composer.connectWorkspace")}>
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
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="max-w-[100px] truncate">
                  {selectedWs ? selectedWs.name : t("chat.composer.workspace")}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </Tooltip>

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
            <Tooltip content={modelTooltip} rich>
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-50"
                onClick={() => setModelMenuOpen((v) => !v)}
                disabled={disabled || updateSettings.isPending}
              >
                <Cpu className="h-3.5 w-3.5" />
                <span className={isSimple ? "max-w-[130px] truncate" : "max-w-[80px] truncate font-mono"}>
                  {isSimple ? currentModelInfo.label : currentModel}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </Tooltip>

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
                    <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
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
                                  "text-2xs",
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
                    <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      {t("chat.composer.model")}
                    </p>
                    {modelOptionsForProvider(currentProvider).length > 0 ? (
                      modelOptionsForProvider(currentProvider).map((m) => (
                        <button
                          key={m}
                          className={[
                            isSimple
                              ? "flex flex-col items-start gap-0.5 w-full px-2 py-1.5 rounded transition-colors text-left"
                              : "flex items-center w-full px-2 py-1 rounded font-mono transition-colors",
                            m === currentModel
                              ? "bg-accent/10 text-accent"
                              : "text-foreground hover:bg-surface-3",
                          ].join(" ")}
                          onClick={() => void handleModelChange(m)}
                        >
                          {isSimple ? (
                            <>
                              <span className="font-medium">{modelInfo(m).label}</span>
                              <span
                                className={[
                                  "text-2xs leading-snug",
                                  m === currentModel ? "text-accent/80" : "text-muted-foreground",
                                ].join(" ")}
                              >
                                {t(modelInfo(m).traitKey)}
                              </span>
                            </>
                          ) : (
                            m
                          )}
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
          <span className="shrink-0 self-center text-2xs text-muted-foreground hidden sm:block">
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
