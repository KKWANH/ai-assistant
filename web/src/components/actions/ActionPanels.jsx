import React, { useState } from "react";

export function AutomationPanel({ projects = [], onAutomations, fetchJson, formatDate }) {
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  async function run(slug) {
    setRunning(slug);
    setError("");
    try {
      const payload = await fetchJson(`/api/automations/${slug}/run`, { method: "POST", body: new FormData() });
      onAutomations?.(payload.projects || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="runtime-card automation-card">
      <strong>Automation Projects</strong>
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

export function ProjectActionsPanel({ activePath, projectConfig, onProjectConfig, power, fetchJson, onOpenArtifact }) {
  const [running, setRunning] = useState("");
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const config = projectConfig?.config || {};
  const commands = Object.entries(config.commands || {});
  if (!activePath.projectPath) {
    return null;
  }

  async function importTemplate() {
    setError("");
    const payload = await fetchJson(`/api/project-config/${activePath.projectPath}/import`, {
      method: "POST",
      body: new URLSearchParams({ template: "investment-rebalancer" }),
    });
    onProjectConfig?.({ config: payload.config, runs: [] });
  }

  async function previewCommand(name) {
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      setPreview(payload.preview);
    } catch (err) {
      setError(err.message);
    }
  }

  async function runCommand(name, command) {
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
      setResult(payload.run);
      onProjectConfig?.((current) => ({ ...(current || {}), config: payload.config, runs: [payload.run, ...((current?.runs || []).slice(0, 9))] }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="project-actions-panel">
      {commands.length === 0 ? (
        <div className="empty-actions">
          <p className="muted">No project recipes yet.</p>
          <button type="button" onClick={importTemplate}>Import Investment Rebalancer template</button>
        </div>
      ) : (
        commands.map(([name, command]) => (
          <div className="action-card" key={name}>
            <div>
              <div className="action-title-row">
                <strong>{command.label || name}</strong>
                <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
              </div>
              <p>{command.description || "A project action that uses files, context, and command definitions."}</p>
              <div className="action-badges">
                <span>{actionKindLabel(command.kind)}</span>
                <span>{actionOutputLabel(command)}</span>
                {power && <span>{command.permission || "read-only"}</span>}
              </div>
            </div>
            <div className="action-buttons">
              <button type="button" onClick={() => previewCommand(name)}>{previewLabel(command.kind)}</button>
              <button type="button" onClick={() => runCommand(name, command)} disabled={running === name}>
                {running === name ? "Running" : executeLabel(command.kind)}
              </button>
            </div>
          </div>
        ))
      )}
      {preview && (
        <div className="run-result preview-result">
          <strong>Pre-run review</strong>
          <dl>
            <div><dt>Action</dt><dd>{preview.label}</dd></div>
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
          {result.artifacts?.length > 0 && (
            <div className="artifact-list">
              <strong>Artifacts</strong>
              {result.artifacts.map((item) => (
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

function ResultActions({ result, onOpenArtifact }) {
  if (result.status !== "completed") return null;
  const artifacts = (result.artifacts || []).filter((item) => item.exists);
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

export function TaskSuggestionsPanel({ activePath, suggestions = [], onProjectConfig, onChat, power, fetchJson }) {
  const [running, setRunning] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  if (!activePath.projectPath || suggestions.length === 0) return null;

  async function previewCommand(name) {
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const payload = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      setPreview(payload.preview);
    } catch (err) {
      setError(err.message);
    }
  }

  async function runCommand(name, label) {
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
      setResult(payload.run);
      onProjectConfig?.((current) => ({ ...(current || {}), config: payload.config, runs: [payload.run, ...((current?.runs || []).slice(0, 9))] }));
      if (payload.message) {
        onChat?.((current) => ({
          ...(current || {}),
          messages: [...(current?.messages || []), payload.message],
          task_suggestions: [],
        }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="task-suggestions-panel">
      <div className="suggestion-header">
        <strong>Suggested next actions</strong>
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

function kindLabel(kind) {
  return {
    prompt_recipe: "Prompt",
    shell: "Shell",
    python: "Python",
    file_index: "Files",
    codex_prompt: "Codex",
    openclaw_status: "OpenClaw",
  }[kind] || kind;
}

export function ActionInspector({ projectConfig, power }) {
  const commands = Object.entries(projectConfig?.config?.commands || {});
  const runs = projectConfig?.runs || [];
  const command = commands[0]?.[1];
  if (!command) {
    return (
      <div className="action-inspector-card">
        <strong>No action selected</strong>
        <p className="muted">Import or run a recipe in the main workbench to inspect details here.</p>
      </div>
    );
  }
  const latest = runs[0];
  return (
    <div className="action-inspector-card">
      <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
      <strong>{command.label || "Project action"}</strong>
      <p>{command.description || "A project action that uses files, context, and command definitions."}</p>
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

export function actionKindLabel(kind) {
  return {
    prompt_recipe: "Prepare AI prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Artifact",
    openclaw_status: "Open View",
  }[kind] || kindLabel(kind);
}

function previewLabel(kind) {
  return {
    prompt_recipe: "Preview Prompt",
    shell: "Preview Command",
    python: "Preview Script",
    file_index: "Preview Files",
    codex_prompt: "Preview Prompt",
    openclaw_status: "Preview View",
  }[kind] || "Preview";
}

function executeLabel(kind) {
  return {
    prompt_recipe: "Prepare Prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Prompt",
    openclaw_status: "Check Status",
  }[kind] || "Run";
}

export function actionStatus(command = {}) {
  const status = String(command.status || "").toLowerCase();
  if (["ready", "partial", "mock", "planned"].includes(status)) {
    return status[0].toUpperCase() + status.slice(1);
  }
  if (command.kind === "prompt_recipe" || command.kind === "shell") return "Partial";
  if (command.kind === "python" || command.kind === "file_index") return "Ready";
  return "Ready";
}

function actionOutputLabel(command = {}) {
  if (command.output === "chat_prompt" || command.kind === "prompt_recipe") return "Prompt prepared";
  if (command.output === "artifact" || command.kind === "python" || command.kind === "shell") return "Files/logs";
  if (command.kind === "file_index") return "File list";
  if (command.kind === "codex_prompt") return "Codex Prompt";
  return "Run result";
}

function resultTitle(result = {}) {
  if (result.status !== "completed") return "Run failed";
  if (result.kind === "prompt_recipe") return "Prompt recipe recorded";
  if (result.kind === "python") return "Python script completed";
  if (result.kind === "shell") return "Shell command completed";
  if (result.kind === "codex_prompt") return "Codex prompt generated";
  if (result.kind === "file_index") return "File list prepared";
  return "Run completed";
}

function resultDescription(result = {}) {
  if (result.status !== "completed") return "Check stderr and result.json to trace the failure.";
  if (result.kind === "prompt_recipe") {
    return "This command does not modify files. It stores a prompt in the runs folder so you can continue with it in chat.";
  }
  if (result.artifacts?.length > 0) return "Generated or verified files are listed below. The run is also stored in the project runs folder.";
  return "Execution logs and result.json were stored in the project runs folder.";
}
