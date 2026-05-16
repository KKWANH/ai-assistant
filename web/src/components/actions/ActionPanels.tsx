import React, { useState } from "react";
import { WorkflowAppShell } from "../../features/workflow/components/WorkflowAppShell";
import type { ArtifactRecord, RunRecord } from "../../shared/contracts/workbench";
import type { WorkflowAppDefinition } from "../../entities/workflow-app/types";
import type { ActivePath } from "../../app/router/parseRoute";

// Legacy project-action payloads are arbitrary JSON until the backend contract parser lands.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonMap = Record<string, any>;
type FetchJson = (path: string, options?: RequestInit) => Promise<JsonMap>;
type AutomationProject = { slug: string; title: string; kind: string; latest_run?: { status?: string; created_at?: string } };
type CommandDefinition = JsonMap & { workflow_app?: WorkflowAppDefinition; outputs?: string[]; inputs?: unknown[]; input?: unknown[] };
type ProjectConfigPayload = { config?: { commands?: Record<string, CommandDefinition> }; runs?: RunRecord[] };
type PreviewRecord = JsonMap;
type ActionRunRecord = RunRecord & JsonMap & { run_dir?: string; stdout?: string; stderr?: string; artifacts?: ArtifactRecord[] };
type KindKey = "prompt_recipe" | "shell" | "python" | "file_index" | "codex_prompt" | "openclaw_status";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Request failed.");
}

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

