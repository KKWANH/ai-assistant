import React, { useEffect, useRef, useState } from "react";
import { ModelPickerButton } from "../model/ModelPickerButton.jsx";
import { SelectedAttachmentList } from "./SelectedAttachmentList.jsx";
import { TableWorkbenchPanel } from "../table/TableWorkbenchPanel.jsx";
import { useAttachments } from "../../hooks/useAttachments.js";
import { copyForAccount } from "../../shared/copy/copy";
import { fetchJson, getCookie, setCookie } from "../../lib/api.js";
import { looksLikePastedTable, parseCsvRows, pastedTableToCsv } from "../../lib/table.js";
import {
  estimateCurrentCost,
  MODEL_MODES,
  modelMode,
  normalizeModelCatalog,
  savedModelMode,
  savedSearchMode,
  SEARCH_OPTIONS,
} from "../../lib/modelModes.jsx";

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

function accountDisplayName(account) {
  return account?.nickname || account?.display_name || displayNameForId(account?.username);
}

function cloudConfirmed(key) {
  return getCookie(`aiws_cloud_ok_${key}`) === "1" || sessionStorage.getItem(`aiws_cloud_once_${key}`) === "1";
}

function confirmCloudOnce(key) {
  sessionStorage.setItem(`aiws_cloud_once_${key}`, "1");
}

function confirmCloudAlways(key) {
  setCookie(`aiws_cloud_ok_${key}`, "1");
}

function CloudConfirm({ mode, hasFile, copy, onUseOnce, onUseAlways, onCancel }) {
  const text = copy.cloudConfirm;
  return (
    <div className="cloud-confirm" role="alert">
      <strong>{mode.label} {text.titleSuffix}</strong>
      <p>{text.body}</p>
      <ul>
        <li>{text.providerModel}: {mode.provider} · {mode.model}</li>
        <li>{text.userMessage}: {text.included}</li>
        <li>{text.attachedFile}: {hasFile ? text.fileIncluded : text.none}</li>
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

export function Composer({ activePath, onAsk, account, power, models = MODEL_MODES, docked = false, dockContext = null, onSessionCreated }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePreview, setTablePreview] = useState([]);
  const inputRef = useRef(null);
  const textRef = useRef(null);
  const formRef = useRef(null);
  const abortRef = useRef(null);
  const { files, primaryFile, previewUrl, previewUrls, addFiles, removeFile, clearFiles, hasVisionOnlyFiles } = useAttachments();
  const modelModes = normalizeModelCatalog(models);
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

  function resetFiles() {
    clearFiles();
    setTablePreview([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = addFiles(event.dataTransfer?.files || []);
    if (dropped[0]) updateTablePreviewFromFile(dropped[0]);
  }

  function pasteTable(event) {
    const pasted = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikePastedTable(pasted)) return;
    event.preventDefault();
    addTableText(pasted);
  }

  function handleFiles(nextFiles) {
    const added = addFiles(nextFiles);
    if (added[0]) updateTablePreviewFromFile(added[0]);
  }

  function addTableText(value) {
    const clean = String(value || "").trim();
    if (!clean) return;
    const csv = looksLikePastedTable(clean) ? pastedTableToCsv(clean) : clean;
    addFiles([new File([csv], `pasted-table-${Date.now()}.csv`, { type: "text/csv" })]);
    setContent((current) => current || copy.chat.tablePrompt);
    setTablePreview(parseCsvRows(csv).slice(0, 30));
    setToolsOpen(false);
    setTableOpen(true);
  }

  async function updateTablePreviewFromFile(nextFile) {
    const name = nextFile?.name || "";
    if (!/\.(csv|txt)$/i.test(name)) {
      setTablePreview([]);
      return;
    }
    const text = await nextFile.text();
    setTablePreview(parseCsvRows(text).slice(0, 30));
  }

  function removeAttachment(index) {
    removeFile(index);
    if (inputRef.current && files.length <= 1) inputRef.current.value = "";
  }

  function stopThinking() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    onAsk((current) => ({
      ...(current || {}),
      messages: [
        ...(current?.messages || []).filter((message) => !message.pending),
        { role: "system", content: "Request stopped before AIWS received a final answer.", attachments: [] },
      ],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    if (sending || (!content.trim() && files.length === 0)) return;
    let targetPath = activePath;
    if (docked && activePath?.projectPath && !activePath?.sessionSlug) {
      const sessionPayload = await fetchJson(`/api/sessions/${activePath.projectPath}`, {
        method: "POST",
        body: new URLSearchParams({ title: `Dock: ${dockContext?.label || "Workflow context"}` }),
      });
      targetPath = { ...activePath, sessionSlug: sessionPayload.session?.slug || "" };
      onSessionCreated?.(sessionPayload.session);
    }
    if (!targetPath?.projectPath || !targetPath?.sessionSlug) return;
    let submitMode = selectedMode;
    if (hasVisionOnlyFiles(mode, modelModes)) {
      setMode("cheap");
      submitMode = modelMode("cheap", modelModes);
    }
    if (submitMode.cloud && !cloudConfirmed(mode)) {
      setCloudPrompt(true);
      return;
    }
    const form = new FormData();
    const dockPrefix = docked && dockContext
      ? `Scoped context: ${dockContext.kind} · ${dockContext.path || dockContext.runId || dockContext.resourceType || dockContext.label}\n\n`
      : "";
    form.set("content", `${dockPrefix}${content}`);
    form.set("provider", submitMode.provider);
    form.set("model", submitMode.model);
    form.set("search_mode", searchMode);
    if (searchMode === "always") form.set("allow_network", "1");
    if (submitMode.cloud) {
      form.set("allow_remote", "1");
      form.set("confirm_cost", "1");
    }
    files.forEach((item) => form.append("attachment", item));

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

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
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
              { id: "accepted", status: "completed", title: "Request accepted" },
              { id: "context", status: "running", title: `${files.length} file${files.length === 1 ? "" : "s"} and chat context prepared` },
              { id: "model", status: "pending", title: `${submitMode.provider} · ${submitMode.model}` },
              { id: "receipt", status: "pending", title: "Context receipt and answer will be saved" },
            ],
            estimated_model_calls: 1,
          },
        },
      ],
    }));
    try {
      const payload = await fetchJson(`/api/ask/${targetPath.projectPath}/${targetPath.sessionSlug}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      onAsk(payload);
    } catch (err) {
      if (err.name === "AbortError") return;
      onAsk((current) => ({
        ...(current || {}),
        messages: [
          ...(current?.messages || []).filter((message) => !message.pending),
          { role: "system", content: err.message, attachments: [] },
        ],
      }));
    } finally {
      setSending(false);
      abortRef.current = null;
      textRef.current?.focus();
    }
  }

  function keyDown(event) {
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
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
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
              <button type="button" onClick={() => setSearchMode("always")}><b>{copy.chat.tools.web}</b><small>{copy.catalog?.output || "Output"}: research notes</small></button>
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
        {!docked && <select className="search-select" name="search_mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
          {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{copy.search[item.value] || item.label}</option>)}
        </select>}
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
          hasFile={files.length > 0}
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
