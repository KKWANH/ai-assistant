import { useState } from "react";
import { Composer } from "../../components/chat/Composer";
import { ProjectDashboard } from "../../components/project/ProjectDashboard";
import type { AccountSummary } from "../../entities/workspace/types";
import type { ProjectSummary } from "../../entities/project/types";
import type { ArtifactRecord } from "../../shared/contracts/workbench";
import type { ModelMode } from "../../lib/modelModes";
import type { ActivePath, NavigateFn, ProjectConfigState, RefreshFn, SetChatFn } from "../../shared/contracts/runtime";
import { COPY } from "../../shared/copy/copy";
import styles from "./ProjectSurface.module.css";

export type ProjectSurfaceProps = {
  activePath: ActivePath;
  project?: ProjectSummary;
  projectConfig: ProjectConfigState;
  power: boolean;
  copy: typeof COPY;
  error?: string;
  navigate: NavigateFn;
  refreshWorkspace?: RefreshFn;
  onAsk: SetChatFn;
  account?: AccountSummary;
  models: ModelMode[];
  activeAppId?: string;
  onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigState>>;
};

export function ProjectSurface({
  activePath,
  project,
  projectConfig,
  power,
  copy,
  navigate,
  onAsk,
  account,
  models,
  activeAppId,
  onProjectConfig,
}: ProjectSurfaceProps) {
  const config = projectConfig?.config || {};
  const projectRecord = projectConfig?.project || {};
  const runs = projectConfig?.runs || [];
  const commands = Object.keys(config.commands || {});
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run }))) as Array<ArtifactRecord & { run?: unknown }>;
  const workflowMode = Boolean(activeAppId);
  const title = config.name || project?.title || activePath.projectPath || "Project";
  const description = config.description || (typeof projectRecord.notes === "string" ? projectRecord.notes : "") || "프로젝트 파일, 채팅, 실행, 산출물을 연결하는 작업대.";
  const localOnly = Boolean((projectRecord.security as { local_only?: boolean } | undefined)?.local_only);

  if (workflowMode) {
    return (
      <section className={styles.surface}>
        <div className={styles.workflowCard}>
          <div className={styles.workflowHeader}>
            <div>
              <p className={styles.eyebrow}>Workflow App</p>
              <h1>{activeAppId}</h1>
              <p>입력 → 실행 → Run → Artifact → Viewer 흐름을 프로젝트 안에서 처리.</p>
            </div>
            <button type="button" onClick={() => navigate(`/project/${activePath.projectPath}`)}>프로젝트로 돌아가기</button>
          </div>
          <ProjectDashboard
            activePath={activePath}
            projectConfig={projectConfig}
            project={project}
            power={power}
            copy={copy}
            activeAppId={activeAppId}
            onProjectConfig={onProjectConfig}
            navigate={navigate}
          />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.surface}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Project Workbench</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className={styles.chips}>
          <span>{localOnly ? "로컬 전용" : "클라우드 확인 후 사용"}</span>
          <span>{project?.sessions?.length || 0} chats</span>
          <span>{runs.length} runs</span>
          <span>{artifacts.length} artifacts</span>
          <span>{commands.length} actions</span>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainStack}>
          <ProjectCommandSurface activePath={activePath} account={account} models={models} onAsk={onAsk} navigate={navigate} />
          <div className={styles.dashboardCard}>
            <ProjectDashboard
              activePath={activePath}
              projectConfig={projectConfig}
              project={project}
              power={power}
              copy={copy}
              onProjectConfig={onProjectConfig}
              navigate={navigate}
            />
          </div>
        </div>

        <aside className={styles.rail} aria-label="Project context">
          <section className={styles.railCard}>
            <p className={styles.eyebrow}>Context</p>
            <h2>프로젝트 상태</h2>
            <div className={styles.statList}>
              <span>Sessions <b>{project?.sessions?.length || 0}</b></span>
              <span>RAG / Runs <b>{runs.length}</b></span>
              <span>Artifacts <b>{artifacts.length}</b></span>
              <span>Actions <b>{commands.length}</b></span>
            </div>
          </section>
          <section className={styles.railCard}>
            <p className={styles.eyebrow}>Recent</p>
            <h2>최근 산출물</h2>
            <div className={styles.miniList}>
              {artifacts.slice(0, 4).map((artifact) => (
                <div className={styles.miniItem} key={artifact.path}>
                  <strong>{artifact.path?.split("/").pop() || artifact.path}</strong>
                  <small>{artifact.viewer_type || artifact.type || "output"}</small>
                </div>
              ))}
              {artifacts.length === 0 && <div className={styles.miniItem}><strong>아직 산출물 없음</strong><small>채팅 또는 Workflow App 실행 후 표시.</small></div>}
            </div>
          </section>
          <section className={styles.railCard}>
            <p className={styles.eyebrow}>Actions</p>
            <h2>사용 가능한 작업</h2>
            <div className={styles.miniList}>
              {commands.slice(0, 4).map((command) => (
                <div className={styles.miniItem} key={command}>
                  <strong>{command}</strong>
                  <small>aiws.yaml command</small>
                </div>
              ))}
              {commands.length === 0 && <div className={styles.miniItem}><strong>명령 없음</strong><small>aiws.yaml에 Workflow App 추가.</small></div>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function ProjectCommandSurface({
  activePath,
  account,
  models,
  onAsk,
  navigate,
}: {
  activePath: ActivePath;
  account?: AccountSummary;
  models: ModelMode[];
  onAsk: SetChatFn;
  navigate: NavigateFn;
}) {
  const [attachmentSignal, setAttachmentSignal] = useState(0);
  const [tableSignal, setTableSignal] = useState(0);
  const projectPath = activePath.projectPath || "";
  return (
    <div className={styles.commandCard}>
      <div className={styles.commandHeader}>
        <div>
          <p className={styles.eyebrow}>Project Chat</p>
          <h2>프로젝트 자료로 바로 질문</h2>
          <p>파일을 붙이거나 RAG로 검색된 프로젝트 컨텍스트를 사용해서 새 work thread를 시작함.</p>
        </div>
        <div className={styles.commandActions}>
          <button type="button" onClick={() => setAttachmentSignal((value) => value + 1)}>파일 추가</button>
          <button type="button" onClick={() => setTableSignal((value) => value + 1)}>표 추가</button>
        </div>
      </div>
      <Composer
        activePath={{ projectPath, sessionSlug: "" }}
        onAsk={onAsk}
        account={account}
        power={false}
        models={models}
        openAttachmentSignal={attachmentSignal}
        openTableSignal={tableSignal}
        onSessionCreated={(session) => {
          const targetProject = session.project_path || projectPath;
          if (targetProject && session.slug) navigate(`/chat/${targetProject}/${session.slug}`);
        }}
      />
    </div>
  );
}
