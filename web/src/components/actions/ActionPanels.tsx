import React, { useState } from "react";
import { WorkflowAppShell } from "../../features/workflow/components/WorkflowAppShell";
import "./ActionPanels.css";
import type { ArtifactRecord } from "../../shared/contracts/workbench";
import type { ActivePath } from "../../app/router/parseRoute";
import type { ProjectConfigPayload } from "../../shared/api/client";
import type { ChatState } from "../../shared/contracts/runtime";
import { ProjectActionPreview } from "./ProjectActionPreview";
import { ProjectActionRunResult } from "./ProjectActionRunResult";
import {
  actionKindLabel,
  actionOutputLabel,
  actionStatus,
  errorMessage,
  executeLabel,
  previewLabel,
  useProjectActionRuntime,
  workflowAppForCommand,
  type AutomationProject,
  type CommandDefinition,
  type FetchJson,
} from "./projectActionRuntime";

export type { CommandDefinition } from "./projectActionRuntime";

export function AutomationPanel({ projects = [], onAutomations, fetchJson, formatDate }: { projects?: AutomationProject[]; onAutomations?: (items: AutomationProject[]) => void; fetchJson: FetchJson; formatDate: (value?: string) => string }) {
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  async function run(slug: string) {
    setRunning(slug);
    setError("");
    try {
      const payload = await fetchJson(`/api/automations/${slug}/run`, { method: "POST", body: new FormData() });
      onAutomations?.((payload.projects || []) as AutomationProject[]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="runtime-card automation-card">
      <strong>Automation Apps</strong>
      <p>Repeatable local automation run records.</p>
      {projects.length === 0 && <p className="muted">No automation projects registered yet.</p>}
      {projects.map((project) => (
        <div className="automation-run" key={project.slug}>
          <div>
            <b>{project.title}</b>
            <span>{project.kind}</span>
            {project.latest_run && <small>latest: {project.latest_run.status} · {formatDate(project.latest_run.created_at)}</small>}
          </div>
          <button type="button" onClick={() => run(project.slug)} disabled={running === project.slug}>
            {running === project.slug ? "Running..." : "Run now"}
          </button>
        </div>
      ))}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

export function ProjectWorkflowAppsPanel({ activePath, projectConfig, onProjectConfig, power, fetchJson, onOpenArtifact, onRunComplete, activeAppId, navigate }: { activePath: ActivePath; projectConfig?: ProjectConfigPayload | null; onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigPayload | null>>; power?: boolean; fetchJson: FetchJson; onOpenArtifact?: (artifact: ArtifactRecord) => void; onRunComplete?: () => void; activeAppId?: string; navigate?: (path: string) => void }) {
  const { error, preview, result, running, importTemplate, previewCommand, runCommand } = useProjectActionRuntime({
    activePath,
    fetchJson,
    onProjectConfig,
    onRunComplete,
  });
  const config = projectConfig?.config || {};
  const commands = Object.entries((config.commands || {}) as Record<string, CommandDefinition>)
    .filter(([name]) => !activeAppId || name === activeAppId);
  if (!activePath.projectPath) {
    return null;
  }

  return (
    <div className="project-actions-panel">
      {commands.length === 0 ? (
        <div className="empty-actions investment-empty-state">
          <div>
            <span className="status-badge ready">Template</span>
            <strong>Investment Advisor 설치</strong>
            <p className="muted">샘플 포트폴리오와 목표 비중 파일을 넣고, 한 번 실행하면 표/차트/리포트가 바로 생김.</p>
          </div>
          <ol>
            <li>템플릿 설치</li>
            <li>Calculate rebalance deltas 실행</li>
            <li>대시보드에서 월별 자산/수익률 확인</li>
          </ol>
          <button type="button" onClick={importTemplate}>현재 프로젝트에 설치</button>
        </div>
      ) : (
        commands.map(([name, command]) => {
          const app = workflowAppForCommand(name, command);
          const matchingRun = result?.command_id === name || result?.action_id === name
            ? result
            : (projectConfig?.runs || []).find((run) => run.command === name || run.action_id === name) || null;
          const matchingArtifacts = matchingRun?.artifacts || [];
          return (
            <WorkflowAppShell
              key={name}
              app={app}
              running={running === name}
              error={error}
              latestRun={matchingRun}
              onPreview={() => previewCommand(name)}
              onRun={(values) => runCommand(name, { command, values })}
              projectPath={activePath?.projectPath}
              power={power}
              artifacts={matchingArtifacts}
            >
              <div className="action-badges">
                <span>{actionKindLabel(command.kind)}</span>
                <span>{actionOutputLabel(command)}</span>
                <span>{actionStatus(command)}</span>
                {power && <span>{command.permission || "read-only"}</span>}
                {!activeAppId && <button type="button" onClick={() => navigate?.(`/project/${activePath.projectPath}/app/${name}`)}>Open app page</button>}
              </div>
            </WorkflowAppShell>
          );
        })
      )}
      {preview && <ProjectActionPreview preview={preview} />}
      {result && <ProjectActionRunResult result={result} onOpenArtifact={onOpenArtifact} />}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

export function TaskSuggestionsPanel({ activePath, suggestions = [], onProjectConfig, onChat, power, fetchJson }: { activePath: ActivePath; suggestions?: CommandDefinition[]; onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigPayload | null>>; onChat?: (next: (current: ChatState | null) => ChatState) => void; power?: boolean; fetchJson: FetchJson }) {
  const { error, preview, result, running, previewCommand, runCommand } = useProjectActionRuntime({
    activePath,
    fetchJson,
    onProjectConfig,
    onChat,
  });
  if (!activePath.projectPath || suggestions.length === 0) return null;

  return (
    <div className="task-suggestions-panel">
      <div className="suggestion-header">
        <strong>Suggested next steps</strong>
        <span>User approval required</span>
      </div>
      {suggestions.map((item) => (
        <div className="suggestion-card" key={item.command}>
          <div>
            <b>{item.label || item.command}</b>
            <p>{item.description || "A project command that can continue this chat."}</p>
            <span>{actionKindLabel(item.kind)} · {item.permission}</span>
          </div>
          <div className="action-buttons">
            <button type="button" onClick={() => previewCommand(String(item.command || item.id || ""))}>{previewLabel(item.kind)}</button>
            <button type="button" onClick={() => runCommand(String(item.command || item.id || ""), { label: item.label, sessionSlug: activePath.sessionSlug || "", attachMessageToChat: true })} disabled={running === item.command}>
              {running === item.command ? "Running" : executeLabel(item.kind)}
            </button>
          </div>
        </div>
      ))}
      {preview && <ProjectActionPreview preview={preview} compact power={power} />}
      {result && <ProjectActionRunResult result={result} compact currentSession={Boolean(activePath.sessionSlug)} power={power} />}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

export function WorkflowAppInspector({ projectConfig, power }: { projectConfig?: ProjectConfigPayload | null; power?: boolean }) {
  const commands = Object.entries((projectConfig?.config?.commands || {}) as Record<string, CommandDefinition>);
  const runs = projectConfig?.runs || [];
  const command = commands[0]?.[1];
  if (!command) {
    return (
      <div className="action-inspector-card">
        <strong>No Workflow App selected</strong>
        <p className="muted">Import or run a recipe in the main workbench to inspect details here.</p>
      </div>
    );
  }
  const latest = runs[0];
  return (
    <div className="action-inspector-card">
      <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
      <strong>{command.label || "Workflow App"}</strong>
      <p>{command.description || "A Workflow App that uses files, context, and command definitions."}</p>
      <dl>
        <div><dt>Kind</dt><dd>{actionKindLabel(command.kind)}</dd></div>
        <div><dt>Output</dt><dd>{actionOutputLabel(command)}</dd></div>
        {power && <div><dt>Permission</dt><dd>{command.permission || "read-only"}</dd></div>}
        {latest && <div><dt>Latest run</dt><dd>{latest.status} · {latest.label || latest.command}</dd></div>}
      </dl>
      <p className="muted">Run and artifact inspection happens in the central Project Workbench.</p>
    </div>
  );
}

export { actionStatus };
