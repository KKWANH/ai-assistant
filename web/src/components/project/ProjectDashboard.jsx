import React from "react";
import { actionStatus, ProjectActionsPanel } from "../actions/ActionPanels.jsx";
import { ArchitectureDiagram } from "./ArchitectureDiagram.jsx";

export function ProjectDashboard({ activePath, projectConfig, project, power, fetchJson, onProjectConfig }) {
  const config = projectConfig?.config || {};
  const runs = projectConfig?.runs || [];
  const commands = Object.entries(config.commands || {});
  const panels = config.panels || [];
  const context = config.context || {};
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run })));

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
              <div className="run-row" key={run.run_id || `${run.command}-${run.created_at}`}>
                <strong>{run.label || run.command}</strong>
                <span>{run.status}</span>
                <small>{run.created_at}</small>
              </div>
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
              <div className="artifact-tile" key={`${artifact.run.run_id}-${artifact.path}`}>
                <strong>{artifact.path}</strong>
                <span>{artifact.exists ? `${artifact.size} bytes` : "not found"}</span>
                <small>{artifact.run.label || artifact.run.command}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
