import React, { type FormEvent, useState } from "react";
import { WorkflowAppInspector, AutomationPanel } from "../actions/ActionPanels";
import { AttachmentList } from "../chat/AttachmentList";
import { ContextReceiptCard } from "../chat/ContextReceiptCard";
import { ChatDock } from "../../features/workflow/components/ChatDock";
import { COPY, copyForAccount, copyForLocale } from "../../shared/copy/copy";
import { fetchJson } from "../../lib/api";
import type { AccountSummary } from "../../entities/workspace/types";
import type { ChatMessage, AttachmentMeta, ArtifactRecord, ContextReceipt, RunRecord } from "../../shared/contracts/workbench";
import type { ActivePath, AutomationProject, ChatState, OpenClawPayload, ProjectConfigState, RuntimePayload } from "../../shared/contracts/runtime";

function isPowerMode(account?: AccountSummary) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

type ContextPanelProps = {
  chat: ChatState | null;
  activePath: ActivePath;
  runtime: RuntimePayload | null;
  openclaw: OpenClawPayload | null;
  automations?: AutomationProject[];
  projectConfig: ProjectConfigState;
  onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigState>>;
  onAutomations?: (items: AutomationProject[]) => void;
  onPreview?: (attachment: unknown) => void;
  onChat?: (next: ChatState | ((current: ChatState | null) => ChatState)) => void;
  account?: AccountSummary;
  onOpenRun?: (run: RunRecord) => void | Promise<void>;
  onOpenArtifact?: (artifact: ArtifactRecord) => void | Promise<void>;
};

