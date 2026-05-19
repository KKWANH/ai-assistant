import { StartPane } from "../../components/home/StartPane";
import { ArtifactCard, ProjectCard, RunCard, SessionCard } from "../../components/work-objects/WorkObjectCards";
import type { AccountSummary, WorkspaceSummary } from "../../entities/workspace/types";
import type { ArtifactRecord, RunRecord } from "../../shared/contracts/workbench";
import type { ModelMode } from "../../lib/modelModes";
import type { HomePayload, NavigateFn, RefreshFn, SetChatFn } from "../../shared/contracts/runtime";
import styles from "./HomeSurface.module.css";

export type HomeSurfaceProps = {
  error?: string;
  navigate: NavigateFn;
  refreshWorkspace?: RefreshFn;
  onAsk: SetChatFn;
  account?: AccountSummary;
  models: ModelMode[];
  workspace?: WorkspaceSummary | null;
  home?: HomePayload | null;
  onHome?: (home: HomePayload) => void;
  refreshHome?: RefreshFn;
};

export function HomeSurface({
  error,
  navigate,
  refreshWorkspace,
  onAsk,
  account,
  models,
  workspace,
  home,
  onHome,
  refreshHome,
}: HomeSurfaceProps) {
  const projects = workspace?.projects || [];
  const chats = workspace?.chats || [];
  const recentRuns = ((home?.runs || []) as RunRecord[]).slice(0, 4);
  const recentArtifacts = recentRuns.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run }))).slice(0, 4) as ArtifactRecord[];
  const recentSessions = chats.flatMap((project) => (project.sessions || []).map((session) => ({ ...session, projectPath: project.path, projectTitle: project.title }))).slice(0, 4);

  return (
    <section className={styles.surface}>
      <div className={styles.hero}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Local AI Workbench</p>
          <h1>오늘 이어서 작업</h1>
          <p>프로젝트 폴더, 파일 컨텍스트, Workflow App, Run, Artifact를 한 곳에서 이어감.</p>
          <div className={styles.actions}>
            <button className={styles.primary} type="button" onClick={() => navigate("/new")}>새 채팅</button>
            <button type="button" onClick={() => navigate("/projects")}>프로젝트 열기</button>
            <button type="button" onClick={() => navigate("/apps-tools")}>Workflow Apps</button>
            <button type="button" onClick={() => navigate("/artifacts")}>산출물</button>
          </div>
        </div>
        <div className={styles.commandPanel}>
          <StartPane
            error={error}
            navigate={navigate}
            refreshWorkspace={refreshWorkspace}
            onAsk={onAsk}
            account={account}
            models={models}
            workspace={workspace || undefined}
            home={home}
            onHome={onHome}
            refreshHome={refreshHome}
          />
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Projects</p>
              <h2>최근 프로젝트</h2>
            </div>
            <button type="button" onClick={() => navigate("/projects")}>전체 보기</button>
          </div>
          <div className={styles.cards}>
            {projects.slice(0, 4).map((project) => <ProjectCard key={project.path} project={project} onOpen={navigate} />)}
            {projects.length === 0 && <div className={styles.empty}>아직 프로젝트 없음. 새 프로젝트를 만들고 파일을 연결.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Sessions</p>
              <h2>최근 채팅</h2>
            </div>
            <button type="button" onClick={() => navigate("/new")}>새 채팅</button>
          </div>
          <div className={styles.cards}>
            {recentSessions.map((session) => <SessionCard key={`${session.projectPath}-${session.slug}`} session={session} onOpen={navigate} />)}
            {recentSessions.length === 0 && <div className={styles.empty}>질문을 시작하면 여기에 work thread가 남음.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Runs</p>
              <h2>최근 실행</h2>
            </div>
            <button type="button" onClick={() => navigate("/runs")}>전체 보기</button>
          </div>
          <div className={styles.cards}>
            {recentRuns.map((run) => <RunCard key={run.run_id} run={run} />)}
            {recentRuns.length === 0 && <div className={styles.empty}>Workflow App이나 산출물 생성 실행이 여기에 표시됨.</div>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Artifacts</p>
              <h2>최근 산출물</h2>
            </div>
            <button type="button" onClick={() => navigate("/artifacts")}>전체 보기</button>
          </div>
          <div className={styles.cards}>
            {recentArtifacts.map((artifact) => <ArtifactCard key={artifact.path} artifact={artifact} />)}
            {recentArtifacts.length === 0 && <div className={styles.empty}>다운로드 가능한 report, CSV, JSON, chart가 생성되면 보임.</div>}
          </div>
        </section>
      </div>
    </section>
  );
}
