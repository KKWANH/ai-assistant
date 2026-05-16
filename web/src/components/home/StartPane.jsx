import React, { useEffect, useRef, useState } from "react";
import { AttachmentPicker } from "../chat/AttachmentPicker.jsx";
import { SelectedAttachmentList } from "../chat/SelectedAttachmentList.jsx";
import { WaitingNotice } from "../chat/WaitingNotice.jsx";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer.jsx";
import { ModelPickerButton } from "../model/ModelPickerButton.jsx";
import { useAttachments } from "../../hooks/useAttachments.js";
import { COPY, copyForAccount } from "../../copy.js";
import { fetchJson, setCookie } from "../../lib/api.js";
import { looksLikePastedTable, parseCsvRows, pastedTableToCsv } from "../../lib/table.js";
import {
  estimateCurrentCost,
  fileNeedsVisionModel,
  MODEL_MODES,
  modelMode,
  normalizeModelCatalog,
  savedModelMode,
  savedSearchMode,
  SEARCH_OPTIONS,
} from "../../lib/modelModes.jsx";

export const STARTER_ACTIONS = [
  {
    id: "document_summary",
    label: "Summarize document",
    category: "Document",
    status: "Ready",
    description: "Read a PDF, DOCX, TXT, or MD file and start a structured summary.",
    inputs: ".pdf · .docx · .txt · .md",
    output: "Chat answer + Markdown",
    prompt: "Summarize the attached document structurally. Separate core claims, important evidence, and follow-up questions.",
    wantsFile: true,
  },
  {
    id: "image_explain",
    label: "Describe image",
    category: "Image",
    status: "Ready",
    description: "Attach an image and ask the workspace to describe or compare what it sees.",
    inputs: ".png · .jpg · .webp",
    output: "Chat answer",
    prompt: "Describe the attached image. Split visible elements, important context, and things I should verify.",
    wantsFile: true,
  },
  {
    id: "csv_analysis",
    label: "Analyze table",
    category: "Data",
    status: "Ready",
    description: "Inspect CSV, Excel, or pasted table structure, key figures, and possible outliers.",
    inputs: ".csv · .xls · .xlsx · pasted table",
    output: "Table preview + Summary",
    prompt: "Profile this table deterministically and summarize the column structure, key figures, possible outliers, and next analysis steps.",
    wantsFile: true,
  },
  {
    id: "codex_task_prompt",
    label: "Create Codex task prompt",
    category: "Code",
    status: "Ready",
    description: "Turn a goal and constraints into an execution-ready Codex prompt.",
    inputs: "goal · files",
    output: "Codex prompt",
    prompt: "Turn the goal below into a Codex task prompt. Include repo context, constraints, test commands, and acceptance criteria.",
    wantsBrief: true,
  },
  {
    id: "investment_rebalancer",
    label: "Investment rebalancer",
    category: "Investment",
    status: "Ready",
    description: "Start a rebalancing workspace from CSV/YAML inputs.",
    inputs: ".csv · .yaml",
    output: "CSV artifact + Report",
    prompt: "Use the portfolio CSV and target allocation YAML to summarize current weights, target gaps, and rebalance candidates.",
    wantsFile: true,
  },
  {
    id: "folder_index",
    label: "Read folder structure",
    category: "Files",
    status: "Planned",
    description: "Plan a file index for turning a local folder into an AIWS project.",
    inputs: "folder",
    output: "File index",
    prompt: "Propose file grouping and a workspace plan for turning this folder structure into an AIWS project.",
    disabled: true,
  },
];

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

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
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