export function ContextPanel({ chat, activePath, runtime, openclaw, automations = [], projectConfig, onAutomations, onPreview, onChat, account, onOpenRun, onOpenArtifact }: ContextPanelProps) {
  const power = isPowerMode(account);
  const operator = power && Boolean(account?.admin);
  const diagnosticsVisible = operator && runtime?.diagnostics_visible !== false;
  const copy = copyForAccount(account);
  const tabs = diagnosticsVisible ? ["context", "files", "memory", "runs", "artifacts", "diagnostics"] : power ? ["context", "files", "memory", "runs", "artifacts"] : ["context"];
  const [tab, setTab] = useState("context");
  const currentTab = tabs.includes(tab) ? tab : "context";
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
        <h2>{power ? copy.inspector.powerTitle : copy.inspector.title}</h2>
        <section>
          <h3>{copy.inspector.currentContext}</h3>
          <p className="muted">{copy.inspector.emptyPurpose}</p>
        </section>
        <WorkflowAppInspector projectConfig={projectConfig} power={power} />
        {diagnosticsVisible && <RuntimePanel runtime={runtime} />}
        {diagnosticsVisible && <OpenClawPanel openclaw={openclaw} />}
        {diagnosticsVisible && <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />}
      </aside>
    );
  }
  const attachments = collectVisibleAttachments(chat);
  const runs: RunRecord[] = projectConfig?.runs || [];
  const artifacts = runs.flatMap((run: RunRecord) => (run.artifacts || []).map((artifact: ArtifactRecord) => ({ ...artifact, run })));
  const latestReceipt = latestContextReceipt(chat);
  const manifest = chat?.context_manifest || {};
  const manifestChunks = Array.isArray(manifest.included_chunks) ? manifest.included_chunks : [];
  const manifestExcluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  return (
    <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
      <h2>{power ? copy.inspector.powerTitle : copy.inspector.title}</h2>
      <section className="context-summary">
        <h3>{copy.inspector.currentContext}</h3>
        <p><strong>{chat?.project?.hidden ? "General chat" : chat?.project?.title || activePath.projectPath}</strong></p>
        {power && <p className="muted">{activePath.projectPath} / {activePath.sessionSlug}</p>}
        <div className="skill-stack">{(chat?.skills || []).map((skill: string) => <span key={skill}>{skill}</span>)}</div>
        <div className="inspector-fact-grid">
          <span><strong>{latestReceipt?.included_chunks?.length || manifestChunks.length || 0}</strong>{copy.inspector.factChunks}</span>
          <span><strong>{attachments.length}</strong>{copy.inspector.factFiles}</span>
          <span><strong>{runs.length}</strong>{copy.inspector.factRuns}</span>
          <span><strong>{artifacts.length}</strong>{copy.inspector.factArtifacts}</span>
        </div>
      </section>
      <ContextManifestCard manifest={chat?.context_manifest} power={power} />
      <SessionControlPanel chat={chat} attachments={attachments} latestReceipt={latestReceipt} artifacts={artifacts} power={power} copy={copy} />
      <div className="context-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item} type="button" className={currentTab === item ? "active" : ""} onClick={() => setTab(item)}>
            {(copy.inspector.tabs as Record<string, string>)[item]}
          </button>
        ))}
      </div>
      {currentTab === "context" && (
        <section>
          <h3>{latestReceipt ? "Latest context receipt" : "What will be sent"}</h3>
          {latestReceipt ? <ContextReceiptCard receipt={latestReceipt} /> : <p className="muted">Send a message to create a receipt showing files, privacy mode, model, exclusions, and estimated cost.</p>}
          {chat?.project?.hidden && <PromoteChatCard chat={chat} activePath={activePath} copy={copy} />}
          <WorkSessionCard workSession={chat?.work_session} copy={copy} />
          <WorkflowAppInspector projectConfig={projectConfig} power={power} />
          <ChatDock
            projectPath={activePath.projectPath}
            context={{
              kind: artifacts[0] ? "artifact" : "resource",
              label: artifacts[0]?.path || "Current project context",
              path: artifacts[0]?.path,
              resourceType: artifacts[0] ? undefined : "project_context",
            }}
            account={account}
            power={power}
          />
          <GoalPanel chat={chat} activePath={activePath} onChat={onChat} power={power} />
        </section>
      )}
      {currentTab === "files" && (
        <section>
          <h3>Active files</h3>
          {attachments.length === 0 ? <div className="empty-action-state"><p className="muted">No files are attached to this chat yet.</p><span>Attach file from the composer or start from file on Home.</span></div> : <AttachmentList attachments={attachments} onPreview={onPreview} />}
          {manifestChunks.length > 0 && (
            <div className="manifest-file-facts">
              <strong>{copy.inspector.includedChunks}</strong>
              {manifestChunks.slice(0, 5).map((chunk: Record<string, unknown>) => <span key={String(chunk.chunk_id || chunk.path)}>{String(chunk.filename || chunk.path || "")}<small>{String(chunk.reason || "")} · {String(chunk.privacy || "")}</small></span>)}
            </div>
          )}
          {power && manifestExcluded.length > 0 && (
            <details className="manifest-exclusions">
              <summary>{manifestExcluded.length} exclusions</summary>
              {manifestExcluded.slice(0, 8).map((item: Record<string, unknown>, index: number) => <span key={`${String(item.path || item.pattern)}-${index}`}>{String(item.path || item.pattern || "")}<small>{String(item.reason || "")}</small></span>)}
            </details>
          )}
        </section>
      )}
      {currentTab === "memory" && <section><h3>Workspace memory</h3><div className="empty-action-state"><p className="muted">Coming later: editable project memory and chat summaries.</p><span>Today AIWS uses explicit project goals, attached files, aiws.yaml context, and receipt records instead of hidden memory.</span></div></section>}
      {currentTab === "runs" && (
        <section>
          <h3>{copy.inspector.tabs.runs}</h3>
          {runs.length === 0 ? <div className="empty-action-state"><p className="muted">No project runs yet.</p><span>Run an aiws.yaml action to create logs and artifacts.</span></div> : (
            <div className="compact-list">
              {runs.slice(0, 6).map((run: RunRecord) => <button type="button" className="compact-row-button" key={run.run_id || `${run.command}-${run.created_at}`} onClick={() => onOpenRun?.(run)}><strong>{run.label || run.command}</strong><small>{run.status} · {run.created_at}</small></button>)}
            </div>
          )}
        </section>
      )}
      {currentTab === "artifacts" && (
        <section>
          <h3>{copy.inspector.tabs.artifacts}</h3>
          {artifacts.length === 0 ? <div className="empty-action-state"><p className="muted">No artifacts yet.</p><span>Run an action to generate shareable files.</span></div> : (
            <div className="compact-list">
              {artifacts.slice(0, 8).map((artifact: ArtifactRecord & { run: RunRecord }) => <button type="button" className="compact-row-button" key={`${artifact.run.run_id}-${artifact.path}`} onClick={() => onOpenArtifact?.(artifact)}><strong>{artifact.path}</strong><small>{artifact.exists ? `${artifact.size} bytes` : "not found"} · {artifact.run.label || artifact.run.command}</small></button>)}
            </div>
          )}
        </section>
      )}
      {diagnosticsVisible && currentTab === "diagnostics" && (
        <section>
          <h3>{copy.inspector.tabs.diagnostics}</h3>
          <RuntimePanel runtime={runtime} />
          <OpenClawPanel openclaw={openclaw} />
          <div className="runtime-card diagnostics-link-card">
            <strong>Local Diagnostics</strong>
            <p>Open the protected local dashboard for model failures, logs, tunnel status, and structured health checks.</p>
            <a href="http://127.0.0.1:8790" target="_blank" rel="noreferrer">Open diagnostics dashboard</a>
            <code>scripts/aiws-admin-dashboard.sh</code>
          </div>
          <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />
          <a href={`/prompt/${activePath.projectPath}/${activePath.sessionSlug}`}>Open prompt context</a>
          <code>aiws prompt {activePath.projectPath} {activePath.sessionSlug} --root ~/.ai-workspace</code>
        </section>
      )}
    </aside>
  );
}

