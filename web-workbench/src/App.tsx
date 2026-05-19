import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import type { ArtifactRecord, ChatPayload, ContextReceipt, ProjectConfigPayload, ProjectSummary, RunRecord, SessionSummary } from "./api/types";
import { Badge, Button, Card, EmptyState } from "./components/Primitives";
import "./App.css";

type Route =
  | { kind: "home" }
  | { kind: "projects" }
  | { kind: "project"; projectPath: string }
  | { kind: "chat"; projectPath: string; sessionSlug: string }
  | { kind: "runs" }
  | { kind: "artifacts" }
  | { kind: "apps" }
  | { kind: "settings" };

function parseRoute(): Route {
  const path = window.location.pathname.replace(/^\/new-ui\/?/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { kind: "home" };
  if (parts[0] === "projects") return { kind: "projects" };
  if (parts[0] === "project") return { kind: "project", projectPath: parts.slice(1).join("/") };
  if (parts[0] === "chat" && parts.length >= 3) return { kind: "chat", projectPath: parts.slice(1, -1).join("/"), sessionSlug: parts.at(-1) || "" };
  if (parts[0] === "runs") return { kind: "runs" };
  if (parts[0] === "artifacts") return { kind: "artifacts" };
  if (parts[0] === "apps") return { kind: "apps" };
  if (parts[0] === "settings") return { kind: "settings" };
  return { kind: "home" };
}

function appPath(path: string): string {
  return `/new-ui${path === "/" ? "" : path}`;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const home = useQuery({ queryKey: ["home"], queryFn: api.home });
  const account = workspace.data?.account;
  const activeModel = account?.model_catalog?.find((item) => item.available !== false) || account?.model_catalog?.[0];

  function navigate(path: string) {
    window.history.pushState({}, "", appPath(path));
    setRoute(parseRoute());
  }

  window.onpopstate = () => setRoute(parseRoute());

  return (
    <div className="app">
      <TopBar route={route} model={activeModel?.label || activeModel?.model || "Model ready"} />
      <Sidebar workspace={workspace.data} route={route} navigate={navigate} />
      <main className="main">
        {workspace.isLoading && <section className="surface"><EmptyState title="AIWS 로딩 중" body="워크스페이스와 로컬 런타임 상태를 불러오는 중." /></section>}
        {workspace.error && <section className="surface"><EmptyState title="워크스페이스 로드 실패" body={String(workspace.error)} /></section>}
        {workspace.data && (
          <>
            {route.kind === "home" && <HomeSurface workspace={workspace.data} home={home.data} navigate={navigate} />}
            {route.kind === "projects" && <ProjectsSurface projects={workspace.data.projects} navigate={navigate} />}
            {route.kind === "project" && <ProjectSurface projectPath={route.projectPath} project={workspace.data.projects.find((project) => project.path === route.projectPath)} navigate={navigate} />}
            {route.kind === "chat" && <ChatSurface projectPath={route.projectPath} sessionSlug={route.sessionSlug} />}
            {route.kind === "runs" && <RunsSurface />}
            {route.kind === "artifacts" && <ArtifactsSurface />}
            {route.kind === "apps" && <AppsSurface workspace={workspace.data} navigate={navigate} />}
            {route.kind === "settings" && <SettingsSurface accountName={account?.nickname || account?.display_name || account?.username || "local"} />}
          </>
        )}
      </main>
    </div>
  );
}

function TopBar({ route, model }: { route: Route; model: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" />
        <strong>AI Workbench Studio</strong>
        <span className="scope">{route.kind === "home" ? "Cockpit" : route.kind}</span>
      </div>
      <div className="topStatus">
        <Badge>{model}</Badge>
        <Badge tone="local">Local-first</Badge>
        <Badge tone="success">traceable</Badge>
      </div>
    </header>
  );
}

function Sidebar({ workspace, route, navigate }: { workspace?: { account?: { username?: string; nickname?: string; display_name?: string }; projects?: ProjectSummary[]; chats?: ProjectSummary[] }; route: Route; navigate: (path: string) => void }) {
  const sessions = (workspace?.chats || []).flatMap((project) => (project.sessions || []).map((session) => ({ ...session, projectPath: project.path, projectTitle: project.title }))).slice(0, 10);
  return (
    <aside className="sidebar">
      <div className="user">
        <span className="avatar">{(workspace?.account?.nickname || workspace?.account?.username || "K").slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{workspace?.account?.nickname || workspace?.account?.display_name || workspace?.account?.username || "Local user"}</strong>
          <div className="scope">Private AI cockpit</div>
        </div>
      </div>
      <nav className="navSection">
        <NavButton active={route.kind === "home"} onClick={() => navigate("/")}>Home</NavButton>
        <NavButton active={route.kind === "projects"} onClick={() => navigate("/projects")}>Projects</NavButton>
        <NavButton active={route.kind === "apps"} onClick={() => navigate("/apps")}>Workflow Apps</NavButton>
        <NavButton active={route.kind === "runs"} onClick={() => navigate("/runs")}>Runs</NavButton>
        <NavButton active={route.kind === "artifacts"} onClick={() => navigate("/artifacts")}>Artifacts</NavButton>
        <NavButton active={route.kind === "settings"} onClick={() => navigate("/settings")}>Settings</NavButton>
      </nav>
      <div className="sectionTitle">Projects</div>
      <div className="navSection">
        {(workspace?.projects || []).filter((project) => !project.hidden).slice(0, 8).map((project) => (
          <NavButton key={project.path} active={route.kind === "project" && route.projectPath === project.path} onClick={() => navigate(`/project/${project.path}`)}>
            <span>{project.title || project.path}</span>
            <small>{project.sessions?.length || 0}</small>
          </NavButton>
        ))}
      </div>
      <div className="sectionTitle">Recent sessions</div>
      <div className="navSection">
        {sessions.map((session) => (
          <NavButton key={`${session.projectPath}-${session.slug}`} active={route.kind === "chat" && route.sessionSlug === session.slug} onClick={() => navigate(`/chat/${session.projectPath}/${session.slug}`)}>
            <span>{session.title || session.slug}</span>
          </NavButton>
        ))}
      </div>
    </aside>
  );
}

function NavButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`navItem ${active ? "active" : ""}`} onClick={onClick}>{children}</button>;
}

