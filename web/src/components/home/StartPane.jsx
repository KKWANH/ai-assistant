import React, { useEffect, useState } from "react";
import { Composer } from "../chat/Composer";
import { HomeArtifactContent } from "../table/TableWorkbenchPanel.jsx";
import { COPY, copyForAccount } from "../../shared/copy/copy";
import { fetchJson } from "../../lib/api.js";
import {
  MODEL_MODES,
  normalizeModelCatalog,
} from "../../lib/modelModes.jsx";

export const STARTER_ACTIONS = [
  {
    id: "document_summary",
    label: "Summarize document",
    category: "Chat Tool",
    status: "Ready",
    description: "Read a PDF, DOCX, TXT, or MD file and start a structured summary.",
    inputs: ".pdf · .docx · .txt · .md",
    output: "summary answer · optional Markdown artifact",
    scope: "One-off tool",
    viewer: "Markdown viewer",
    prompt: "Summarize the attached document structurally. Separate core claims, important evidence, and follow-up questions.",
    wantsFile: true,
  },
  {
    id: "image_explain",
    label: "Describe image",
    category: "Chat Tool",
    status: "Ready",
    description: "Attach an image and ask the workspace to describe or compare what it sees.",
    inputs: ".png · .jpg · .webp",
    output: "visual explanation answer",
    scope: "One-off tool",
    viewer: "Image preview",
    prompt: "Describe the attached image. Split visible elements, important context, and things I should verify.",
    wantsFile: true,
  },
  {
    id: "csv_analysis",
    label: "Analyze table",
    category: "Chat Tool",
    status: "Ready",
    description: "Inspect CSV, Excel, or pasted table structure, key figures, and possible outliers.",
    inputs: ".csv · .xls · .xlsx · pasted table",
    output: "table preview · profile summary",
    scope: "One-off tool",
    viewer: "Table viewer",
    prompt: "Profile this table deterministically and summarize the column structure, key figures, possible outliers, and next analysis steps.",
    wantsFile: true,
  },
  {
    id: "deep_research",
    label: "Deep Research",
    category: "Chat Tool",
    status: "Ready",
    description: "Start a research pass that separates local context, web search intent, citations, and follow-up questions.",
    inputs: "question · optional files · web approval",
    output: "research brief · cited notes",
    scope: "One-off tool",
    viewer: "Research brief",
    prompt: "Research this question carefully. Separate what came from local files, what needs web verification, sources to check, risks, and next questions.",
  },
];

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

