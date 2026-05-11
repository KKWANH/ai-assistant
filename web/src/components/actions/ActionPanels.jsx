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
      <p>반복 가능한 로컬 작업 실행 기록입니다.</p>
      {projects.length === 0 && <p className="muted">등록된 자동화 프로젝트가 없습니다.</p>}
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

export function ProjectActionsPanel({ activePath, projectConfig, onProjectConfig, power, fetchJson }) {
  const [running, setRunning] = useState("");
  const [result, setResult] = useState(null);
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

  async function runCommand(name, command) {
    setRunning(name);
    setError("");
    setResult(null);
    try {
      const preview = await fetchJson(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      const confirmRun = !preview.preview.requires_confirmation || globalThis.confirm(`${command.label || name} 실행을 확인할까요?`);
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
          <p className="muted">이 프로젝트에는 아직 작업 레시피가 없습니다.</p>
          <button type="button" onClick={importTemplate}>Investment Rebalancer 템플릿 가져오기</button>
        </div>
      ) : (
        commands.map(([name, command]) => (
          <div className="action-card" key={name}>
            <div>
              <strong>{command.label || name}</strong>
              <p>{command.description || "프로젝트 파일과 명령을 사용하는 작업입니다."}</p>
              <div className="action-badges">
                <span>{kindLabel(command.kind)}</span>
                {power && <span>{command.permission || "read-only"}</span>}
              </div>
            </div>
            <button type="button" onClick={() => runCommand(name, command)} disabled={running === name}>
              {running === name ? "실행 중" : "Run"}
            </button>
          </div>
        ))
      )}
      {result && (
        <div className="run-result">
          <strong>{result.status}</strong>
          {power && <code>{result.run_dir}</code>}
          {result.stdout && <pre>{result.stdout.slice(0, 1600)}</pre>}
          {result.stderr && <pre className="error-text">{result.stderr.slice(0, 1600)}</pre>}
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
