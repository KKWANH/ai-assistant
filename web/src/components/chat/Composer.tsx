import React, { useEffect, useRef, useState } from "react";
import { ModelPickerButton } from "../model/ModelPickerButton";
import { SelectedAttachmentList } from "./SelectedAttachmentList";
import { TableWorkbenchPanel } from "../table/TableWorkbenchPanel";
import { useAttachments } from "../../hooks/useAttachments";
import { copyForAccount } from "../../shared/copy/copy";
import { getCookie, setCookie } from "../../lib/api";
import { looksLikePastedTable, parseCsvRows, pastedTableToCsv } from "../../lib/table";
import { useChatSubmit } from "./useChatSubmit";
import {
  estimateCurrentCost,
  MODEL_MODES,
  modelMode,
  normalizeModelCatalog,
  savedModelMode,
  savedSearchMode,
} from "../../lib/modelModes";
import type { ModelMode } from "../../lib/modelModes";
import type { ChatState } from "../../shared/contracts/runtime";

export type ComposerMode = "normalChat" | "dockedContextChat" | "workflowStepChat";
export type ActiveChatPath = { projectPath: string; sessionSlug?: string };
export type DockContext = {
  kind: "artifact" | "run" | "resource" | "workflow" | "workflow_step";
  label: string;
  path?: string;
  runId?: string;
  workflowAppId?: string;
  viewerSlotId?: string;
  resourceType?: string;
};
export type ChatSession = { slug?: string; title?: string; project_path?: string };
export type ChatPayload = ChatState;
export type AccountLike = { username?: string; nickname?: string; display_name?: string; profile?: Record<string, unknown> } | null | undefined;
export type ComposerProps = {
  activePath: ActiveChatPath;
  onAsk: (next: ChatPayload | ((current: ChatPayload | null) => ChatPayload)) => void;
  account?: AccountLike;
  power?: boolean;
  models?: ModelMode[];
  modeKind?: ComposerMode;
  docked?: boolean;
  dockContext?: DockContext | null;
  onSessionCreated?: (session: ChatSession) => void;
  initialContent?: string;
  focusSignal?: number;
  openAttachmentSignal?: number;
  openTableSignal?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Request failed.");
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

function accountDisplayName(account?: AccountLike) {
  return account?.nickname || account?.display_name || displayNameForId(account?.username);
}

function cloudConfirmed(key: string) {
  return getCookie(`aiws_cloud_ok_${key}`) === "1" || sessionStorage.getItem(`aiws_cloud_once_${key}`) === "1";
}

function confirmCloudOnce(key: string) {
  sessionStorage.setItem(`aiws_cloud_once_${key}`, "1");
}

function confirmCloudAlways(key: string) {
  setCookie(`aiws_cloud_ok_${key}`, "1");
}

function CloudConfirm({
  mode,
  files,
  contentPreview,
  searchMode,
  copy,
  onUseOnce,
  onUseAlways,
  onCancel,
}: {
  mode: ModelMode;
  files: File[];
  contentPreview: string;
  searchMode: string;
  copy: { cloudConfirm: Record<string, string> };
  onUseOnce: () => void;
  onUseAlways: () => void;
  onCancel: () => void;
}) {
  const text = copy.cloudConfirm;
  const hasFile = files.length > 0;
  return (
    <div className="cloud-confirm" role="alert">
      <strong>{mode.label} {text.titleSuffix}</strong>
      <p>{text.body}</p>
      <p className="eyebrow">What will be sent</p>
      <ul>
        <li>{text.providerModel}: {mode.provider} · {mode.model}</li>
        <li>{text.userMessage}: {text.included}</li>
        <li>Message preview: {contentPreview || text.none}</li>
        <li>{text.attachedFile}: {hasFile ? files.map((file) => file.name).join(", ") : text.none}</li>
        <li>Web/network: {searchMode === "off" ? "not included" : searchMode}</li>
        <li>Excluded: local secret patterns, blocked paths, and files not attached to this request</li>
        <li>{text.estimatedCost}: {estimateCurrentCost(mode, "", hasFile)}</li>
      </ul>
      <div>
        <button type="button" onClick={onUseOnce}>{text.useOnce}</button>
        <button type="button" onClick={onUseAlways}>{text.keepUsing}</button>
        <button type="button" onClick={onCancel}>{text.cancel}</button>
      </div>
    </div>
  );
}

export function Composer({
  activePath,
  onAsk,
  account,
  power,
  models = MODEL_MODES as ModelMode[],
  modeKind,
  docked = false,
  dockContext = null,
  onSessionCreated,
  initialContent = "",
  focusSignal = 0,
  openAttachmentSignal = 0,
  openTableSignal = 0,
}: ComposerProps) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePreview, setTablePreview] = useState<string[][]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { files, primaryFile, previewUrl, previewUrls, addFiles, removeFile, clearFiles, hasVisionOnlyFiles } = useAttachments() as {
    files: File[];
    primaryFile: File | null;
    previewUrl: string;
    previewUrls: string[];
    addFiles: (files: File[] | FileList) => File[];
    removeFile: (index: number) => void;
    clearFiles: () => void;
    hasVisionOnlyFiles: (mode: string, models: ModelMode[]) => boolean;
  };
  const { sending, submitChat, stop } = useChatSubmit(onAsk);
  const modelModes = normalizeModelCatalog(models) as ModelMode[];
  const selectedMode = modelMode(mode, modelModes);
  const copy = copyForAccount(account);

  useEffect(() => {
    setCookie("aiws_model_mode", mode);
  }, [mode]);

  useEffect(() => {
    setCookie("aiws_search_mode", searchMode);
  }, [searchMode]);

  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.style.height = "auto";
    textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 120)}px`;
  }, [content]);

  useEffect(() => {
    if (!initialContent) return;
    setContent(initialContent);
    window.setTimeout(() => textRef.current?.focus(), 30);
  }, [initialContent]);

  useEffect(() => {
    if (focusSignal) window.setTimeout(() => textRef.current?.focus(), 30);
  }, [focusSignal]);

  useEffect(() => {
    if (openAttachmentSignal) window.setTimeout(() => inputRef.current?.click(), 30);
  }, [openAttachmentSignal]);

  useEffect(() => {
    if (openTableSignal) {
      setToolsOpen(false);
      setTableOpen(true);
    }
  }, [openTableSignal]);

  function resetFiles() {
    clearFiles();
    setTablePreview([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event: React.DragEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = addFiles(event.dataTransfer?.files || []);
    if (dropped[0]) updateTablePreviewFromFile(dropped[0]);
  }

  function pasteTable(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikePastedTable(pasted)) return;
    event.preventDefault();
    addTableText(pasted);
  }

  function handleFiles(nextFiles: File[] | FileList) {
    const added = addFiles(nextFiles);
    if (added[0]) updateTablePreviewFromFile(added[0]);
  }

  function addTableText(value: string) {
    const clean = String(value || "").trim();
    if (!clean) return;
    const csv = looksLikePastedTable(clean) ? pastedTableToCsv(clean) : clean;
    addFiles([new File([csv], `pasted-table-${Date.now()}.csv`, { type: "text/csv" })]);
    setContent((current) => current || copy.chat.tablePrompt);
    setTablePreview(parseCsvRows(csv).slice(0, 30));
    setToolsOpen(false);
    setTableOpen(true);
  }

  async function updateTablePreviewFromFile(nextFile: File) {
    const name = nextFile?.name || "";
    if (!/\.(csv|txt)$/i.test(name)) {
      setTablePreview([]);
      return;
    }
    const text = await nextFile.text();
    setTablePreview(parseCsvRows(text).slice(0, 30));
  }

  function removeAttachment(index: number) {
    removeFile(index);
    if (inputRef.current && files.length <= 1) inputRef.current.value = "";
  }

  function stopThinking() {
    stop();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || (!content.trim() && files.length === 0)) return;
    let submitMode = selectedMode;
    if (hasVisionOnlyFiles(mode, modelModes)) {
      setMode("cheap");
      submitMode = modelMode("cheap", modelModes);
    }
    if (submitMode.cloud && !cloudConfirmed(mode)) {
      setCloudPrompt(true);
      return;
    }
    const optimistic = {
      role: "user",
      actor_display: accountDisplayName(account),
      content: content || `Attached ${files.length} file${files.length === 1 ? "" : "s"}`,
      attachments: files.map((item) => ({
        filename: item.name,
        url: previewUrls[files.indexOf(item)] || "",
        is_image: item.type.startsWith("image/"),
      })),
    };

    const outgoingContent = content;
    setContent("");
    resetFiles();
    onAsk((current) => ({
      ...(current || {}),
      messages: [
        ...(current?.messages || []),
        optimistic,
        {
          role: "assistant",
          pending: true,
          content: "",
          attachments: [],
          execution_plan: {
            steps: [
              { id: "accepted", status: "completed", title: "요청 받음" },
              { id: "context", status: "running", title: files.length ? `${files.length}개 파일 읽는 중` : "대화 맥락 확인 중" },
              { id: "model", status: "pending", title: `${submitMode.provider} · ${submitMode.model}` },
              { id: "receipt", status: "pending", title: "답변/기록 저장 대기" },
            ],
            estimated_model_calls: 1,
          },
        },
      ],
    }));
    try {
      await submitChat({
        activePath,
        content: outgoingContent,
        files,
        model: submitMode,
        searchMode,
        mode: modeKind || (docked ? "dockedContextChat" : "normalChat"),
        dockContext,
        allowNetwork: searchMode === "always",
        allowRemote: Boolean(submitMode.cloud),
        onSessionCreated,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      onAsk((current) => ({
        ...(current || {}),
        messages: [
          ...(current?.messages || []).filter((message) => !message.pending),
          { role: "system", content: errorMessage(err), attachments: [] },
        ],
      }));
    } finally {
      textRef.current?.focus();
    }
  }

  function keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      className={`composer ${dragging ? "dragging" : ""} ${docked ? "docked-mini" : ""}`}
      data-api-action={`/api/ask/${activePath.projectPath}/${activePath.sessionSlug || ""}`}
      encType="multipart/form-data"
      onSubmit={submit}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={pickDroppedFile}
    >
      {dragging && <div className="drop-hint">{copy.chat.dropFiles}</div>}
      <textarea
        ref={textRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onPaste={pasteTable}
        onKeyDown={keyDown}
        placeholder={copy.chat.placeholder}
      />
      {!docked && <SelectedAttachmentList files={files} previewUrl={previewUrl} previewUrls={previewUrls} selectedMode={selectedMode} onRemove={removeAttachment} copy={copy.attachments} />}
      {primaryFile?.type?.startsWith("image/") && !selectedMode.supportsImage && (
        <div className="system-note compact-warning">{copy.chat.visionSwitch}</div>
      )}
      <div className="composer-toolbar">
        {!docked && <div className="composer-plus-wrap">
          <button className="composer-plus-button" type="button" onClick={() => setToolsOpen((value) => !value)} aria-label={copy.chat.openTools} aria-expanded={toolsOpen}>+</button>
          {!docked && <input
            ref={inputRef}
            data-attachment-input
            className="hidden-attachment-input"
            type="file"
            multiple
            onChange={(event) => handleFiles(Array.from(event.target.files || []))}
            accept=".txt,.md,.csv,.xls,.xlsx,.json,.yaml,.yml,.pdf,.docx,.ppt,.pptx,image/png,image/jpeg,image/gif,image/webp"
          />}
          {toolsOpen && (
            <div className="composer-plus-menu" role="menu">
              <span className="composer-tool-heading">{copy.catalog?.tools || "Chat Tools"}</span>
              {!docked && <button type="button" onClick={() => inputRef.current?.click()}><b>{copy.chat.tools.attach}</b><small>.pdf .docx .csv .xlsx images</small></button>}
              <button type="button" onClick={() => { setTableOpen(true); setToolsOpen(false); }}><b>{copy.chat.tools.table}</b><small>{copy.catalog?.oneOffTool || "One-off tool"} · {copy.catalog?.viewer || "Viewer"}</small></button>
              <button
                type="button"
                className={`web-tool-toggle ${searchMode === "always" ? "is-active" : ""}`}
                onClick={() => setSearchMode((value) => value === "always" ? "auto" : "always")}
              >
                <i aria-hidden="true">{searchMode === "always" ? "✓" : ""}</i>
                <span><b>{copy.chat.tools.web}</b><small>{searchMode === "always" ? "켬 · 웹 확인 포함" : "꺼짐 · 누르면 켬"}</small></span>
              </button>
              <button type="button" disabled><b>{copy.chat.tools.image}</b><small>{copy.catalog?.apps || "Workflow Apps"} later</small></button>
              <button type="button" disabled><b>{copy.chat.tools.more}</b><small>{copy.catalog?.dataResourceTitle || "Data Resource"}</small></button>
            </div>
          )}
        </div>}
        <ModelPickerButton
          open={pickerOpen}
          setOpen={setPickerOpen}
          selectedKey={mode}
          onSelect={setMode}
          content={content}
          hasFile={files.length > 0}
          power={power}
          modelCatalog={modelModes}
        />
        {sending ? (
          <button className="send-key stop" type="button" onClick={stopThinking}>{copy.chat.stop}</button>
        ) : (
          <button className="send-key" type="submit">{copy.chat.send}</button>
        )}
      </div>
      {cloudPrompt && (
        <CloudConfirm
          mode={selectedMode}
          copy={copy}
          files={files}
          contentPreview={content.slice(0, 180)}
          searchMode={searchMode}
          onCancel={() => setCloudPrompt(false)}
          onUseOnce={() => {
            confirmCloudOnce(mode);
            setCloudPrompt(false);
            formRef.current?.requestSubmit();
          }}
          onUseAlways={() => {
            confirmCloudAlways(mode);
            setCloudPrompt(false);
            formRef.current?.requestSubmit();
          }}
        />
      )}
      {!docked && <TableWorkbenchPanel
        open={tableOpen}
        file={primaryFile}
        rows={tablePreview}
        running={sending}
        onClose={() => setTableOpen(false)}
        onChooseFile={() => inputRef.current?.click()}
        onSetText={addTableText}
        onDropFile={handleFiles}
        onRun={() => {
          setTableOpen(false);
          formRef.current?.requestSubmit();
        }}
        copy={copy}
      />}
    </form>
  );
}
