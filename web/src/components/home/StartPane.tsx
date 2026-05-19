import React, { type ChangeEvent, useEffect, useState } from "react";
import { Composer } from "../chat/Composer";
import { HomeArtifactContent } from "../table/TableWorkbenchPanel";
import { COPY, copyForAccount } from "../../shared/copy/copy";
import { fetchJson } from "../../lib/api";
import { ArtifactCard, ProjectCard, RunCard, SessionCard, StatPill } from "../work-objects/WorkObjectCards";
import {
  MODEL_MODES,
  normalizeModelCatalog,
} from "../../lib/modelModes";
import type { AccountLike, ChatUpdater, HomeAction, HomePayload, RunDetail } from "../../shared/contracts/runtime";
import type { ArtifactRecord, ModelCatalogItem, RunRecord } from "../../shared/contracts/workbench";
import type { WorkspaceSummary } from "../../entities/workspace/types";

export const STARTER_ACTIONS: HomeAction[] = [
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
];

function isPowerMode(account?: AccountLike) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

function closeLabel(copy: typeof COPY) {
  const maybeCommon = "common" in copy ? (copy as { common?: { close?: string } }).common : undefined;
  return maybeCommon?.close || "닫기";
}

export function StarterActionsGrid({ actions, onStart, running = "", hasFile = false, copy = COPY }: {
  actions?: HomeAction[];
  onStart?: (action: HomeAction) => void;
  running?: string;
  hasFile?: boolean;
  copy?: typeof COPY;
}) {
  const allowedToolIds = new Set(STARTER_ACTIONS.map((action) => action.id));
  const sourceActions = actions?.length
    ? actions.filter((action) => allowedToolIds.has(action.id) && (action.resource_type || action.tool_type) === "chat_tool")
    : STARTER_ACTIONS;
  const items: HomeAction[] = sourceActions.map((action: HomeAction) => ({
    ...STARTER_ACTIONS.find((starter) => starter.id === action.id),
    ...action,
    label: action.label || action.title,
    inputs: Array.isArray(action.inputs) ? action.inputs.join(" · ") : action.inputs,
    output: Array.isArray(action.expected_output_artifacts) ? action.expected_output_artifacts.join(" · ") : action.output,
    disabled: String(action.status).toLowerCase() === "planned",
    wantsFile: Array.isArray(action.inputs) && action.inputs.some((item) => String(item).startsWith(".")),
    wantsBrief: action.id === "codex_task_prompt",
  }));
  const localizedItems = items.map((action: HomeAction) => localizeStarterAction(action, copy));
  const actionState = (action: HomeAction) => {
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

export function ToolRunPanel({ action, running, onClose, onRun, copy = COPY }: {
  action: HomeAction | null;
  running: string;
  onClose: () => void;
  onRun: (action: HomeAction, options: { files: File[]; content: string }) => void | Promise<void>;
  copy?: typeof COPY;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const inputId = `home-tool-file-${action?.id || "tool"}`;
  if (!action) return null;
  const localized = localizeStarterAction(action, copy);
  const canRun = !localized.wantsFile || files.length > 0;

  function addFiles(nextFiles?: FileList | File[] | null) {
    const next = Array.from(nextFiles || []);
    setFiles((current) => [...current, ...next]);
  }

  function removeFile(index: number) {
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
        <button type="button" onClick={onClose}>{closeLabel(copy)}</button>
      </div>
      <p>{localized.inputs} → {localized.output || "answer"}</p>
      <div className="tool-run-drop">
        <input
          id={inputId}
          type="file"
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}
          accept=".txt,.md,.csv,.xls,.xlsx,.json,.yaml,.yml,.pdf,.docx,.ppt,.pptx,image/png,image/jpeg,image/gif,image/webp"
        />
        <label htmlFor={inputId}>{files.length ? "파일 더 추가" : "파일 선택 / 끌어놓기"}</label>
        {files.length > 0 && (
          <div className="tool-run-files">
            {files.map((file: File, index: number) => (
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

function localizeStarterAction(action: HomeAction, copy: typeof COPY): HomeAction {
  const localized = (copy.starterActions as Record<string, Partial<HomeAction>> | undefined)?.[action.id];
  return localized ? { ...action, ...localized } : action;
}

function HomeRunDetailModal({ detail, power, onClose, onOpenArtifact }: {
  detail: RunDetail & { run?: RunRecord & { execution_plan?: Record<string, unknown>; logs?: Array<Record<string, unknown>>; errors?: string[] } };
  power: boolean;
  onClose: () => void;
  onOpenArtifact?: (artifact: ArtifactRecord) => void | Promise<void>;
}) {
  type HomeRunStep = { id?: string; type?: string; output?: string; status?: string };
  type HomeRunLog = { kind?: string; type?: string; content?: string; message?: string };
  const run = (detail.run || {}) as RunRecord & { execution_plan?: { steps?: HomeRunStep[] }; logs?: HomeRunLog[]; errors?: string[]; artifacts?: ArtifactRecord[] };
  const plan = run.execution_plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Work Detail</p>
        <h2>{run.label || run.action_id || "Workbench output"}</h2>
        <div className="run-meta-grid"><span>Status: {run.status}</span><span>Tool/App: {run.action_id}</span><span>{run.created_at}</span></div>
        {(run.artifacts || []).length > 0 && <div className="artifact-list"><strong>Artifacts</strong>{(run.artifacts || []).map((item) => <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>{item.path.split("/").pop()} · {item.viewer_type}</button>)}</div>}
        {steps.length > 0 && <div className="run-step-list"><strong>Steps</strong>{steps.map((step: HomeRunStep) => <span key={step.id || step.type}><b>{step.id || step.type}</b><small>{step.output || step.status || "done"}</small></span>)}</div>}
        <details className="run-log-details" open={power}>
          <summary>Logs</summary>
          <pre>{(run.logs || (detail.logs as HomeRunLog[] | undefined) || []).map((item: HomeRunLog) => `[${item.kind || item.type || "log"}] ${item.content || item.message || ""}`).join("\n") || "(empty)"}</pre>
          {(run.errors || []).length > 0 && <pre className="error-text">{(run.errors || []).join("\n")}</pre>}
        </details>
        {power && <details className="run-log-details"><summary>Raw plan</summary><pre>{JSON.stringify(plan, null, 2)}</pre></details>}
      </div>
    </div>
  );
}

function HomeArtifactViewer({ artifact, onClose, onAsk, onReport }: {
  artifact: ArtifactRecord & { content?: string };
  onClose: () => void;
  onAsk?: (artifact: ArtifactRecord) => void | Promise<void>;
  onReport?: (artifact: ArtifactRecord) => void | Promise<void>;
}) {
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

export function StartPane({ error, navigate, refreshWorkspace, onAsk, account, models = MODEL_MODES, projectPath = "", embedded = false, workspace, home, onHome }: {
  error?: string;
  navigate: (path: string) => void;
  refreshWorkspace?: () => void | Promise<void>;
  onAsk: (payload: ChatUpdater) => void | Promise<void>;
  account?: AccountLike;
  models?: ModelCatalogItem[];
  projectPath?: string;
  embedded?: boolean;
  workspace?: WorkspaceSummary | null;
  home?: HomePayload | null;
  onHome?: (home: HomePayload) => void;
  refreshHome?: () => void | Promise<void>;
}) {
  const [homeRunning, setHomeRunning] = useState("");
  const [homeRunDetail, setHomeRunDetail] = useState<RunDetail | null>(null);
  const [homeArtifact, setHomeArtifact] = useState<(ArtifactRecord & { content?: string }) | null>(null);
  const [homeError, setHomeError] = useState("");
  const [composerDraft, setComposerDraft] = useState("");
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [composerAttachmentSignal] = useState(0);
  const [toolPanelAction, setToolPanelAction] = useState<HomeAction | null>(null);
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
      setToolPanelAction(action);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [copy, isHomeWorkbench]);

  function clearFile() {
    // Shared Composer owns home chat attachments.
  }

  async function runHomeAction(action: HomeAction, options: { files?: File[]; content?: string } = {}) {
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
      const payload = await fetchJson<{ home: HomePayload; run: RunRecord & { artifacts?: ArtifactRecord[] } }>(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact) await askAboutHomeArtifact(firstArtifact);
      else setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
      clearFile();
      setToolPanelAction(null);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : "Could not run Chat Tool.");
    } finally {
      setHomeRunning("");
    }
  }

  async function openHomeArtifact(item: ArtifactRecord) {
    setHomeError("");
    try {
      const payload = await fetchJson<{ artifact: ArtifactRecord & { content?: string } }>(`/api/home-artifact?path=${encodeURIComponent(item.path)}`);
      setHomeArtifact(payload.artifact);
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : String(err));
    }
  }

  async function askAboutHomeArtifact(artifact: ArtifactRecord) {
    const payload = await fetchJson<{ project_path: string; session: { slug: string } }>("/api/home-artifact/ask", { method: "POST", body: new URLSearchParams({ path: artifact.path }) });
    refreshWorkspace?.();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  async function reportFromHomeArtifact(artifact: ArtifactRecord) {
    setHomeError("");
    try {
      const payload = await fetchJson<{ home: HomePayload; run: RunRecord }>("/api/home-artifact/report", { method: "POST", body: new URLSearchParams({ path: artifact.path }) });
      onHome?.(payload.home);
      setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startNewChat() {
    const payload = await fetchJson<{ project_path: string; session: { slug: string } }>("/api/chats", {
      method: "POST",
      body: new URLSearchParams({ title: "" }),
    });
    refreshWorkspace?.();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  const recentArtifacts = (home?.runs || [])
    .flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run })))
    .slice(0, 4);
  const recentRuns = (home?.runs || []).slice(0, 4);
  const recentSessions = (workspace?.chats || [])
    .flatMap((project) => (project.sessions || []).map((session) => ({ ...session, projectPath: project.path, projectTitle: project.title })))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, 4);
  const activeProjects = (workspace?.projects || []).filter((project) => !project.hidden).slice(0, 4);

  const contentNode = (
    <div className={`start-content ${isHomeWorkbench ? "home-workbench" : ""}`}>
      {!isHomeWorkbench && <div className="home-hero"><h1>{copy.chat.emptyTitle}</h1></div>}
      {!isHomeWorkbench && (
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
      )}
      {isHomeWorkbench ? (
        <>
          <section className="home-cockpit-header" aria-label="Workbench summary">
            <div>
              <p className="eyebrow">Private workflow desk</p>
              <h1>Traceable local AI workbench</h1>
              <p>Projects, chats, runs, artifacts, context receipts, and model usage stay connected.</p>
            </div>
            <div className="work-stat-row">
              <StatPill label="projects" value={workspace?.projects?.length || 0} />
              <StatPill label="recent runs" value={home?.runs?.length || 0} />
              <StatPill label="outputs" value={recentArtifacts.length} />
            </div>
          </section>
          <section className="home-launch-panel" aria-label="AIWS home launcher">
            <button type="button" className="home-launch-primary" aria-label="새 대화 시작" onClick={startNewChat}>
              <strong>Chat</strong>
              <span>질문은 전용 채팅 화면에서 입력함.</span>
            </button>
            <button type="button" onClick={() => window.dispatchEvent(new Event("aiws:new-project"))}>
              <strong>New project</strong>
              <span>파일, Workflow App, 산출물을 한 곳에 묶음.</span>
            </button>
            <button type="button" onClick={() => navigate("/apps-tools")}>
              <strong>Workflow Apps</strong>
              <span>도구와 반복 앱을 고름.</span>
            </button>
          </section>
          <section className="home-object-board" aria-label="Recent work objects">
            <div className="home-object-lane">
              <div className="section-row"><h2>Continue work</h2><button type="button" onClick={() => navigate("/projects")}>All projects</button></div>
              <div className="work-object-grid">
                {activeProjects.length ? activeProjects.map((project) => <ProjectCard key={project.path} project={project} onOpen={navigate} />) : <p className="muted">No projects yet. Create one to bind files, actions, and outputs.</p>}
              </div>
            </div>
            <div className="home-object-lane">
              <div className="section-row"><h2>Recent sessions</h2><button type="button" onClick={() => startNewChat()}>New chat</button></div>
              <div className="work-object-grid">
                {recentSessions.length ? recentSessions.map((session) => <SessionCard key={`${session.projectPath}-${session.slug}`} session={session} onOpen={navigate} />) : <p className="muted">No chats yet. Start with a question or attach a file.</p>}
              </div>
            </div>
            <div className="home-object-lane">
              <div className="section-row"><h2>Recent runs</h2><button type="button" onClick={() => navigate("/runs")}>All runs</button></div>
              <div className="work-object-grid">
                {recentRuns.length ? recentRuns.map((run) => <RunCard key={run.run_id || String(run.created_at)} run={run} onOpen={(item) => setHomeRunDetail({ run: item, result: { run: item }, stdout: "", stderr: "" })} />) : <p className="muted">No runs yet. Run a Workflow App or create an output.</p>}
              </div>
            </div>
            <div className="home-object-lane">
              <div className="section-row"><h2>Recent artifacts</h2><button type="button" onClick={() => navigate("/artifacts")}>All outputs</button></div>
              <div className="work-object-grid">
                {recentArtifacts.length ? recentArtifacts.map((artifact) => <ArtifactCard key={`${artifact.run.run_id}-${artifact.path}`} artifact={artifact} onOpen={openHomeArtifact} />) : <p className="muted">No durable outputs yet. Save reports, CSV profiles, and generated prompts here.</p>}
              </div>
            </div>
          </section>
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