function HomeSurface({ workspace, home, navigate }: { workspace: { projects: ProjectSummary[]; chats: ProjectSummary[] }; home?: { runs?: RunRecord[] }; navigate: (path: string) => void }) {
  const runs = (home?.runs || []).slice(0, 4);
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run_id: run.run_id }))).slice(0, 4);
  return (
    <section className="surface">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Local AI workflow desk</p>
          <h1>오늘 할 일을 이어서</h1>
          <p>Project, Session, Run, Artifact, Context Receipt가 서로 연결된 새 Workbench UI.</p>
        </div>
      </div>
      <div className="quickGrid">
        <button className="workCard" onClick={() => navigate("/projects")}><strong>프로젝트 열기</strong><span>폴더와 aiws.yaml 기반 작업대</span></button>
        <button className="workCard" onClick={() => navigate("/apps")}><strong>Workflow App 실행</strong><span>입력 → Run → Artifact → Viewer</span></button>
        <button className="workCard" onClick={() => navigate("/artifacts")}><strong>산출물 보기</strong><span>보고서, 표, JSON, 차트</span></button>
      </div>
      <ObjectSection title="최근 프로젝트">
        {workspace.projects.filter((project) => !project.hidden).slice(0, 6).map((project) => <WorkCard key={project.path} title={project.title} meta={`${project.sessions?.length || 0} chats · ${project.visibility || "private"}`} onClick={() => navigate(`/project/${project.path}`)} />)}
      </ObjectSection>
      <ObjectSection title="최근 실행">
        {runs.map((run) => <WorkCard key={run.run_id} title={run.label || run.action_label || run.command || run.action_id || "Run"} meta={`${run.status || "unknown"} · ${run.artifacts?.length || 0} artifacts`} onClick={() => navigate("/runs")} />)}
      </ObjectSection>
      <ObjectSection title="최근 산출물">
        {artifacts.map((artifact) => <WorkCard key={`${artifact.run_id}-${artifact.path}`} title={artifact.path.split("/").pop() || artifact.path} meta={artifact.viewer_type || artifact.type || "artifact"} onClick={() => navigate("/artifacts")} />)}
      </ObjectSection>
    </section>
  );
}

function ProjectsSurface({ projects, navigate }: { projects: ProjectSummary[]; navigate: (path: string) => void }) {
  return (
    <section className="surface">
      <div className="pageHeader"><div><p className="eyebrow">Projects</p><h1>프로젝트 작업대</h1><p>각 프로젝트는 로컬 폴더, 파일 컨텍스트, 세션, Run, Artifact를 가짐.</p></div></div>
      <div className="projectGrid">
        {projects.filter((project) => !project.hidden).map((project) => <WorkCard key={project.path} title={project.title} meta={`${project.path} · ${project.sessions?.length || 0} chats`} onClick={() => navigate(`/project/${project.path}`)} />)}
      </div>
    </section>
  );
}