type WorkSessionRecord = {
  type?: string;
  status?: string;
  model_calls?: unknown[];
  artifacts?: unknown[];
  next_actions?: Array<{ id?: string; label?: string }>;
};
type ManifestRecord = {
  included?: Array<Record<string, unknown>>;
  excluded?: Array<Record<string, unknown>>;
  estimates?: { input_tokens?: number; estimated_cost?: number | null };
  privacy_mode?: string;
};

function PromoteChatCard({ chat, activePath, copy = COPY }: { chat: ChatState | null; activePath: ActivePath; copy?: typeof COPY }) {
  const [busy, setBusy] = useState(false);
  async function promote() {
    setBusy(true);
    try {
      const title = chat?.session?.title || copy.inspector.promoteTitle;
      const payload = await fetchJson<{ project_path: string; session: { slug: string } }>(`/api/promote-chat/${activePath.projectPath}/${activePath.sessionSlug}`, { method: "POST", body: new URLSearchParams({ title }) });
      window.location.href = `/chat/${payload.project_path}/${payload.session.slug}`;
    } finally {
      setBusy(false);
    }
  }
  return <div className="empty-action-state"><p><strong>{copy.inspector.promoteTitle}</strong></p><span>{copy.inspector.promoteBody}</span><button type="button" onClick={promote} disabled={busy}>{busy ? copy.inspector.promoting : copy.inspector.promote}</button></div>;
}

function SessionControlPanel({ chat, attachments, latestReceipt, artifacts, power, copy = COPY }: {
  chat: ChatState | null;
  attachments: AttachmentMeta[];
  latestReceipt: ContextReceipt | null;
  artifacts: Array<ArtifactRecord & { run: RunRecord }>;
  power: boolean;
  copy?: typeof COPY;
}) {
  const workSession = (chat?.work_session || {}) as WorkSessionRecord;
  const taskType = workSession.type || (attachments.length ? "file_analysis" : "ask_once");
  const privacy = latestReceipt?.privacy_mode || chat?.context_manifest?.privacy_mode || "local";
  const nextActions = workSession.next_actions || [];
  return (
    <section className="session-control-panel">
      <div className="section-row"><div><p className="eyebrow">{copy.inspector.currentTask}</p><h3>{taskType.replaceAll("_", " ")} · {workSession.status || "draft"}</h3></div><span className="soft-pill">{privacy === "local" ? copy.inspector.local : copy.inspector.cloud}</span></div>
      <div className="inspector-fact-grid">
        <span><strong>{attachments.length}</strong>{copy.inspector.files}</span>
        <span><strong>{artifacts.length}</strong>artifacts</span>
        <span><strong>{latestReceipt ? 1 : 0}</strong>{copy.inspector.receipts}</span>
        <span><strong>{(workSession.model_calls || []).length}</strong>{copy.inspector.calls}</span>
      </div>
      <div className="next-action-list">
        {(nextActions.length ? nextActions : [
          { id: "attach", label: attachments.length ? copy.inspector.runAction : copy.inspector.attachOrPaste },
          { id: "save", label: latestReceipt ? copy.inspector.saveUsefulAnswer : copy.inspector.sendToCreateReceipt },
        ]).slice(0, power ? 5 : 3).map((item: { id?: string; label?: string }) => <span key={item.id || item.label}>{item.label}</span>)}
      </div>
    </section>
  );
}