export function ProjectWorkflowAppsPanel({ activePath, projectConfig, onProjectConfig, power, fetchJson, onOpenArtifact }: { activePath: ActivePath; projectConfig?: ProjectConfigPayload | null; onProjectConfig?: (next: ProjectConfigPayload | ((current: ProjectConfigPayload | null) => ProjectConfigPayload)) => void; power?: boolean; fetchJson: FetchJson; onOpenArtifact?: (artifact: ArtifactRecord) => void }) {
  const [running, setRunning] = useState("");
  const [result, setResult] = useState<ActionRunRecord | null>(null);
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [error, setError] = useState("");
  const config = projectConfig?.config || {};
  const commands = Object.entries((config.commands || {}) as Record<string, CommandDefinition>);
  if (!activePath.projectPath) {
    return null;
  }

  async function importTemplate() {
    setError("");
    const payload = await fetchJson(`/api/project-config/${activePath.projectPath}/import`, {
      method: "POST",
      body: new URLSearchParams({ template: "investment-advisor" }),
    });
    onProjectConfig?.({ config: payload.config as ProjectConfigPayload["config"], runs: [] });
  }

  async function previewCommand(name: string) {
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      setPreview(payload.preview as PreviewRecord);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runCommand(name: string, command: CommandDefinition) {
    setRunning(name);
    setError("");
    setResult(null);
    try {
      const preview = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      const confirmRun = !preview.preview.requires_confirmation || globalThis.confirm(`Run ${command.label || name}?`);
      if (!confirmRun) return;
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/run`, {
        method: "POST",
        body: new URLSearchParams({ confirm: preview.preview.requires_confirmation ? "1" : "0" }),
      });
      setResult(payload.run as ActionRunRecord);
      onProjectConfig?.((current) => ({ ...(current || {}), config: payload.config, runs: [payload.run, ...((current?.runs || []).slice(0, 9))] }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="project-actions-panel">
      {commands.length === 0 ? (
        <div className="empty-actions">
          <p className="muted">No project Workflow Apps yet.</p>
          <button type="button" onClick={importTemplate}>Import Investment Advisor template</button>
        </div>
      ) : (
        commands.map(([name, command]) => {
          const app = workflowAppForCommand(name, command);
          return (
            <WorkflowAppShell
              key={name}
              app={app}
              running={running === name}
              onPreview={() => previewCommand(name)}
              onRun={() => runCommand(name, command)}
              projectPath={activePath?.projectPath}
              power={power}
              artifacts={result?.command_id === name || result?.action_id === name ? result.artifacts || [] : []}
            >
              <div className="action-badges">
                <span>{actionKindLabel(command.kind)}</span>
                <span>{actionOutputLabel(command)}</span>
                <span>{actionStatus(command)}</span>
                {power && <span>{command.permission || "read-only"}</span>}
              </div>
            </WorkflowAppShell>
          );
        })
      )}
      {preview && (
        <div className="run-result preview-result">
          <strong>Pre-run review</strong>
          <dl>
            <div><dt>App</dt><dd>{preview.label}</dd></div>
            <div><dt>Kind</dt><dd>{actionKindLabel(preview.kind)}</dd></div>
            <div><dt>Permission</dt><dd>{preview.permission}</dd></div>
            {preview.cwd && <div><dt>Location</dt><dd><code>{preview.cwd}</code></dd></div>}
            {preview.command_line && <div><dt>Command</dt><dd><code>{preview.command_line}</code></dd></div>}
            {preview.script && <div><dt>Script</dt><dd><code>{preview.script}</code></dd></div>}
          </dl>
          {preview.expected_input_files?.length > 0 && <p className="muted">Input files: {preview.expected_input_files.slice(0, 5).join(", ")}</p>}
          {preview.expected_output_files?.length > 0 && <p className="muted">Output files: {preview.expected_output_files.slice(0, 5).join(", ")}</p>}
          {preview.prompt && <pre>{preview.prompt.slice(0, 1600)}</pre>}
        </div>
      )}
      {result && (
        <div className={`run-result ${result.status === "completed" ? "" : "failed"}`}>
          <strong>{resultTitle(result)}</strong>
          <p className="muted">{resultDescription(result)}</p>
          <code>{result.run_dir}</code>
          {(result.artifacts || []).length > 0 && (
            <div className="artifact-list">
              <strong>Artifacts</strong>
              {(result.artifacts || []).map((item: ArtifactRecord) => (
                <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)} disabled={!item.exists}>
                  {item.path} · {item.exists ? `${item.size} bytes` : "not found"}
                </button>
              ))}
            </div>
          )}
          {result.stdout && <pre>{result.stdout.slice(0, 2400)}</pre>}
          {result.stderr && <pre className="error-text">{result.stderr.slice(0, 2400)}</pre>}
          <ResultActions result={result} onOpenArtifact={onOpenArtifact} />
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

function workflowAppForCommand(name: string, command: CommandDefinition = {}): WorkflowAppDefinition {
  if (command.workflow_app) return command.workflow_app;
  const outputs = Array.isArray(command.outputs) ? command.outputs : [];
  return {
    id: command.workflow_app_id || name,
    title: command.label || name,
    description: command.description || "A Workflow App that uses files, context, and command definitions.",
    category: command.category || "Project",
    inputSchema: (Array.isArray(command.inputs) ? command.inputs : Array.isArray(command.input) ? command.input : []).map((item) => ({
      id: String(item).replace(/[^a-z0-9]+/gi, "_"),
      label: String(item),
      type: "file",
      required: false,
    })),
    outputSchema: outputs.map((path: string) => ({
      id: String(path).replace(/[^a-z0-9]+/gi, "_"),
      path: String(path),
      type: String(path).endsWith(".csv") ? "csv" : String(path).endsWith(".json") ? "json" : String(path).endsWith(".md") ? "markdown" : "text",
      viewer_id: String(path).endsWith(".csv") ? "tableViewer" : String(path).endsWith(".json") ? "jsonViewer" : String(path).endsWith(".md") ? "markdownViewer" : "textViewer",
    })),
    runPolicy: {
      mode: command.kind === "python" || command.kind === "shell" ? "approval_required" : "local_only",
      requiresConfirmation: command.kind === "python" || command.kind === "shell",
      network: command.permissions?.network ? "approval_required" : "blocked",
      fileWrite: outputs.length ? "artifacts_only" : "blocked",
      cloud: "blocked",
    },
    defaultViewerLayout: outputs.slice(0, 3).map((path: string, index: number) => ({
      id: `slot_${index}`,
      title: String(path).split("/").pop() || String(path),
      viewer_id: String(path).endsWith(".csv") ? "tableViewer" : String(path).endsWith(".json") ? "jsonViewer" : String(path).endsWith(".md") ? "markdownViewer" : "textViewer",
      artifact: String(path),
      position: index === 0 ? "left" : index === 1 ? "center" : "right",
    })),
    supportedResources: ["csv", "json", "markdown", "text"],
    permissions: command.permissions || {},
  };
}

function ResultActions({ result, onOpenArtifact }: { result: ActionRunRecord; onOpenArtifact?: (artifact: ArtifactRecord) => void }) {
  if (result.status !== "completed") return null;
  const artifacts = (result.artifacts || []).filter((item: ArtifactRecord) => item.exists);
  if (result.kind === "prompt_recipe") {
    return (
      <div className="next-actions">
        <button type="button" onClick={() => navigator.clipboard?.writeText(result.stdout || "")}>Copy prompt</button>
      </div>
    );
  }
  if (artifacts.length > 0) {
    return (
      <div className="next-actions">
        {artifacts.slice(0, 3).map((item) => (
          <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>
            Open file: {item.path.split("/").pop()}
          </button>
        ))}
      </div>
    );
  }
  return null;
}

export function TaskSuggestionsPanel({ activePath, suggestions = [], onProjectConfig, onChat, power, fetchJson }: { activePath: ActivePath; suggestions?: CommandDefinition[]; onProjectConfig?: (next: (current: ProjectConfigPayload | null) => ProjectConfigPayload) => void; onChat?: (next: (current: JsonMap | null) => JsonMap) => void; power?: boolean; fetchJson: FetchJson }) {
  const [running, setRunning] = useState("");
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [result, setResult] = useState<ActionRunRecord | null>(null);
  const [error, setError] = useState("");
  if (!activePath.projectPath || suggestions.length === 0) return null;

  async function previewCommand(name: string) {
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      setPreview(payload.preview as PreviewRecord);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runCommand(name: string, label?: string) {
    setRunning(name);
    setError("");
    setResult(null);
    try {
      const previewPayload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      const confirmRun = !previewPayload.preview.requires_confirmation || globalThis.confirm(`Run ${label || name}?`);
      if (!confirmRun) return;
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/run`, {
        method: "POST",
        body: new URLSearchParams({
          confirm: previewPayload.preview.requires_confirmation ? "1" : "0",
          session_slug: activePath.sessionSlug || "",
        }),
      });
      setResult(payload.run as ActionRunRecord);
      onProjectConfig?.((current) => ({ ...(current || {}), config: payload.config, runs: [payload.run, ...((current?.runs || []).slice(0, 9))] }));
      if (payload.message) {
        onChat?.((current) => ({
          ...(current || {}),
          messages: [...(current?.messages || []), payload.message],
          task_suggestions: [],
        }));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning("");
    }
  }

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
            <button type="button" onClick={() => previewCommand(item.command)}>{previewLabel(item.kind)}</button>
            <button type="button" onClick={() => runCommand(item.command, item.label)} disabled={running === item.command}>
              {running === item.command ? "Running" : executeLabel(item.kind)}
            </button>
          </div>
        </div>
      ))}
      {preview && (
        <div className="run-result preview-result compact-result">
          <strong>Pre-run review</strong>
          <p className="muted">{preview.description || preview.label}</p>
          {power && preview.cwd && <code>{preview.cwd}</code>}
          {preview.prompt && <pre>{preview.prompt.slice(0, 1200)}</pre>}
        </div>
      )}
      {result && (
        <div className="run-result compact-result">
          <strong>{result.status === "completed" ? "Run completed" : "Run failed"}</strong>
          <p className="muted">{activePath.sessionSlug ? "Result attached to the current chat." : "This result will be available as project context for the next response."}</p>
          {power && <code>{result.run_dir}</code>}
          {result.stdout && <pre>{result.stdout.slice(0, 1200)}</pre>}
          {result.stderr && <pre className="error-text">{result.stderr.slice(0, 1200)}</pre>}
        </div>
      )}
      {error && <small className="error-text">{error}</small>}
    </div>
  );
}

function kindLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prompt",
    shell: "Shell",
    python: "Python",
    file_index: "Files",
    codex_prompt: "Codex",
    openclaw_status: "OpenClaw",
  };
  return kind && kind in labels ? labels[kind as KindKey] : kind;
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

export function actionKindLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prepare AI prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Artifact",
    openclaw_status: "Open View",
  };
  return kind && kind in labels ? labels[kind as KindKey] : kindLabel(kind);
}

function previewLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Preview Prompt",
    shell: "Preview Command",
    python: "Preview Script",
    file_index: "Preview Files",
    codex_prompt: "Preview Prompt",
    openclaw_status: "Preview View",
  };
  return kind && kind in labels ? labels[kind as KindKey] : "Preview";
}

function executeLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prepare Prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Prompt",
    openclaw_status: "Check Status",
  };
  return kind && kind in labels ? labels[kind as KindKey] : "Run";
}

export function actionStatus(command: CommandDefinition = {}) {
  const status = String(command.status || "").toLowerCase();
  if (["ready", "partial", "mock", "planned"].includes(status)) {
    return status[0].toUpperCase() + status.slice(1);
  }
  if (command.kind === "prompt_recipe" || command.kind === "shell") return "Partial";
  if (command.kind === "python" || command.kind === "file_index") return "Ready";
  return "Ready";
}

function actionOutputLabel(command: CommandDefinition = {}) {
  if (command.output === "chat_prompt" || command.kind === "prompt_recipe") return "Prompt prepared";
  if (command.output === "artifact" || command.kind === "python" || command.kind === "shell") return "Files/logs";
  if (command.kind === "file_index") return "File list";
  if (command.kind === "codex_prompt") return "Codex Prompt";
  return "Run result";
}

function resultTitle(result: Partial<ActionRunRecord> = {}) {
  if (result.status !== "completed") return "Run failed";
  if (result.kind === "prompt_recipe") return "Prompt recipe recorded";
  if (result.kind === "python") return "Python script completed";
  if (result.kind === "shell") return "Shell command completed";
  if (result.kind === "codex_prompt") return "Codex prompt generated";
  if (result.kind === "file_index") return "File list prepared";
  return "Run completed";
}

function resultDescription(result: Partial<ActionRunRecord> = {}) {
  if (result.status !== "completed") return "Check stderr and result.json to trace the failure.";
  if (result.kind === "prompt_recipe") {
    return "This command does not modify files. It stores a prompt in the runs folder so you can continue with it in chat.";
  }
  if ((result.artifacts || []).length > 0) return "Generated or verified files are listed below. The run is also stored in the project runs folder.";
  return "Execution logs and result.json were stored in the project runs folder.";
}
