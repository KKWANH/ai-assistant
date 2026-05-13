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
              <div className="action-title-row">
                <strong>{command.label || name}</strong>
                <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
              </div>
              <p>{command.description || "프로젝트 파일과 명령을 사용하는 작업입니다."}</p>
              <div className="action-badges">
                <span>{actionKindLabel(command.kind)}</span>
                <span>{actionOutputLabel(command)}</span>
                {power && <span>{command.permission || "read-only"}</span>}
              </div>
            </div>
            <div className="action-buttons">
              <button type="button" onClick={() => previewCommand(name)}>{previewLabel(command.kind)}</button>
              <button type="button" onClick={() => runCommand(name, command)} disabled={running === name}>
                {running === name ? "실행 중" : executeLabel(command.kind)}
              </button>
            </div>
          </div>
        ))
      )}
      {preview && (
        <div className="run-result preview-result">
          <strong>실행 전 확인</strong>
          <dl>
            <div><dt>작업</dt><dd>{preview.label}</dd></div>
            <div><dt>종류</dt><dd>{actionKindLabel(preview.kind)}</dd></div>
            <div><dt>권한</dt><dd>{preview.permission}</dd></div>
            {preview.cwd && <div><dt>위치</dt><dd><code>{preview.cwd}</code></dd></div>}
            {preview.command_line && <div><dt>명령</dt><dd><code>{preview.command_line}</code></dd></div>}
            {preview.script && <div><dt>스크립트</dt><dd><code>{preview.script}</code></dd></div>}
          </dl>
          {preview.expected_input_files?.length > 0 && <p className="muted">읽을 파일: {preview.expected_input_files.slice(0, 5).join(", ")}</p>}
          {preview.expected_output_files?.length > 0 && <p className="muted">생성 파일: {preview.expected_output_files.slice(0, 5).join(", ")}</p>}
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
              <strong>생성/확인된 파일</strong>
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
        <button type="button" onClick={() => navigator.clipboard?.writeText(result.stdout || "")}>프롬프트 복사</button>
      </div>
    );
  }
  if (artifacts.length > 0) {
    return (
      <div className="next-actions">
        {artifacts.slice(0, 3).map((item) => (
          <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>
            파일 열기: {item.path.split("/").pop()}
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
      const confirmRun = !previewPayload.preview.requires_confirmation || globalThis.confirm(`${label || name} 실행을 확인할까요?`);
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
        <strong>다음 작업 후보</strong>
        <span>사용자가 승인해야 실행됩니다</span>
      </div>
      {suggestions.map((item) => (
        <div className="suggestion-card" key={item.command}>
          <div>
            <b>{item.label || item.command}</b>
            <p>{item.description || "이 대화에 이어 실행할 수 있는 프로젝트 명령입니다."}</p>
            <span>{actionKindLabel(item.kind)} · {item.permission}</span>
          </div>
          <div className="action-buttons">
            <button type="button" onClick={() => previewCommand(item.command)}>{previewLabel(item.kind)}</button>
            <button type="button" onClick={() => runCommand(item.command, item.label)} disabled={running === item.command}>
              {running === item.command ? "실행 중" : executeLabel(item.kind)}
            </button>
          </div>
        </div>
      ))}
      {preview && (
        <div className="run-result preview-result compact-result">
          <strong>실행 전 확인</strong>
          <p className="muted">{preview.description || preview.label}</p>
          {power && preview.cwd && <code>{preview.cwd}</code>}
          {preview.prompt && <pre>{preview.prompt.slice(0, 1200)}</pre>}
        </div>
      )}
      {result && (
        <div className="run-result compact-result">
          <strong>{result.status === "completed" ? "실행 완료" : "실행 실패"}</strong>
          <p className="muted">{activePath.sessionSlug ? "결과를 현재 대화에 붙였습니다." : "이 결과는 다음 답변의 프로젝트 컨텍스트에 포함됩니다."}</p>
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
        <strong>선택된 작업 없음</strong>
        <p className="muted">중앙 작업 공간에서 레시피를 가져오거나 실행하면 세부 정보가 여기에 정리됩니다.</p>
      </div>
    );
  }
  const latest = runs[0];
  return (
    <div className="action-inspector-card">
      <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
      <strong>{command.label || "프로젝트 명령"}</strong>
      <p>{command.description || "프로젝트 파일과 명령을 사용하는 작업입니다."}</p>
      <dl>
        <div><dt>종류</dt><dd>{actionKindLabel(command.kind)}</dd></div>
        <div><dt>결과</dt><dd>{actionOutputLabel(command)}</dd></div>
        {power && <div><dt>권한</dt><dd>{command.permission || "read-only"}</dd></div>}
        {latest && <div><dt>최근 실행</dt><dd>{latest.status} · {latest.label || latest.command}</dd></div>}
      </dl>
      <p className="muted">실행과 결과 확인은 중앙 Project Workbench에서 진행합니다.</p>
    </div>
  );
}

export function actionKindLabel(kind) {
  return {
    prompt_recipe: "Ask AI 준비",
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
  if (command.output === "chat_prompt" || command.kind === "prompt_recipe") return "프롬프트 준비";
  if (command.output === "artifact" || command.kind === "python" || command.kind === "shell") return "파일/로그 생성";
  if (command.kind === "file_index") return "파일 목록";
  if (command.kind === "codex_prompt") return "Codex Prompt";
  return "실행 결과";
}

function resultTitle(result = {}) {
  if (result.status !== "completed") return "실행 실패";
  if (result.kind === "prompt_recipe") return "프롬프트 레시피 기록 완료";
  if (result.kind === "python") return "Python 스크립트 실행 완료";
  if (result.kind === "shell") return "Shell 명령 실행 완료";
  if (result.kind === "codex_prompt") return "Codex Prompt 생성 완료";
  if (result.kind === "file_index") return "파일 목록 확인 완료";
  return "실행 완료";
}

function resultDescription(result = {}) {
  if (result.status !== "completed") return "stderr와 result.json을 확인해 실패 원인을 추적할 수 있습니다.";
  if (result.kind === "prompt_recipe") {
    return "이 명령은 파일을 수정하지 않고 AI에게 보낼 프롬프트를 runs 폴더에 저장합니다. 실제 AI 답변은 이 프롬프트를 대화에서 이어서 사용해야 생성됩니다.";
  }
  if (result.artifacts?.length > 0) return "생성 또는 확인된 파일이 아래에 표시됩니다. 결과는 프로젝트 runs 폴더에도 저장되었습니다.";
  return "실행 로그와 결과 JSON이 프로젝트 runs 폴더에 저장되었습니다.";
}