function WorkSessionCard({ workSession, copy = COPY }: { workSession?: WorkSessionRecord | Record<string, unknown>; copy?: typeof COPY }) {
  if (!workSession) return null;
  const session = workSession as WorkSessionRecord;
  return <div className="manifest-file-facts"><strong>{copy.inspector.workSession}</strong><span>{session.type} · {session.status}</span><span>{(session.model_calls || []).length} model calls · {(session.artifacts || []).length} artifacts</span>{(session.next_actions || []).slice(0, 3).map((item: { id?: string; label?: string }) => <span key={item.id || item.label}><small>{item.label}</small></span>)}</div>;
}

function ContextManifestCard({ manifest, power }: { manifest?: ManifestRecord | Record<string, unknown>; power: boolean }) {
  if (!manifest) return null;
  const typedManifest = manifest as ManifestRecord;
  const included = typedManifest.included || [];
  const excluded = typedManifest.excluded || [];
  const estimates = typedManifest.estimates || {};
  return (
    <section className="manifest-card">
      <h3>Context Manifest</h3>
      {included.length === 0 ? <p className="muted">This chat has little additional context.</p> : <div className="manifest-list">{included.map((item: Record<string, unknown>, index: number) => <span key={`${String(item.type)}-${index}`}>{manifestLabel(item)}</span>)}</div>}
      {power && <div className="manifest-details"><small>{estimates.input_tokens || 0} estimated tokens</small>{estimates.estimated_cost !== null && estimates.estimated_cost !== undefined && <small>~USD {estimates.estimated_cost}</small>}<small>{typedManifest.privacy_mode === "local" ? "local-only" : "cloud allowed"}</small></div>}
      {power && excluded.length > 0 && <p className="muted">{excluded.length} security exclusion patterns are active.</p>}
    </section>
  );
}

function manifestLabel(item: Record<string, unknown>) {
  if (item.type === "goal") return `Goal: ${item.label}`;
  if (item.type === "skills") return `${item.count} skills`;
  if (item.type === "chat_files") return `${item.count} chat files`;
  if (item.type === "project_files") return `${item.count} project files`;
  if (item.type === "recent_runs") return `${item.count} recent runs`;
  return String(item.label || item.type || "context");
}

function OpenClawPanel({ openclaw }: { openclaw: OpenClawPayload | null }) {
  const gateway = openclaw?.gateway?.summary || {};
  const sessionCount = openclaw?.sessions?.count ?? openclaw?.sessions?.totalCount ?? 0;
  const dashboard = typeof gateway.dashboard === "string" ? gateway.dashboard : "";
  return <div className="runtime-card openclaw-card"><strong>OpenClaw</strong><p>{openclaw?.installed ? openclaw.version || "installed" : "not installed"}</p><p>gateway: {String(gateway.connectivity_probe || gateway.runtime || "unknown")}</p><p>sessions: {sessionCount}</p>{dashboard && <a href={dashboard} target="_blank" rel="noreferrer">{dashboard}</a>}<code>openclaw gateway status</code></div>;
}

function collectVisibleAttachments(chat: ChatState | null): AttachmentMeta[] {
  const seen = new Set();
  const items: AttachmentMeta[] = [];
  function add(item: AttachmentMeta | undefined) {
    if (!item || !item.filename) return;
    const key = item.url || item.filename;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }
  (chat?.attachments || []).forEach(add);
  (chat?.messages || []).forEach((message: ChatMessage) => (message.attachments || []).forEach(add));
  return items;
}