export function StarterActionsGrid({ actions, onStart, running = "", hasFile = false, copy = COPY }) {
  const allowedToolIds = new Set(STARTER_ACTIONS.map((action) => action.id));
  const sourceActions = actions?.length ? actions.filter((action) => allowedToolIds.has(action.id)) : STARTER_ACTIONS;
  const items = sourceActions.map((action) => ({
    ...action,
    label: action.label || action.title,
    inputs: Array.isArray(action.inputs) ? action.inputs.join(" · ") : action.inputs,
    output: Array.isArray(action.expected_output_artifacts) ? action.expected_output_artifacts.join(" · ") : action.output,
    disabled: String(action.status).toLowerCase() === "planned",
    wantsFile: Array.isArray(action.inputs) && action.inputs.some((item) => String(item).startsWith(".")),
    wantsBrief: action.id === "codex_task_prompt",
  }));
  const localizedItems = items.map((action) => localizeStarterAction(action, copy));
  const actionState = (action) => {
    if (action.disabled) return { value: "planned", label: copy.home.notAvailable, helper: copy.home.notAvailable };
    if (action.wantsFile && !hasFile) return { value: "needs-file", label: copy.home.needsFile, helper: copy.home.attachRequired };
    if (action.wantsBrief) return { value: "ready", label: copy.home.ready, helper: copy.home.codexBriefHint };
    return { value: "ready", label: copy.home.ready, helper: copy.home.readyToRun };
  };
  return (
    <section className="starter-actions" aria-label={copy.home.quickActions}>
      <div className="simple-tool-grid-label">{copy.home.quickActions}</div>
      <div className="starter-grid">
        {localizedItems.map((action) => {
          const state = actionState(action);
          return (
            <button
              className={`starter-card simple-tool-card ${action.disabled ? "is-disabled" : ""}`}
              key={action.id}
              type="button"
              onClick={() => onStart?.(action)}
              disabled={action.disabled}
              title={state.helper}
            >
              <strong>{action.label}</strong>
              <span>[{copy.chat.attachFile}] → [{running === action.id ? copy.home.creating : copy.chat.send}]</span>
              <small>{action.inputs}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ToolRunPanel({ action, running, onClose, onRun, copy = COPY }) {
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState("");
  const inputId = `home-tool-file-${action?.id || "tool"}`;
  if (!action) return null;
  const localized = localizeStarterAction(action, copy);
  const canRun = !localized.wantsFile || files.length > 0;

  function addFiles(nextFiles) {
    const next = Array.from(nextFiles || []);
    setFiles((current) => [...current, ...next]);
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section
      className="tool-run-panel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(event.dataTransfer?.files);
      }}
    >
      <div className="tool-run-panel-head">
        <div>
          <small>{localized.category || copy.catalog?.oneOffTool || "Chat Tool"}</small>
          <strong>{localized.label}</strong>
        </div>
        <button type="button" onClick={onClose}>{copy.common?.close || "닫기"}</button>
      </div>
      <p>{localized.inputs} → {localized.output || "answer"}</p>
      <div className="tool-run-drop">
        <input
          id={inputId}
          type="file"
          multiple
          onChange={(event) => addFiles(event.target.files)}
          accept=".txt,.md,.csv,.xls,.xlsx,.json,.yaml,.yml,.pdf,.docx,.ppt,.pptx,image/png,image/jpeg,image/gif,image/webp"
        />
        <label htmlFor={inputId}>{files.length ? "파일 더 추가" : "파일 선택 / 끌어놓기"}</label>
        {files.length > 0 && (
          <div className="tool-run-files">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`}>{file.name}<button type="button" onClick={() => removeFile(index)}>×</button></span>
            ))}
          </div>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="추가 지시. 예: 표는 월별 변화 중심, 문서는 핵심 근거만."
      />
      <div className="tool-run-actions">
        <button type="button" onClick={onClose}>취소</button>
        <button
          type="button"
          className="primary"
          disabled={!canRun || running === localized.id}
          onClick={() => onRun(localized, { files, content: notes })}
        >
          {running === localized.id ? copy.home.creating : "실행"}
        </button>
      </div>
      {!canRun && <small className="tool-run-hint">{copy.home.attachRequired}</small>}
    </section>
  );
}

function localizeStarterAction(action, copy) {
  const localized = copy.starterActions?.[action.id];
  return localized ? { ...action, ...localized } : action;
}

function HomeRunDetailModal({ detail, power, onClose, onOpenArtifact }) {
  const run = detail.run || {};
  const plan = run.execution_plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Work Detail</p>
        <h2>{run.label || run.action_id || "Workbench output"}</h2>
        <div className="run-meta-grid"><span>Status: {run.status}</span><span>Tool/App: {run.action_id}</span><span>{run.created_at}</span></div>
        {run.artifacts?.length > 0 && <div className="artifact-list"><strong>Artifacts</strong>{run.artifacts.map((item) => <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>{item.path.split("/").pop()} · {item.viewer_type}</button>)}</div>}
        {steps.length > 0 && <div className="run-step-list"><strong>Steps</strong>{steps.map((step) => <span key={step.id || step.type}><b>{step.id || step.type}</b><small>{step.output || step.status || "done"}</small></span>)}</div>}
        <details className="run-log-details" open={power}>
          <summary>Logs</summary>
          <pre>{(run.logs || detail.logs || []).map((item) => `[${item.kind || item.type || "log"}] ${item.content || item.message || ""}`).join("\n") || "(empty)"}</pre>
          {run.errors?.length > 0 && <pre className="error-text">{run.errors.join("\n")}</pre>}
        </details>
        {power && <details className="run-log-details"><summary>Raw plan</summary><pre>{JSON.stringify(plan, null, 2)}</pre></details>}
      </div>
    </div>
  );
}

function HomeArtifactViewer({ artifact, onClose, onAsk, onReport }) {
  const filename = artifact.path?.split("/")?.pop() || artifact.path;
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Artifact Viewer</p>
        <h2>{filename}</h2>
        <small className="artifact-path">{artifact.path}</small>
        <div className="artifact-toolbar">
          <div className="next-actions">
            <button type="button" onClick={() => onAsk?.(artifact)}>Ask AI about this</button>
            <button type="button" onClick={() => onReport?.(artifact)}>Save report</button>
            <a className="button-link" href={`/api/home-artifact?path=${encodeURIComponent(artifact.path)}`} target="_blank" rel="noreferrer">Open</a>
          </div>
          <span className="soft-pill">{artifact.viewer_type} · {artifact.size} bytes</span>
        </div>
        <HomeArtifactContent artifact={artifact} />
      </div>
    </div>
  );
}

export function StartPane({ error, navigate, refreshWorkspace, onAsk, account, models = MODEL_MODES, projectPath = "", embedded = false, home, onHome }) {
  const [homeRunning, setHomeRunning] = useState("");
  const [homeRunDetail, setHomeRunDetail] = useState(null);
  const [homeArtifact, setHomeArtifact] = useState(null);
  const [homeError, setHomeError] = useState("");
  const [composerDraft, setComposerDraft] = useState("");
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [composerAttachmentSignal, setComposerAttachmentSignal] = useState(0);
  const [toolPanelAction, setToolPanelAction] = useState(null);
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const modelModes = normalizeModelCatalog(models);
  const isHomeWorkbench = !embedded && !projectPath;

  useEffect(() => {
    if (!isHomeWorkbench) return;
    const starterId = new URLSearchParams(window.location.search).get("starter");
    if (!starterId) return;
    const rawAction = STARTER_ACTIONS.find((item) => item.id === starterId);
    const action = rawAction ? localizeStarterAction(rawAction, copy) : null;
    if (action && !action.disabled) {
      setComposerDraft(action.prompt || action.label);
      setComposerFocusSignal((value) => value + 1);
      if (action.wantsFile) setComposerAttachmentSignal((value) => value + 1);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [copy, isHomeWorkbench]);

  function clearFile() {
    // Shared Composer owns home chat attachments.
  }

  function startAction(action) {
    if (action.disabled) return;
    setToolPanelAction(action);
  }

  async function runHomeAction(action, options = {}) {
    if (!isHomeWorkbench || homeRunning || action.disabled || String(action.status).toLowerCase() === "planned") return;
    const actionFiles = Array.from(options.files || []);
    const actionContent = String(options.content || "").trim();
    if (action.wantsFile && actionFiles.length === 0) {
      setHomeError(copy.home.attachRequired);
      setToolPanelAction(action);
      return;
    }
    if (action.id === "codex_task_prompt" && !actionContent && !composerDraft.trim()) {
      setHomeError(copy.home.codexBriefRequired);
      return;
    }
    setHomeRunning(action.id);
    setHomeError("");
    try {
      const form = new FormData();
      form.set("content", actionContent || composerDraft.trim() || action.prompt || action.label || action.title || "");
      form.set("provider", "ollama");
      form.set("model", "qwen3:8b");
      actionFiles.forEach((file) => form.append("attachment", file));
      const payload = await fetchJson(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact) await askAboutHomeArtifact(firstArtifact);
      else setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
      clearFile();
      setToolPanelAction(null);
    } catch (err) {
      setHomeError(err.message || "Could not run Chat Tool.");
    } finally {
      setHomeRunning("");
    }
  }

  async function openHomeArtifact(item) {
    setHomeError("");
    try {
      const payload = await fetchJson(`/api/home-artifact?path=${encodeURIComponent(item.path)}`);
      setHomeArtifact(payload.artifact);
    } catch (err) {
      setHomeError(err.message);
    }
  }

  async function askAboutHomeArtifact(artifact) {
    const payload = await fetchJson("/api/home-artifact/ask", { method: "POST", body: new URLSearchParams({ path: artifact.path }) });
    refreshWorkspace?.();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  async function reportFromHomeArtifact(artifact) {
    setHomeError("");
    try {
      const payload = await fetchJson("/api/home-artifact/report", { method: "POST", body: new URLSearchParams({ path: artifact.path }) });
      onHome?.(payload.home);
      setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
    } catch (err) {
      setHomeError(err.message);
    }
  }

  const contentNode = (
    <div className={`start-content ${isHomeWorkbench ? "home-workbench" : ""}`}>
      {!isHomeWorkbench && <div className="home-hero"><h1>{copy.chat.emptyTitle}</h1></div>}
      <div className="start-composer-shell" data-context-note="AIWS prioritizes saved chats, project context, and attached files.">
        <Composer
          activePath={{ projectPath, sessionSlug: "" }}
          onAsk={onAsk}
          account={account}
          power={power}
          models={modelModes}
          initialContent={composerDraft}
          focusSignal={composerFocusSignal}
          openAttachmentSignal={composerAttachmentSignal}
          onSessionCreated={(session) => {
            const targetProject = session.project_path || projectPath;
            if (targetProject && session.slug) navigate(`/chat/${targetProject}/${session.slug}`);
            refreshWorkspace?.();
          }}
        />
      </div>
      {isHomeWorkbench ? (
        <>
          <StarterActionsGrid actions={home?.actions} onStart={startAction} running={homeRunning} hasFile={false} copy={copy} />
          <ToolRunPanel action={toolPanelAction} running={homeRunning} onClose={() => setToolPanelAction(null)} onRun={runHomeAction} copy={copy} />
        </>
      ) : (
        <div className="quick-actions">{copy.chat.quickPrompts.map((item) => <button type="button" key={item} onClick={() => { setComposerDraft(item); setComposerFocusSignal((value) => value + 1); }}>{item}</button>)}</div>
      )}
      {homeError && <div className="system-note">{homeError}</div>}
      {error && <div className="system-note">{error}</div>}
      {homeRunDetail && <HomeRunDetailModal detail={homeRunDetail} power={power} onClose={() => setHomeRunDetail(null)} onOpenArtifact={openHomeArtifact} />}
      {homeArtifact && <HomeArtifactViewer artifact={homeArtifact} onClose={() => setHomeArtifact(null)} onAsk={askAboutHomeArtifact} onReport={reportFromHomeArtifact} />}
    </div>
  );
  if (embedded) return <div className="start-pane embedded-start-pane">{contentNode}</div>;
  return <section className="center-pane start-pane">{contentNode}</section>;
}
