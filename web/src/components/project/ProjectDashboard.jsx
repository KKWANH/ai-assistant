import React, { useMemo, useState } from "react";
import { actionStatus, ProjectActionsPanel } from "../actions/ActionPanels.jsx";
import { ArchitectureDiagram } from "./ArchitectureDiagram.jsx";

export function ProjectDashboard({ activePath, projectConfig, project, power, fetchJson, onProjectConfig, navigate }) {
  const [runDetail, setRunDetail] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [modalError, setModalError] = useState("");
  const config = projectConfig?.config || {};
  const runs = projectConfig?.runs || [];
  const commands = Object.entries(config.commands || {});
  const panels = config.panels || [];
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
        <p>{config.description || project?.notes || "파일, 기억, 명령, 실행 기록을 묶는 로컬 작업실입니다."}</p>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <h2>현재 목표</h2>
          <p className="muted">프로젝트 Goal을 설정하면 이 영역이 작업 기준점이 됩니다.</p>
          <a className="soft-link" href={`/project/${activePath.projectPath}`}>목표 설정은 파일/기억 패널에서 진행</a>
        </section>

        <section className="dashboard-card">
          <h2>Active Context</h2>
          <div className="context-meter">
          <span>{commands.length} commands</span>
          <span>{runs.length} runs</span>
          <span>{panels.length || 0} panels</span>
          </div>
          <p className="muted">
            {(context.include || []).length > 0
              ? `포함 패턴: ${(context.include || []).slice(0, 3).join(", ")}`
              : "aiws.yaml을 가져오면 파일 패턴과 명령이 여기에 연결됩니다."}
          </p>
        </section>
      </div>

      <section className="dashboard-card project-chat-overview">
        <div className="section-row">
          <div>
            <p className="eyebrow">Project Memory</p>
            <h2>이 프로젝트에서 오간 대화</h2>
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
          <p className="muted">아직 이 프로젝트 안에 대화가 없습니다. 아래 입력창에서 프로젝트 대화를 시작하면 여기에 쌓입니다.</p>
        )}
      </section>

      <section className="dashboard-card dashboard-actions">
        <div className="section-row">
          <div>
            <p className="eyebrow">Actions</p>
            <h2>프로젝트 명령</h2>
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

      <section className="dashboard-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">Recipe Status</p>
            <h2>되는 것 / 준비 중인 것</h2>
          </div>
          <span className="soft-pill">{commands.length}</span>
        </div>
        {commands.length === 0 ? (
          <p className="muted">aiws.yaml을 가져오면 각 명령의 상태가 Ready / Partial / Planned로 표시됩니다.</p>
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

      <section className="dashboard-card dashboard-architecture">
        <div className="section-row">
          <div>
            <p className="eyebrow">Configurable Cockpit</p>
            <h2>AIWS 아키텍처</h2>
          </div>
          <span className="soft-pill">React Flow</span>
        </div>
        <p className="muted">채팅은 입구이고, 실제 본체는 파일 작업실, 컨텍스트 manifest, 모델 라우터, 프로젝트 명령 실행 기록입니다.</p>
        <ArchitectureDiagram />
      </section>

      <section className="dashboard-card">
        <div className="section-row">
          <div>
            <p className="eyebrow">Recent Runs</p>
            <h2>실행 기록</h2>
          </div>
          <span className="soft-pill">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <p className="muted">아직 실행 기록이 없습니다. 위의 작업 레시피를 실행하면 결과와 산출물이 여기에 남습니다.</p>
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
            <p className="eyebrow">Artifacts</p>
            <h2>생성/확인된 결과물</h2>
          </div>
          <span className="soft-pill">{artifacts.length}</span>
        </div>
        {artifacts.length === 0 ? (
          <p className="muted">스크립트나 리포트 명령이 파일을 생성하면 여기서 바로 확인할 수 있습니다.</p>
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
            <button type="button" className="viewer-close" onClick={() => setModalError("")}>닫기</button>
            <h2>열 수 없습니다</h2>
            <p className="error-text">{modalError}</p>
          </div>
        </div>
      )}
      {runDetail && <RunDetailModal detail={runDetail} power={power} onClose={() => setRunDetail(null)} onOpenArtifact={openArtifact} />}
      {artifact && <ArtifactViewer artifact={artifact} onClose={() => setArtifact(null)} />}
    </div>
  );
}

function summarizeProjectChats(project) {
  const sessions = project?.sessions || [];
  if (sessions.length === 0) {
    return {
      summary: "아직 대화 기록이 없어 프로젝트 성격을 분석할 수 없습니다.",
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
  const representative = titles.find((title) => title.length >= 4) || project?.title || "이 프로젝트";
  const topicText = topics.length > 0
    ? `주요 흐름은 ${topics.slice(0, 4).join(", ")} 쪽으로 보입니다.`
    : `대표 대화는 "${representative}"입니다.`;
  return {
    summary: `${sessions.length}개의 대화가 연결되어 있습니다. ${topicText}${latest ? ` 마지막 업데이트는 ${latest.slice(0, 10)}입니다.` : ""}`,
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
        <button type="button" className="viewer-close" onClick={onClose}>닫기</button>
        <p className="eyebrow">Run Detail</p>
        <h2>{run.label || run.command || "실행 기록"}</h2>
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
        <button type="button" className="viewer-close" onClick={onClose}>닫기</button>
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
