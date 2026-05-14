import React, { useMemo, useState } from "react";
import { actionStatus, ProjectActionsPanel } from "../actions/ActionPanels.jsx";
import { ArchitectureDiagram } from "./ArchitectureDiagram.jsx";
import { COPY } from "../../copy.js";
import { ACTION_KINDS, AGENT_STEP_KINDS, PANEL_TYPES, normalizeActionDefinition, normalizePanelDefinition } from "../../workbenchContracts.js";

export function ProjectDashboard({ activePath, projectConfig, project, power, fetchJson, onProjectConfig, navigate }) {
  const [runDetail, setRunDetail] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [modalError, setModalError] = useState("");
  const config = projectConfig?.config || {};
  const runs = projectConfig?.runs || [];
  const commands = Object.entries(config.commands || {});
  const actions = commands.map(([name, command]) => normalizeActionDefinition(name, command));
  const panels = (config.panels || []).map(normalizePanelDefinition);
  const context = config.context || {};
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run })));
  const chatInsights = useMemo(() => summarizeProjectChats(project), [project]);

  async function openRun(run) {
    setModalError("");
    try {
      const payload = await fetchJson(`/api/project-run?project=${encodeURIComponent(activePath.projectPath)}&run_id=${encodeURIComponent(run.run_id)}`);
      setRunDetail(payload);
    } catch (err) {
      setModalError(err.message);
    }
  }

  async function openArtifact(item) {
    setModalError("");
    try {
      const payload = await fetchJson(`/api/project-artifact?project=${encodeURIComponent(activePath.projectPath)}&path=${encodeURIComponent(item.path)}`);
      setArtifact(payload.artifact);
    } catch (err) {
      setModalError(err.message);
    }
  }

  return (
    <div className="project-dashboard">
      <div className="project-dashboard-hero">
        <p className="eyebrow">Project Workbench</p>
        <h1>{config.name || project?.title || activePath.projectPath}</h1>
        <p>{config.description || project?.notes || COPY.tagline}</p>
      </div>

      <section className="dashboard-card workbench-operating-model">
        <div>
          <p className="eyebrow">Operating Model</p>
          <h2>Folder to Manifest to Actions to Runs to Artifacts</h2>
          <p className="muted">This project is treated as a configurable workbench, not a chat folder. aiws.yaml decides which files are context, which actions can run, and which panels explain the outputs.</p>
        </div>
        <div className="operating-steps" aria-label="AIWS operating loop">
          {["Project folder", "aiws.yaml", "Action registry", "Run timeline", "Artifacts"].map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <div className="dashboard-grid">
        <ManifestSummaryCard config={config} context={context} panels={panels} actions={actions} runs={runs} />
        <AgentPlanFoundationCard />
      </div>

      <section className="dashboard-card project-chat-overview">
        <div className="section-row">
          <div>
            <p className="eyebrow">Project Memory</p>
            <h2>Project chat history</h2>
          </div>
          <span className="soft-pill">{project?.sessions?.length || 0} chats</span>
        </div>
        <p className="project-chat-summary">{chatInsights.summary}</p>
        {chatInsights.topics.length > 0 && (
          <div className="topic-strip">
            {chatInsights.topics.map((topic) => <span key={topic}>{topic}</span>)}
          </div>
        )}
        {project?.sessions?.length > 0 ? (
          <div className="project-chat-list">
            {project.sessions.map((session) => (
              <button
                type="button"
                key={session.slug}
                className="project-chat-row"
                onClick={() => navigate?.(`/chat/${project.path}/${session.slug}`)}
              >
                <span>{session.title || session.slug}</span>
                <small>{session.created_at?.slice(0, 10) || "date unknown"}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No chats in this project yet. Start a project chat below and it will appear here.</p>
        )}
      </section>

      <section className="dashboard-card dashboard-actions">
        <div className="section-row">
          <div>
            <p className="eyebrow">Actions</p>
            <h2>Project actions</h2>
          </div>
          {power && <span className="soft-pill">aiws.yaml</span>}
        </div>
        <ProjectActionsPanel
          activePath={activePath}
          projectConfig={projectConfig}
          onProjectConfig={onProjectConfig}
          power={power}
          fetchJson={fetchJson}
          onOpenArtifact={openArtifact}
        />
      </section>

      <div className="dashboard-grid">
        <RegistryPreviewCard title="Panel Registry" items={PANEL_TYPES} active={panels.map((panel) => panel.type)} />
        <RegistryPreviewCard title="Action Kinds" items={ACTION_KINDS} active={actions.map((action) => action.kind)} />
      </div>

      <section className="dashboard-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">{COPY.project.recipeStatus}</p>
            <h2>Ready and planned recipes</h2>
          </div>
          <span className="soft-pill">{commands.length}</span>
        </div>
        {commands.length === 0 ? (
          <p className="muted">Import aiws.yaml to show each command as Ready, Partial, Planned, or Broken.</p>
        ) : (
          <div className="recipe-status-grid">
            {commands.map(([name, command]) => (
              <div className="recipe-status-row" key={name}>
                <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
                <strong>{command.label || name}</strong>
                <small>{command.description || name}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-card dashboard-architecture passive-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">Configurable Cockpit</p>
            <h2>AIWS architecture</h2>
          </div>
          <span className="soft-pill">Architecture preview</span>
        </div>
        <p className="muted">This diagram is secondary. Runtime truth should come from real run records, logs, artifacts, and planner events.</p>
        <ArchitectureDiagram />
      </section>

      <section className="dashboard-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">Recent Runs</p>
            <h2>Run history</h2>
          </div>
          <span className="soft-pill">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <p className="muted">No run records yet. Execute a project action to leave logs and artifacts here.</p>
        ) : (
          <div className="run-list">
            {runs.slice(0, 5).map((run) => (
              <button className="run-row clickable-row" type="button" key={run.run_id || `${run.command}-${run.created_at}`} onClick={() => openRun(run)}>
                <strong>{run.label || run.command}</strong>
                <span>{run.status}</span>
                <small>{run.created_at}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">{COPY.project.artifacts}</p>
            <h2>Generated outputs</h2>
          </div>
          <span className="soft-pill">{artifacts.length}</span>
        </div>
        {artifacts.length === 0 ? (
          <p className="muted">Generated reports, data files, and script outputs are inspectable here.</p>
        ) : (
          <div className="artifact-grid">
            {artifacts.slice(0, 8).map((artifact) => (
              <button className="artifact-tile clickable-row" type="button" key={`${artifact.run.run_id}-${artifact.path}`} onClick={() => openArtifact(artifact)}>
                <strong>{artifact.path}</strong>
                <span>{artifact.exists ? `${artifact.size} bytes` : "not found"}</span>
                <small>{artifact.run.label || artifact.run.command}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {modalError && (
        <div className="viewer-modal" role="dialog" aria-modal="true">
          <div className="viewer-card">
            <button type="button" className="viewer-close" onClick={() => setModalError("")}>Close</button>
            <h2>Could not open</h2>
            <p className="error-text">{modalError}</p>
          </div>
        </div>
      )}
      {runDetail && <RunDetailModal detail={runDetail} power={power} onClose={() => setRunDetail(null)} onOpenArtifact={openArtifact} />}
      {artifact && <ArtifactViewer artifact={artifact} onClose={() => setArtifact(null)} />}
    </div>
  );
}

function ManifestSummaryCard({ config, context, panels, actions, runs }) {
  const include = context.include || [];
  const exclude = context.exclude || [];
  const views = config.views || [];
  return (
    <section className="dashboard-card manifest-summary-card">
      <div className="section-row">
        <div>
          <p className="eyebrow">aiws.yaml Manifest</p>
          <h2>Configurable workbench contract</h2>
        </div>
        <span className="soft-pill">{config.name ? "loaded" : "template-ready"}</span>
      </div>
      <div className="manifest-summary-grid">
        <MetricTile label="Actions" value={actions.length} />
        <MetricTile label="Panels" value={panels.length} />
        <MetricTile label="Views" value={views.length} />
        <MetricTile label="Runs" value={runs.length} />
      </div>
      <div className="manifest-section">
        <strong>Context include</strong>
        <p>{include.length ? include.slice(0, 4).join(", ") : "No include patterns yet. Add files/**/*.md, data/**/*.csv, or notes/**/*.txt."}</p>
      </div>
      <div className="manifest-section security">
        <strong>Security exclusions</strong>
        <p>{exclude.length ? exclude.slice(0, 4).join(", ") : ".env, secrets/**, keys/**, browser profiles, and SSH folders stay out of context by policy."}</p>
      </div>
      <pre className="manifest-code">{sampleManifest(config, panels, actions)}</pre>
    </section>
  );
}

function AgentPlanFoundationCard() {
  const steps = [
    ["read_file", "Inspect selected project files", false],
    ["llm", "Create a plan and identify missing context", false],
    ["search", "Search external context when allowed", true],
    ["python", "Run analysis script in a controlled step", true],
    ["report", "Write report artifact and summarize next actions", false],
  ];
  return (
    <section className="dashboard-card agent-plan-card">
      <div className="section-row">
        <div>
          <p className="eyebrow">Agent Plan Foundation</p>
          <h2>Controlled automation, not blind execution</h2>
        </div>
        <span className="soft-pill">experimental</span>
      </div>
      <p className="muted">General chat should evolve into a visible plan: goal, approval gates, step events, costs, artifacts, and final report.</p>
      <div className="agent-step-list">
        {steps.map(([kind, title, approval], index) => (
          <div key={title} className={approval ? "needs-approval" : ""}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
            <small>{AGENT_STEP_KINDS.includes(kind) ? kind : "llm"}{approval ? " · approval required" : ""}</small>
          </div>
        ))}
      </div>
      <p className="warning-text">File writes, shell, Python, and network steps must remain approval-gated.</p>
    </section>
  );
}

function RegistryPreviewCard({ title, items, active }) {
  const activeSet = new Set(active || []);
  return (
    <section className="dashboard-card registry-preview-card">
      <div className="section-row">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>{title}</h2>
        </div>
        <span className="soft-pill">{activeSet.size} active</span>
      </div>
      <div className="registry-chip-grid">
        {items.map((item) => <span key={item} className={activeSet.has(item) ? "active" : ""}>{item}</span>)}
      </div>
    </section>
  );
}

function MetricTile({ label, value }) {
  return (
    <span className="metric-tile">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function sampleManifest(config, panels, actions) {
  const firstAction = actions[0] || { id: "summarize_file", kind: "prompt_recipe", label: "Summarize File" };
  const firstPanel = panels[0] || { id: "files", type: "fileExplorer", title: "Files" };
  return [
    `name: ${config.name || "Project Workbench"}`,
    "views:",
    "  - id: desk",
    "    panels:",
    `      - id: ${firstPanel.id}`,
    `        type: ${firstPanel.type}`,
    `        title: ${firstPanel.title}`,
    "commands:",
    `  ${firstAction.id}:`,
    `    kind: ${firstAction.kind}`,
    `    label: ${firstAction.label}`,
  ].join("\n");
}

function summarizeProjectChats(project) {
  const sessions = project?.sessions || [];
  if (sessions.length === 0) {
    return {
      summary: "No chat history yet. Start a project chat and the workbench will summarize what this project is becoming.",
      topics: [],
    };
  }
  const titles = sessions.map((session) => cleanSessionTitle(session.title || session.slug || "")).filter(Boolean);
  const topics = extractTopics(titles);
  const latest = sessions
    .map((session) => session.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const representative = titles.find((title) => title.length >= 4) || project?.title || "this project";
  const topicText = topics.length > 0
    ? `Main themes appear to be ${topics.slice(0, 4).join(", ")}.`
    : `Representative chat: "${representative}".`;
  return {
    summary: `${sessions.length} chat${sessions.length === 1 ? "" : "s"} connected. ${topicText}${latest ? ` Last update ${latest.slice(0, 10)}.` : ""}`,
    topics,
  };
}

function cleanSessionTitle(value) {
  return String(value || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b\d{1,4}[./:-]\d{1,2}(?:[./:-]\d{1,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b(Kwanho Kim|Chungja Byun|Assistant|User)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopics(titles) {
  const stop = new Set([
    "new", "chat", "test", "title", "project", "pdf", "file", "user", "assistant",
    "kwanho", "kim", "chungja", "byun", "이거", "저거", "그건", "오늘", "내일", "파일", "대화",
    "프로젝트", "작업실", "테스트", "오전", "오후",
  ]);
  const counts = new Map();
  for (const title of titles) {
    for (const token of String(title).toLowerCase().match(/[a-z0-9가-힣]{2,}/g) || []) {
      if (/^\d+$/.test(token)) continue;
      if (/^\d{4}$/.test(token)) continue;
      if (/^\d{2,}$/.test(token)) continue;
      if (stop.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function RunDetailModal({ detail, power, onClose, onOpenArtifact }) {
  const run = detail.run || {};
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Run Detail</p>
        <h2>{run.label || run.command || "Run record"}</h2>
        <div className="run-meta-grid">
          <span>Status: {run.status}</span>
          <span>Kind: {run.kind}</span>
          <span>{run.created_at}</span>
        </div>
        {run.artifacts?.length > 0 && (
          <div className="artifact-list">
            <strong>Artifacts</strong>
            {run.artifacts.map((item) => (
              <button type="button" key={item.path} onClick={() => onOpenArtifact(item)}>
                {item.path} · {item.exists ? `${item.size} bytes` : "not found"}
              </button>
            ))}
          </div>
        )}
        {power && (
          <>
            <h3>stdout</h3>
            <pre>{detail.stdout || "(empty)"}</pre>
            <h3>stderr</h3>
            <pre className={detail.stderr ? "error-text" : ""}>{detail.stderr || "(empty)"}</pre>
            <h3>result.json</h3>
            <pre>{JSON.stringify(detail.result || {}, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function ArtifactViewer({ artifact, onClose }) {
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Artifact Viewer</p>
        <h2>{artifact.path}</h2>
        <span className="soft-pill">{artifact.kind} · {artifact.size} bytes</span>
        <ArtifactContent artifact={artifact} />
      </div>
    </div>
  );
}

function ArtifactContent({ artifact }) {
  const kind = artifact.kind;
  const content = artifact.content || "";
  if (kind === "csv") {
    const rows = content.trim().split(/\r?\n/).slice(0, 60).map((line) => line.split(","));
    return (
      <div className="artifact-table-wrap">
        <table className="artifact-table">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join("|")}`}>
                {row.map((cell, cellIndex) => rowIndex === 0
                  ? <th key={cellIndex}>{cell}</th>
                  : <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
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
  return <pre>{content}</pre>;
}