function ProjectSurface({ projectPath, project, navigate }: { projectPath: string; project?: ProjectSummary; navigate: (path: string) => void }) {
  const projectQuery = useQuery({ queryKey: ["project", projectPath], queryFn: () => api.projectConfig(projectPath), enabled: Boolean(projectPath) });
  const config = projectQuery.data?.config || {};
  const runs = projectQuery.data?.runs || [];
  const commands = Object.entries(config.commands || {});
  const artifacts = runs.flatMap((run) => run.artifacts || []);
  return (
    <section className="surface">
      <div className="projectHero">
        <p className="eyebrow">Project Workbench</p>
        <h1>{config.name || project?.title || projectPath}</h1>
        <p>{config.description || "프로젝트 자료를 바탕으로 묻고, 실행하고, 산출물을 남김."}</p>
        <div className="chipRow"><Badge tone="local">local-first</Badge><Badge>{runs.length} runs</Badge><Badge>{artifacts.length} artifacts</Badge><Badge>{commands.length} actions</Badge></div>
      </div>
      <div className="projectLayout">
        <div>
          <ChatStarter projectPath={projectPath} onOpenChat={(session) => navigate(`/chat/${session.project_path || projectPath}/${session.slug}`)} />
          <div className="tabs">
            <Button>Overview</Button><Button>Files</Button><Button>Actions</Button><Button>Runs</Button><Button>Artifacts</Button>
          </div>
          <ObjectSection title="Executable actions">
            {commands.map(([id, command]) => <WorkCard key={id} title={String(command.label || id)} meta={`${command.kind || "action"} · ${command.description || "aiws.yaml command"}`} onClick={() => navigate("/apps")} />)}
            {!commands.length && <EmptyState title="아직 Action 없음" body="aiws.yaml에 prompt_recipe, shell, python, workflow_app을 추가하면 여기에 표시됨." />}
          </ObjectSection>
          <ObjectSection title="Recent runs">
            {runs.slice(0, 6).map((run) => <WorkCard key={run.run_id} title={run.label || run.action_label || run.command || "Run"} meta={`${run.status || "unknown"} · ${run.created_at || ""}`} onClick={() => navigate("/runs")} />)}
          </ObjectSection>
        </div>
        <aside className="inspector">
          <h2>Context rail</h2>
          <div className="statLine"><span>Include patterns</span><b>{config.context?.include?.length || 0}</b></div>
          <div className="statLine"><span>Exclude patterns</span><b>{config.context?.exclude?.length || 0}</b></div>
          <div className="statLine"><span>Sessions</span><b>{project?.sessions?.length || 0}</b></div>
          <div className="statLine"><span>Runs</span><b>{runs.length}</b></div>
          <div className="statLine"><span>Artifacts</span><b>{artifacts.length}</b></div>
        </aside>
      </div>
    </section>
  );
}

function ChatStarter({ projectPath, onOpenChat }: { projectPath: string; onOpenChat: (session: { slug: string; project_path?: string }) => void }) {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const createChat = useMutation({ mutationFn: () => api.createChat("Project chat") });
  async function submit() {
    const created = await createChat.mutateAsync();
    const form = new FormData();
    form.set("content", content || "이 프로젝트 자료를 기준으로 현재 상태를 요약해줘.");
    form.set("provider", "ollama");
    form.set("model", "qwen3:8b");
    form.set("search_mode", "off");
    if (file) form.append("attachment", file);
    await api.ask(projectPath || created.project_path, created.session.slug, form);
    onOpenChat({ ...created.session, project_path: projectPath || created.project_path });
  }
  return (
    <Card className="chatPanel">
      <div className="composer">
        <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="프로젝트 자료로 무엇을 작업할까요?" />
        <div className="composerBar">
          <div className="composerTools">
            <label className="ui-button ghost">파일 추가<input className="hiddenInput" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
            {file && <Badge>{file.name}</Badge>}
            <Badge tone="local">Qwen local</Badge>
          </div>
          <Button variant="primary" onClick={submit} disabled={createChat.isPending}>{createChat.isPending ? "전송 중" : "보내기"}</Button>
        </div>
      </div>
    </Card>
  );
}

function ChatSurface({ projectPath, sessionSlug }: { projectPath: string; sessionSlug: string }) {
  const query = useQuery({ queryKey: ["chat", projectPath, sessionSlug], queryFn: () => api.chat(projectPath, sessionSlug) });
  return (
    <section className="surface">
      <div className="pageHeader"><div><p className="eyebrow">Session</p><h1>{query.data?.session?.title || sessionSlug}</h1><p>{projectPath}</p></div></div>
      <div className="projectLayout">
        <div className="chatPanel">
          <div className="messageList">
            {(query.data?.messages || []).map((message, index) => <MessageCard key={`${index}-${message.role}`} message={message} />)}
            {!query.data?.messages?.length && <EmptyState title="아직 메시지 없음" body="프로젝트나 홈에서 새 질문을 시작." />}
          </div>
        </div>
        <aside className="inspector">
          <h2>Context used</h2>
          <p className="scope">답변마다 사용 파일, chunks, 비용, local/cloud 상태가 여기에 들어옴.</p>
          {query.data?.messages?.slice().reverse().find((message) => message.context_receipt)?.context_receipt && <Receipt receipt={query.data.messages.slice().reverse().find((message) => message.context_receipt)?.context_receipt} />}
        </aside>
      </div>
    </section>
  );
}