function latestContextReceipt(chat: ChatState | null): ContextReceipt | null {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.context_receipt) return messages[index].context_receipt || null;
  }
  return null;
}

function GoalPanel({ chat, activePath, onChat, power = false }: {
  chat: ChatState | null;
  activePath: ActivePath;
  onChat?: (next: ChatState | ((current: ChatState | null) => ChatState)) => void;
  power?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const goal = chat?.goal || {};
  const codexPrompt = chat?.codex_prompt || "";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = await fetchJson<{ goal: Record<string, unknown>; codex_prompt: string }>(`/api/goal/${activePath.projectPath}`, { method: "POST", body: form });
      onChat?.((current: ChatState | null) => ({ ...(current || {}), goal: payload.goal, codex_prompt: payload.codex_prompt }));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  async function copyPrompt() {
    await navigator.clipboard?.writeText(codexPrompt);
  }
  async function copyVariant(kind: "full" | "task" | "ui" | "bugfix" | "test") {
    const prefix = {
      full: "Use the full project context and goal below.",
      task: "Focus only on the next concrete implementation task.",
      ui: "Focus on UI/UX refinement while preserving backend behavior.",
      bugfix: "Find and fix the most likely bug with minimal changes.",
      test: "Strengthen or repair tests first, then implement only what is needed.",
    }[kind];
    await navigator.clipboard?.writeText(`${prefix}\n\n${codexPrompt}`);
  }
  if (editing) {
    return (
      <form className="goal-form" data-goal-panel onSubmit={save}>
        <textarea name="objective" defaultValue={String(goal.objective || "")} placeholder="Objective" />
        <textarea name="current_status" defaultValue={String(goal.current_status || "")} placeholder="Current status" />
        <textarea name="next_actions" defaultValue={(Array.isArray(goal.next_actions) ? goal.next_actions : []).join("\n")} placeholder="Next actions, one per line" />
        <textarea name="constraints" defaultValue={(Array.isArray(goal.constraints) ? goal.constraints : []).join("\n")} placeholder="Constraints, one per line" />
        <textarea name="success_criteria" defaultValue={(Array.isArray(goal.success_criteria) ? goal.success_criteria : []).join("\n")} placeholder="Success criteria, one per line" />
        <textarea name="test_commands" defaultValue={(Array.isArray(goal.test_commands) ? goal.test_commands : []).join("\n")} placeholder="Test commands, one per line" />
        <div className="goal-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Goal"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form>
    );
  }
  return (
    <div className="goal-panel" data-goal-panel>
      <strong>{String(goal.objective || "No goal set yet.")}</strong>
      {Boolean(goal.current_status) && <p>{String(goal.current_status)}</p>}
      {(Array.isArray(goal.next_actions) ? goal.next_actions : []).length > 0 && <ul>{(Array.isArray(goal.next_actions) ? goal.next_actions : []).slice(0, 4).map((item: string) => <li key={item}>{item}</li>)}</ul>}
      <div className="goal-actions">
        <button type="button" data-edit-goal onClick={() => setEditing(true)}>{goal.objective ? "Edit goal" : "Set goal"}</button>
        {power && <button type="button" data-copy-codex-prompt onClick={copyPrompt} disabled={!codexPrompt}>Copy full project prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("task")} disabled={!codexPrompt}>Copy task prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("ui")} disabled={!codexPrompt}>Copy UI refinement prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("bugfix")} disabled={!codexPrompt}>Copy bugfix prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("test")} disabled={!codexPrompt}>Copy test prompt</button>}
      </div>
    </div>
  );
}

function RuntimePanel({ runtime }: { runtime: RuntimePayload | null }) {
  const url = runtime?.cloudflare_url || "";
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  return <div className="runtime-card"><strong>Runtime</strong><p>{runtime?.status || "local"}</p>{url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span className="muted">No public tunnel URL.</span>}{url && <p className="warning-text">{copy.inspector.diagnosticsWarning}</p>}</div>;
}