export function StarterActionsGrid({ actions, onStart, onRun, running = "", hasFile = false, onOpenTable, copy = COPY }) {
  const items = actions?.length ? actions.map((action) => ({
    ...action,
    label: action.label || action.title,
    inputs: Array.isArray(action.inputs) ? action.inputs.join(" · ") : action.inputs,
    output: Array.isArray(action.expected_output_artifacts) ? action.expected_output_artifacts.join(" · ") : action.output,
    disabled: String(action.status).toLowerCase() === "planned",
    wantsFile: Array.isArray(action.inputs) && action.inputs.some((item) => String(item).startsWith(".")),
    wantsBrief: action.id === "codex_task_prompt",
  })) : STARTER_ACTIONS;
  const localizedItems = items.map((action) => localizeStarterAction(action, copy));
  const actionState = (action) => {
    if (action.disabled) return { value: "planned", label: copy.home.notAvailable, helper: copy.home.notAvailable };
    if (action.wantsFile && !hasFile) return { value: "needs-file", label: copy.home.needsFile, helper: copy.home.attachRequired };
    if (action.wantsBrief) return { value: "ready", label: copy.home.ready, helper: copy.home.codexBriefHint };
    return { value: "ready", label: copy.home.ready, helper: copy.home.readyToRun };
  };
  return (
    <section className="starter-actions" aria-label={copy.home.quickActions}>
      <div className="section-row">
        <div className="panel-title-stack">
          <p className="eyebrow">{copy.home.quickActions}</p>
          <h2>{copy.home.runBeforeProject}</h2>
        </div>
        <span className="soft-pill">{copy.home.workbenchOutputs}</span>
      </div>
      <div className="starter-grid">
        {localizedItems.map((action) => {
          const state = actionState(action);
          return (
            <article className={`starter-card ${action.disabled ? "is-disabled" : ""}`} key={action.id}>
              <div className="starter-card-head">
                <span className="starter-category">{action.category}</span>
                <span className={`status-badge ${state.value}`}>{state.label}</span>
              </div>
              <h3>{action.label}</h3>
              <p>{action.description}</p>
              <div className="starter-meta">
                <span>Input: {action.inputs}</span>
                <span>Output: {action.output}</span>
              </div>
              <div className="starter-actions-row">
                <button type="button" onClick={() => action.id === "csv_analysis" ? onOpenTable?.() : onStart?.(action)} disabled={action.disabled}>
                  {action.disabled ? copy.home.notAvailable : action.id === "csv_analysis" ? copy.home.openTable : action.wantsBrief ? copy.home.prepareBrief : hasFile ? copy.home.useInput : copy.home.configure}
                </button>
                <button
                  type="button"
                  onClick={() => onRun?.(action)}
                  disabled={action.disabled || running === action.id || (action.wantsFile && !hasFile)}
                  title={action.wantsFile && !hasFile ? copy.home.attachRequired : action.disabled ? copy.home.notAvailable : action.wantsBrief ? copy.home.createPrompt : copy.home.createArtifact}
                >
                  {running === action.id ? copy.home.creating : action.wantsBrief ? copy.home.createPrompt : copy.home.createArtifact}
                </button>
              </div>
              <small className="action-requirement">{state.helper}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function localizeStarterAction(action, copy) {
  const localized = copy.starterActions?.[action.id];
  return localized ? { ...action, ...localized } : action;
}

function HomeWorkbenchHints({ copy = COPY }) {
  return (
    <section className="home-hints" aria-label="Home Workbench next steps">
      <article className="home-hint-card"><span>1</span><strong>{copy.home.hintCreateTitle}</strong><p>{copy.home.hintCreateBody}</p></article>
      <article className="home-hint-card"><span>2</span><strong>{copy.home.hintInspectTitle}</strong><p>{copy.home.hintInspectBody}</p></article>
      <article className="home-hint-card"><span>3</span><strong>{copy.home.hintPromoteTitle}</strong><p>{copy.home.hintPromoteBody}</p></article>
    </section>
  );
}

function TableWorkbenchPanel({ open, file, rows, running, onClose, onChooseFile, onSetText, onDropFile, onRun, copy = COPY }) {
  const [text, setText] = useState("");
  const tableCopy = copy.table || COPY.table;
  if (!open) return null;
  function drop(event) {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (dropped.length) onDropFile?.(dropped);
  }
  function paste(event) {
    const value = event.clipboardData?.getData("text/plain") || "";
    if (!value.trim()) return;
    event.preventDefault();
    setText(value);
    onSetText?.(value);
  }
  return (
    <section className="table-workbench" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <div className="section-row">
        <div className="panel-title-stack"><p className="eyebrow">{tableCopy.eyebrow}</p><h2>{tableCopy.title}</h2></div>
        <button type="button" onClick={onClose}>{tableCopy.close}</button>
      </div>
      <div className="table-drop-zone">
        <strong>{file ? file.name : tableCopy.emptyDrop}</strong>
        <span>{tableCopy.pastedHint}</span>
        <div className="table-actions">
          <button type="button" onClick={onChooseFile}>{tableCopy.chooseFile}</button>
          <button type="button" onClick={onRun} disabled={!file || running}>{running ? tableCopy.analyzing : tableCopy.analyze}</button>
        </div>
      </div>
      <textarea
        className="table-paste-box"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (looksLikePastedTable(event.target.value)) onSetText?.(event.target.value);
        }}
        onPaste={paste}
        placeholder={tableCopy.pastePlaceholder}
      />
      {rows.length > 0 ? <TablePreview rows={rows} /> : <div className="empty-action-state"><p className="muted">{tableCopy.noPreview}</p><span>{tableCopy.noPreviewHint}</span></div>}
    </section>
  );
}

function TablePreview({ rows }) {
  return (
    <div className="artifact-table-wrap live-table-preview">
      <table className="artifact-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("|")}`}>
              {row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HomeWorkSessionOverview({ home, hasFile, onAttach, onCreateProject, copy = COPY }) {
  const runCount = home?.runs?.length || 0;
  const artifactCount = home?.artifacts?.length || 0;
  const actionCount = home?.actions?.filter((action) => String(action.status || "").toLowerCase() !== "planned").length || STARTER_ACTIONS.length;
  return (
    <section className="work-session-overview" aria-label="Start a work session">
      <div className="work-session-copy"><p className="eyebrow">{copy.home.workSessionEyebrow}</p><h2>{copy.home.workSessionTitle}</h2><p>{copy.home.workSessionBody}</p></div>
      <div className="work-session-lanes">
        <button type="button" className="work-lane" onClick={() => document.querySelector(".start-composer textarea")?.focus()}><strong>{copy.home.laneAsk}</strong><span>{copy.home.laneAskBody}</span></button>
        <button type="button" className={`work-lane ${hasFile ? "ready" : ""}`} onClick={onAttach}><strong>{copy.home.laneFile}</strong><span>{hasFile ? copy.home.laneFileReady : copy.home.laneFileBody}</span></button>
        <button type="button" className="work-lane" onClick={onCreateProject}><strong>{copy.home.laneProject}</strong><span>{copy.home.laneProjectBody}</span></button>
      </div>
      <div className="work-session-facts" aria-label="Persisted workbench facts">
        <span><strong>{actionCount}</strong>{copy.home.factActions}</span>
        <span><strong>{runCount}</strong>{copy.home.factRuns}</span>
        <span><strong>{artifactCount}</strong>{copy.home.factArtifacts}</span>
      </div>
    </section>
  );
}

function HomeWorkbenchPanels({ home, power, onOpenRun, onOpenArtifact, copy = COPY }) {
  const runs = home?.runs || [];
  const artifacts = home?.artifacts || [];
  return (
    <section className="home-object-panels" aria-label="Recent runs and artifacts">
      <div className="dashboard-card">
        <div className="section-row"><div className="panel-title-stack"><p className="eyebrow">{copy.home.recentRuns}</p><h2>{copy.home.runHistory}</h2></div><span className="soft-pill">{runs.length}</span></div>
        {runs.length === 0 ? <div className="empty-action-state"><p className="muted">{copy.home.starterEmpty}</p><span>{copy.home.starterEmptyAction}</span></div> : (
          <div className="run-list">
            {runs.slice(0, 6).map((run) => <button className="run-row clickable-row" type="button" key={run.run_id || run.id} onClick={() => onOpenRun?.(run)}><strong>{run.label}</strong><span>{run.status}</span><small>{power ? run.action_id : run.created_at}</small></button>)}
          </div>
        )}
      </div>
      <div className="dashboard-card">
        <div className="section-row"><div className="panel-title-stack"><p className="eyebrow">{copy.home.recentArtifacts}</p><h2>{copy.home.artifacts}</h2></div><span className="soft-pill">{artifacts.length}</span></div>
        {artifacts.length === 0 ? <div className="empty-action-state"><p className="muted">{copy.home.artifactEmpty}</p><span>{copy.home.artifactEmptyAction}</span></div> : (
          <div className="artifact-grid">
            {artifacts.slice(0, 8).map((artifact) => <button className="artifact-tile clickable-row" type="button" key={artifact.id || artifact.path} onClick={() => onOpenArtifact?.(artifact)}><strong>{artifact.path.split("/").pop()}</strong><span>{artifact.viewer_type || artifact.type}</span><small>{artifact.summary || artifact.run?.label}</small></button>)}
          </div>
        )}
      </div>
    </section>
  );
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
        <div className="run-meta-grid"><span>Status: {run.status}</span><span>Action: {run.action_id}</span><span>{run.created_at}</span></div>
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
            <button type="button" onClick={() => onReport?.(artifact)}>Generate report</button>
            <a className="button-link" href={`/api/home-artifact?path=${encodeURIComponent(artifact.path)}`} target="_blank" rel="noreferrer">Open</a>
          </div>
          <span className="soft-pill">{artifact.viewer_type} · {artifact.size} bytes</span>
        </div>
        <HomeArtifactContent artifact={artifact} />
      </div>
    </div>
  );
}

function HomeArtifactContent({ artifact }) {
  const kind = artifact.type || artifact.kind;
  const content = artifact.content || "";
  if (kind === "csv") {
    const rows = content.trim().split(/\r?\n/).slice(0, 80).map((line) => line.split(","));
    return (
      <div className="artifact-table-wrap">
        <table className="artifact-table"><tbody>{rows.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join("|")}`}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
      </div>
    );
  }
  if (kind === "json") {
    try {
      return <pre>{JSON.stringify(JSON.parse(content), null, 2)}</pre>;
    } catch {
      return <pre>{content}</pre>;
    }
  }
  if (kind === "md" || kind === "markdown") return <MarkdownRenderer>{content}</MarkdownRenderer>;
  return <pre>{content}</pre>;
}

export function StartPane({ error, navigate, refreshWorkspace, onAsk, account, models = MODEL_MODES, projectPath = "", embedded = false, home, onHome, refreshHome }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
  const [homeRunning, setHomeRunning] = useState("");
  const [homeRunDetail, setHomeRunDetail] = useState(null);
  const [homeArtifact, setHomeArtifact] = useState(null);
  const [homeError, setHomeError] = useState("");
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePreview, setTablePreview] = useState([]);
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const { files, primaryFile: file, previewUrl, previewUrls, addFiles, removeFile, clearFiles } = useAttachments();
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const modelModes = normalizeModelCatalog(models);
  const selectedMode = modelMode(mode, modelModes);
  const isHomeWorkbench = !embedded && !projectPath;

  useEffect(() => {
    if (!isHomeWorkbench) return;
    const starterId = new URLSearchParams(window.location.search).get("starter");
    if (!starterId) return;
    const rawAction = STARTER_ACTIONS.find((item) => item.id === starterId);
    const action = rawAction ? localizeStarterAction(rawAction, copy) : null;
    if (action && !action.disabled) {
      setContent(action.prompt || action.label);
      if (action.wantsFile) window.setTimeout(() => inputRef.current?.click(), 50);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [copy, isHomeWorkbench]);

  useEffect(() => setCookie("aiws_model_mode", mode), [mode]);
  useEffect(() => setCookie("aiws_search_mode", searchMode), [searchMode]);

  function clearFile() {
    clearFiles();
    setTablePreview([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (dropped.length) {
      addFiles(dropped);
      updateTablePreviewFromFile(dropped[0]);
    }
  }

  function pasteTable(event) {
    const pasted = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikePastedTable(pasted)) return;
    event.preventDefault();
    const csv = pastedTableToCsv(pasted);
    const nextFile = new File([csv], `pasted-table-${Date.now()}.csv`, { type: "text/csv" });
    addFiles([nextFile]);
    setTablePreview(parseCsvRows(csv).slice(0, 30));
    setTableOpen(true);
    setContent((current) => current || "Analyze this pasted table.");
  }

  function startAction(action) {
    if (action.disabled) return;
    setContent(action.prompt || action.label);
    if (action.id === "csv_analysis") {
      setTableOpen(true);
      return;
    }
    if (action.wantsFile) window.setTimeout(() => inputRef.current?.click(), 30);
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

  function setTableFromText(value) {
    const csv = looksLikePastedTable(value) ? pastedTableToCsv(value) : value;
    const nextFile = new File([csv], `pasted-table-${Date.now()}.csv`, { type: "text/csv" });
    addFiles([nextFile]);
    setContent((current) => current || "Analyze this pasted table.");
    setTablePreview(parseCsvRows(csv).slice(0, 30));
  }

  async function runHomeAction(action) {
    if (!isHomeWorkbench || homeRunning || action.disabled || String(action.status).toLowerCase() === "planned") return;
    if (action.wantsFile && !file) {
      setHomeError(copy.home.attachRequired);
      inputRef.current?.click();
      return;
    }
    if (action.id === "codex_task_prompt" && !content.trim()) {
      setHomeError(copy.home.codexBriefRequired);
      return;
    }
    setHomeRunning(action.id);
    setHomeError("");
    try {
      const form = new FormData();
      form.set("content", content.trim() || action.prompt || action.label || action.title || "");
      form.set("provider", selectedMode.provider);
      form.set("model", selectedMode.model);
      files.forEach((item) => form.append("attachment", item));
      const payload = await fetchJson(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact) await openHomeArtifact(firstArtifact);
      else setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
      clearFile();
    } catch (err) {
      setHomeError(err.message || "Could not run Starter Action.");
    } finally {
      setHomeRunning("");
    }
  }

  async function openHomeRun(run) {
    setHomeError("");
    try {
      setHomeRunDetail(await fetchJson(`/api/home-run?run_id=${encodeURIComponent(run.run_id || run.id)}`));
    } catch (err) {
      setHomeError(err.message);
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

  async function submit(event) {
    event.preventDefault();
    if (starting || (!content.trim() && files.length === 0)) return;
    let submitMode = selectedMode;
    if (files.some((item) => fileNeedsVisionModel(item, mode, modelModes))) {
      setMode("cheap");
      submitMode = modelMode("cheap", modelModes);
    }
    setStarting(true);
    setStartError("");
    try {
      const createForm = new URLSearchParams({ title: "" });
      const created = projectPath
        ? await fetchJson(`/api/sessions/${projectPath}`, { method: "POST", body: createForm })
        : await fetchJson("/api/chats", { method: "POST", body: createForm });
      const createdProjectPath = projectPath || created.project_path;
      const createdSession = created.session;
      navigate(`/chat/${createdProjectPath}/${createdSession.slug}`);
      refreshWorkspace().catch(() => {});
      if (content.trim() || files.length) {
        onAsk({
          project: { path: createdProjectPath, title: projectPath ? "Project" : "General chats", hidden: !projectPath },
          session: createdSession,
          messages: [
            {
              role: "user",
              actor_display: accountDisplayName(account),
              content: content.trim() || `Attached ${files.length} file${files.length === 1 ? "" : "s"}`,
              attachments: files.map((item, index) => ({ filename: item.name, url: previewUrls[index] || "", is_image: item.type.startsWith("image/"), is_pdf: item.type === "application/pdf" })),
            },
            { role: "assistant", pending: true, content: "", attachments: [] },
          ],
          skills: [],
          attachments: [],
          goal: {},
          codex_prompt: "",
          latest: {},
        });
        const askForm = new FormData();
        askForm.set("content", content.trim());
        askForm.set("provider", submitMode.provider);
        askForm.set("model", submitMode.model);
        askForm.set("search_mode", searchMode);
        if (searchMode === "always") askForm.set("allow_network", "1");
        if (submitMode.cloud) {
          askForm.set("allow_remote", "1");
          askForm.set("confirm_cost", "1");
        }
        files.forEach((item) => askForm.append("attachment", item));
        const payload = await fetchJson(`/api/ask/${createdProjectPath}/${createdSession.slug}`, { method: "POST", body: askForm });
        onAsk(payload);
      }
      setContent("");
      clearFile();
    } catch (err) {
      setStartError(err.message || "Could not start chat.");
    } finally {
      setStarting(false);
    }
  }

  function keyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const contentNode = (
    <div className={`start-content ${isHomeWorkbench ? "home-workbench" : ""}`}>
      <div className={isHomeWorkbench ? "home-hero" : ""}>
        {isHomeWorkbench && <p className="eyebrow">Home Workbench</p>}
        <h1>{isHomeWorkbench ? copy.home.workSessionTitle : copy.chat.emptyTitle}</h1>
        <p className="start-subtitle">{projectPath ? "Your first message creates a saved chat inside this project." : copy.home.subtitle}</p>
      </div>
      {isHomeWorkbench && <HomeWorkSessionOverview home={home} hasFile={Boolean(file)} onAttach={() => inputRef.current?.click()} onCreateProject={() => navigate("/projects/new")} copy={copy} />}
      <form
        ref={formRef}
        className={`start-composer ${dragging ? "dragging" : ""}`}
        onSubmit={submit}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={pickDroppedFile}
      >
        {dragging && <div className="drop-hint">Drop files to attach them to the first message.</div>}
        <textarea value={content} onChange={(event) => setContent(event.target.value)} onPaste={pasteTable} onKeyDown={keyDown} placeholder={copy.chat.placeholder} rows={1} />
        <SelectedAttachmentList files={files} previewUrl={previewUrl} previewUrls={previewUrls} selectedMode={selectedMode} onRemove={(index) => { removeFile(index); if (inputRef.current && files.length <= 1) inputRef.current.value = ""; }} />
        {file?.type?.startsWith("image/") && !selectedMode.supportsImage && <div className="system-note compact-warning">This image needs a vision model. AIWS will switch to Gemini Flash-Lite before sending.</div>}
        <div className={`composer-toolbar ${power ? "start-toolbar" : ""}`}>
          <AttachmentPicker inputRef={inputRef} label={copy.chat.attachFile} onFiles={(nextFiles) => { addFiles(nextFiles); if (nextFiles[0]) updateTablePreviewFromFile(nextFiles[0]); }} />
          <ModelPickerButton open={pickerOpen} setOpen={setPickerOpen} selectedKey={mode} onSelect={setMode} content={content} hasFile={Boolean(file)} power={power} modelCatalog={modelModes} />
          <select className="search-select" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
            {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{copy.search[item.value] || item.label}</option>)}
          </select>
          <button className="send-key" type="submit" disabled={starting}>{starting ? <span className="typing" /> : "Send"}</button>
        </div>
        {cloudPrompt && (
          <CloudConfirm
            mode={selectedMode}
            hasFile={Boolean(file)}
            onCancel={() => setCloudPrompt(false)}
            onUseOnce={() => { confirmCloudOnce(mode); setCloudPrompt(false); formRef.current?.requestSubmit(); }}
            onUseAlways={() => { confirmCloudAlways(mode); setCloudPrompt(false); formRef.current?.requestSubmit(); }}
          />
        )}
      </form>
      {starting && <WaitingNotice label={copy.chat.preparing} />}
      {isHomeWorkbench ? (
        <>
          <TableWorkbenchPanel
            open={tableOpen}
            file={file}
            rows={tablePreview}
            running={homeRunning === "csv_analysis"}
            onClose={() => setTableOpen(false)}
            onChooseFile={() => inputRef.current?.click()}
            onSetText={setTableFromText}
            onDropFile={(nextFiles) => { addFiles(nextFiles); updateTablePreviewFromFile(nextFiles[0]); }}
            onRun={() => runHomeAction(localizeStarterAction((home?.actions || STARTER_ACTIONS).find((item) => item.id === "csv_analysis") || STARTER_ACTIONS.find((item) => item.id === "csv_analysis"), copy))}
            copy={copy}
          />
          <StarterActionsGrid actions={home?.actions} onStart={startAction} onRun={runHomeAction} running={homeRunning} hasFile={Boolean(file)} onOpenTable={() => setTableOpen(true)} copy={copy} />
          <HomeWorkbenchPanels home={home} power={power} copy={copy} onOpenRun={openHomeRun} onOpenArtifact={openHomeArtifact} />
          <HomeWorkbenchHints copy={copy} />
        </>
      ) : (
        <div className="quick-actions">{copy.chat.quickPrompts.map((item) => <button type="button" key={item} onClick={() => setContent(item)}>{item}</button>)}</div>
      )}
      <p className="honest-note">AIWS prioritizes saved chats, project context, and attached files. Agentic web/search execution is exposed through controlled actions and plan previews.</p>
      {startError && <div className="system-note">{startError}</div>}
      {homeError && <div className="system-note">{homeError}</div>}
      {error && <div className="system-note">{error}</div>}
      {homeRunDetail && <HomeRunDetailModal detail={homeRunDetail} power={power} onClose={() => setHomeRunDetail(null)} onOpenArtifact={openHomeArtifact} />}
      {homeArtifact && <HomeArtifactViewer artifact={homeArtifact} onClose={() => setHomeArtifact(null)} onAsk={askAboutHomeArtifact} onReport={reportFromHomeArtifact} />}
    </div>
  );
  if (embedded) return <div className="start-pane embedded-start-pane">{contentNode}</div>;
  return <section className="center-pane start-pane">{contentNode}</section>;
}