function MessageCard({ message }: { message: { role: string; content?: string; provider?: string; model?: string; estimated_cost?: number; context_receipt?: ContextReceipt } }) {
  return (
    <article className={`message ${message.role === "assistant" ? "assistant" : ""}`}>
      <div className="messageMeta"><strong>{message.role}</strong>{message.provider && <span>{message.provider} · {message.model}</span>}{typeof message.estimated_cost === "number" && <span>USD {message.estimated_cost}</span>}</div>
      <div className="messageContent">{message.content || ""}</div>
      {message.context_receipt && <Receipt receipt={message.context_receipt} />}
    </article>
  );
}

function Receipt({ receipt }: { receipt?: ContextReceipt }) {
  if (!receipt) return null;
  const files = Array.isArray(receipt.files_used) ? receipt.files_used.length : Array.isArray(receipt.included_files) ? receipt.included_files.length : 0;
  const chunks = Array.isArray(receipt.included_chunks) ? receipt.included_chunks.length : 0;
  const cost = receipt.estimated_cost_usd ?? receipt.estimated_cost ?? 0;
  return <div className="receipt">Context Receipt · {receipt.local ? "local" : receipt.cloud ? "cloud" : receipt.provider || "model"} · {files} files · {chunks} chunks · USD {String(cost)}</div>;
}

function RunsSurface() {
  const [q, setQ] = useState("");
  const runs = useQuery({ queryKey: ["runs", q], queryFn: () => api.runs(q ? `?q=${encodeURIComponent(q)}` : "") });
  return <BrowserSurface title="Runs" eyebrow="Traceable executions" q={q} setQ={setQ}>{runs.data?.runs.map((run) => <WorkCard key={run.run_id} title={run.label || run.action_label || run.command || "Run"} meta={`${run.status || "unknown"} · ${run.created_at || ""}`} />)}</BrowserSurface>;
}

function ArtifactsSurface() {
  const [q, setQ] = useState("");
  const artifacts = useQuery({ queryKey: ["artifacts", q], queryFn: () => api.artifacts(q ? `?q=${encodeURIComponent(q)}` : "") });
  return <BrowserSurface title="Artifacts" eyebrow="Durable outputs" q={q} setQ={setQ}>{artifacts.data?.artifacts.map((artifact) => <WorkCard key={artifact.path} title={artifact.path.split("/").pop() || artifact.path} meta={`${artifact.viewer_type || artifact.type || "artifact"} · ${artifact.projectTitle || artifact.projectPath || "workspace"}`} />)}</BrowserSurface>;
}

function BrowserSurface({ title, eyebrow, q, setQ, children }: { title: string; eyebrow: string; q: string; setQ: (value: string) => void; children: React.ReactNode }) {
  return <section className="surface"><div className="pageHeader"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search" /></div><div className="objectGrid">{children}</div></section>;
}

function AppsSurface({ workspace, navigate }: { workspace: { projects: ProjectSummary[] }; navigate: (path: string) => void }) {
  return (
    <section className="surface">
      <div className="pageHeader"><div><p className="eyebrow">Workflow Apps</p><h1>반복 작업 앱</h1><p>앱은 입력, 실행, Run, Artifact, Viewer를 갖는 프로젝트 기능.</p></div></div>
      <div className="quickGrid">
        <WorkCard title="Investment Advisor" meta="portfolio.csv + target allocation → dashboard artifacts" onClick={() => {
          const project = workspace.projects.find((item) => /investment/i.test(item.path));
          if (project) navigate(`/project/${project.path}`);
        }} />
        <WorkCard title="Document Review" meta="PDF/DOCX/TXT → markdown report" />
        <WorkCard title="File/Table Analysis" meta="CSV/XLSX → profile + table viewer" />
      </div>
    </section>
  );
}

function SettingsSurface({ accountName }: { accountName: string }) {
  return <section className="surface"><div className="pageHeader"><div><p className="eyebrow">Settings</p><h1>설정</h1><p>{accountName} · 모델, 로컬 런타임, 비용, 테마, 보안 설정.</p></div></div><EmptyState title="새 UI 설정면" body="기존 Settings API는 유지. 새 프론트의 route-level 설정 화면은 여기서 확장." /></section>;
}

function ObjectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="section"><div className="sectionHead"><h2>{title}</h2></div><div className="objectGrid">{children}</div></section>;
}

function WorkCard({ title, meta, onClick }: { title: string; meta?: string; onClick?: () => void }) {
  return <button type="button" className="workCard" onClick={onClick}><strong>{title}</strong><span>{meta}</span></button>;
}
