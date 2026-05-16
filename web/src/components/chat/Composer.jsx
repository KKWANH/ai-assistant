import React, { useEffect, useRef, useState } from "react";
import { ModelPickerButton } from "../model/ModelPickerButton.jsx";
import { AttachmentPicker } from "./AttachmentPicker.jsx";
import { SelectedAttachmentList } from "./SelectedAttachmentList.jsx";
import { useAttachments } from "../../hooks/useAttachments.js";
import { copyForAccount } from "../../copy.js";
import { fetchJson, getCookie, setCookie } from "../../lib/api.js";
import { looksLikePastedTable, pastedTableToCsv } from "../../lib/table.js";
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

function CloudConfirm({ mode, hasFile, onUseOnce, onUseAlways, onCancel }) {
  return (
    <div className="cloud-confirm" role="alert">
      <strong>{mode.label} is a cloud AI model.</strong>
      <p>The privacy manifest for this request will record exactly what leaves AIWS before the cloud call completes.</p>
      <ul>
        <li>Provider/model: {mode.provider} · {mode.model}</li>
        <li>User message: included</li>
        <li>Attached file: {hasFile ? "computed file context or vision/file input" : "none"}</li>
        <li>Estimated cost: {estimateCurrentCost(mode, "", hasFile)}</li>
      </ul>
      <div>
        <button type="button" onClick={onUseOnce}>Use once</button>
        <button type="button" onClick={onUseAlways}>Keep using this model</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function Composer({ activePath, onAsk, account, power, models = MODEL_MODES }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
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
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    addFiles(event.dataTransfer?.files || []);
  }

  function pasteTable(event) {
    const pasted = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikePastedTable(pasted)) return;
    event.preventDefault();
    const csv = pastedTableToCsv(pasted);
    addFiles([new File([csv], `pasted-table-${Date.now()}.csv`, { type: "text/csv" })]);
    setContent((current) => current || "Analyze this pasted table.");
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
    form.set("content", content);
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
      const payload = await fetchJson(`/api/ask/${activePath.projectPath}/${activePath.sessionSlug}`, {
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
      className={`composer ${dragging ? "dragging" : ""}`}
      data-api-action={`/api/ask/${activePath.projectPath}/${activePath.sessionSlug}`}
      encType="multipart/form-data"
      onSubmit={submit}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={pickDroppedFile}
    >
      {dragging && <div className="drop-hint">Drop a file to attach it to this message.</div>}
      <textarea
        ref={textRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onPaste={pasteTable}
        onKeyDown={keyDown}
        placeholder={copy.chat.placeholder}
      />
      <SelectedAttachmentList files={files} previewUrl={previewUrl} previewUrls={previewUrls} selectedMode={selectedMode} onRemove={removeAttachment} />
      {primaryFile?.type?.startsWith("image/") && !selectedMode.supportsImage && (
        <div className="system-note compact-warning">This image needs a vision model. AIWS will switch to Gemini Flash-Lite before sending.</div>
      )}
      <div className="composer-toolbar">
        <AttachmentPicker inputRef={inputRef} label={copy.chat.attachFile} onFiles={addFiles} />
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
        <select className="search-select" name="search_mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
          {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{copy.search[item.value] || item.label}</option>)}
        </select>
        {sending ? (
          <button className="send-key stop" type="button" onClick={stopThinking}>Stop</button>
        ) : (
          <button className="send-key" type="submit">Send</button>
        )}
      </div>
      {cloudPrompt && (
        <CloudConfirm
          mode={selectedMode}
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
    </form>
  );
}
