import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { AutomationPanel, ProjectActionsPanel } from "./components/actions/ActionPanels.jsx";
import "./styles.css";

const DEFAULT_MODEL = "qwen3:4b";
const MODEL_MODES = [
  {
    value: "local",
    label: "빠른 로컬 AI",
    legacyLabel: "Local only",
    short: "빠른 로컬 AI",
    provider: "ollama",
    model: "qwen3:4b",
    cloud: false,
    inputPrice: 0,
    outputPrice: 0,
    cost: "무료 · 내 Mac에서 처리",
    easyPrice: "무료 · 내 Mac에서 처리",
    privacy: "내 Mac에서 처리",
    bestFor: "짧은 질문, 메모, 일상 대화",
  },
  {
    value: "cheap",
    label: "Gemini Flash-Lite",
    legacyLabel: "Cheap cloud",
    short: "Gemini Flash-Lite",
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    cloud: true,
    inputPrice: 0.10,
    outputPrice: 0.40,
    cost: "~$0.10/M in · ~$0.40/M out",
    easyPrice: "매우 저렴 · 빠른 클라우드",
    privacy: "클라우드 AI",
    bestFor: "일반 질문, 빠른 요약, 저비용 작업",
  },
  {
    value: "gemini-pro",
    label: "Gemini Pro",
    short: "Gemini Pro",
    provider: "gemini",
    model: "gemini-2.5-pro",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "정확도 높음 · 비용 있음",
    privacy: "클라우드 AI",
    bestFor: "복잡한 질문, 긴 글, 정확도가 필요한 작업",
  },
  {
    value: "smart",
    label: "Kimi",
    legacyLabel: "Smart cloud",
    short: "Kimi",
    provider: "kimi",
    model: "kimi-k2.6",
    cloud: true,
    inputPrice: 0.75,
    outputPrice: 3.50,
    cost: "~$0.75/M in · ~$3.50/M out",
    easyPrice: "긴 문서 특화 · 비용 있음",
    privacy: "클라우드 AI",
    bestFor: "긴 문서, 긴 컨텍스트, 분석",
  },
  {
    value: "kimi-thinking",
    label: "Kimi Thinking",
    legacyLabel: "Kimi thinking",
    short: "Kimi Thinking",
    provider: "kimi",
    model: "kimi-k2-thinking",
    cloud: true,
    inputPrice: 0.60,
    outputPrice: 2.50,
    cost: "~$0.60/M in · ~$2.50/M out",
    easyPrice: "깊은 추론 · 조금 느림",
    privacy: "클라우드 AI",
    bestFor: "깊은 추론, 긴 분석",
  },
  {
    value: "coding",
    label: "OpenAI Codex",
    legacyLabel: "Coding expensive",
    short: "OpenAI Codex",
    provider: "openai",
    model: "gpt-5.1-codex",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "코딩 특화 · 비용 있음",
    privacy: "클라우드 AI",
    bestFor: "코드 수정, 리팩토링, 개발 작업",
  },
];
const SEARCH_OPTIONS = [
  { value: "off", label: "Search off" },
  { value: "auto", label: "로컬 컨텍스트 우선", legacyLabel: "Local context only" },
  { value: "always", label: "Search web (준비 중)" },
];

function apiPath(path) {
  return path;
}

async function fetchJson(path, options) {
  const response = await fetch(apiPath(path), {
    headers: { Accept: "application/json", ...csrfHeader(), ...(options?.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 240) || `Request returned non-JSON response (${response.status}).`);
    }
  }
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function csrfHeader() {
  const token = getCookie("aiws_csrf");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

function getCookie(name) {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function savedModelMode() {
  const value = decodeURIComponent(getCookie("aiws_model_mode") || "local");
  return MODEL_MODES.some((item) => item.value === value) ? value : "local";
}

function savedSearchMode() {
  const value = decodeURIComponent(getCookie("aiws_search_mode") || "auto");
  return SEARCH_OPTIONS.some((item) => item.value === value) ? value : "auto";
}

function App() {
  const [workspace, setWorkspace] = useState(null);
  const [chat, setChat] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [openclaw, setOpenclaw] = useState(null);
  const [automations, setAutomations] = useState([]);
  const [projectConfig, setProjectConfig] = useState(null);
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => getCookie("aiws_sidebar_open") !== "0");
  const isLogin = activePath.view === "login";

  async function refreshWorkspace() {
    setWorkspace(await fetchJson("/api/workspace"));
  }

  async function refreshChat(target = activePath) {
    if (!target.projectPath || !target.sessionSlug) {
      setChat(null);
      return;
    }
    setChat(await fetchJson(`/api/chat/${target.projectPath}/${target.sessionSlug}`));
  }

  async function refreshRuntime() {
    const payload = await fetchJson("/api/runtime");
    setRuntime(payload.runtime);
  }

  async function refreshOpenclaw() {
    const payload = await fetchJson("/api/openclaw");
    setOpenclaw(payload.openclaw);
  }

  async function refreshAutomations() {
    const payload = await fetchJson("/api/automations");
    setAutomations(payload.projects || []);
  }

  async function refreshProjectConfig(target = activePath) {
    if (!target.projectPath) {
      setProjectConfig(null);
      return;
    }
    const payload = await fetchJson(`/api/project-config/${target.projectPath}`);
    setProjectConfig(payload);
  }

  useEffect(() => {
    if (isLogin) return;
    refreshWorkspace().catch((err) => setError(err.message));
    refreshRuntime().catch(() => {});
    refreshOpenclaw().catch(() => {});
    refreshAutomations().catch(() => {});
    const id = window.setInterval(() => refreshRuntime().catch(() => {}), 15000);
    const clawId = window.setInterval(() => refreshOpenclaw().catch(() => {}), 12000);
    const automationId = window.setInterval(() => refreshAutomations().catch(() => {}), 20000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(clawId);
      window.clearInterval(automationId);
    };
  }, [isLogin]);

  useEffect(() => {
    if (isLogin) return;
    refreshChat(activePath).catch((err) => setError(err.message));
    refreshProjectConfig(activePath).catch(() => setProjectConfig(null));
  }, [isLogin, activePath.projectPath, activePath.sessionSlug]);

  useEffect(() => {
    function onPop() {
      setActivePath(parseRoute());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setActivePath(parseRoute(path));
  }

  async function afterAsk(payload) {
    setChat((current) => (typeof payload === "function" ? payload(current) : payload));
    refreshWorkspace().catch(() => {});
  }

  function toggleContext() {
    setContextOpen((value) => !value);
  }

  function toggleSidebar() {
    setSidebarOpen((value) => {
      const next = !value;
      setCookie("aiws_sidebar_open", next ? "1" : "0");
      return next;
    });
  }

  if (isLogin) {
    return (
      <div className="app-shell auth-shell">
        <LoginPage />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        runtime={runtime}
        account={workspace?.account}
        activePath={activePath}
        chat={chat}
        contextOpen={contextOpen}
        onToggleContext={toggleContext}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
      <main className={`layout ${contextOpen ? "with-workbench" : "no-workbench"} ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <Sidebar
          workspace={workspace}
          activePath={activePath}
          navigate={navigate}
          onRefresh={refreshWorkspace}
          automations={automations}
          onAutomations={setAutomations}
        />
        <CenterPane
          chat={chat}
          activePath={activePath}
          account={workspace?.account}
          projects={workspace?.projects || []}
          onAsk={afterAsk}
          onPreview={setLightbox}
          error={error}
          navigate={navigate}
          refreshWorkspace={refreshWorkspace}
          contextOpen={contextOpen}
          onToggleContext={toggleContext}
        />
        <ContextPanel
          chat={chat}
          activePath={activePath}
          runtime={runtime}
          openclaw={openclaw}
          automations={automations}
          projectConfig={projectConfig}
          onProjectConfig={setProjectConfig}
          onAutomations={setAutomations}
          onPreview={setLightbox}
          onChat={setChat}
          account={workspace?.account}
        />
      </main>
      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function TopBar({ runtime, account, activePath, chat, contextOpen, onToggleContext, sidebarOpen, onToggleSidebar }) {
  const [open, setOpen] = useState(false);
  const url = runtime?.cloudflare_url || "";
  const power = isPowerMode(account);
  const context = activePath?.sessionSlug ? (chat?.project?.hidden ? "General chat" : `${chat?.project?.title || "Project"} / ${chat?.session?.title || activePath.sessionSlug}`) : "Private AI Cockpit";
  return (
    <header className="topbar">
      <button className="sidebar-toggle" type="button" onClick={onToggleSidebar} aria-label={sidebarOpen ? "사이드바 닫기" : "사이드바 열기"} aria-pressed={sidebarOpen}>
        <span />
        <span />
        <span />
      </button>
      <a className="brand" href="/">
        <span className="brand-mark" /> Assistant
      </a>
      <span className="local-badge">Local-first</span>
      <span className="top-context">{context}</span>
      <span className={`mode-icon ${power ? "power" : "easy"}`} title={power ? "Power mode" : "Easy mode"} aria-label={power ? "Power mode" : "Easy mode"}>
        <span />
      </span>
      <button className={`context-toggle icon-only ${contextOpen ? "active" : ""}`} type="button" onClick={onToggleContext} aria-label={contextOpen ? "파일과 기억 닫기" : "파일과 기억 열기"} aria-pressed={contextOpen}>
        <span />
        <i />
      </button>
      <button
        className={`runtime-pill ${power ? "" : "dot-only"}`}
        type="button"
        onClick={() => power && setOpen(!open)}
        aria-label={power ? `Runtime ${runtime?.status || "local"}` : "연결됨"}
        aria-expanded={open}
      >
        <span className="status-lamp" />{power ? (runtime?.status || "local") : ""}
      </button>
      {power && open && (
        <div className="runtime-popover">
          <strong>Runtime</strong>
          <p>{runtime?.status || "local"}</p>
          {url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span>No public tunnel URL.</span>}
          <code>aiws-cloudflare status</code>
        </div>
      )}
    </header>
  );
}

function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const hasError = params.get("error");
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <a className="brand login-brand" href="/">
          <span className="brand-mark" /> Assistant
        </a>
        <div>
          <p className="eyebrow">Private workspace</p>
          <h1 id="login-title">개인 AI 작업실</h1>
          <p className="login-copy">대화, 프로젝트, 파일을 안전하게 이어가는 로컬 우선 AI 비서입니다.</p>
        </div>
        {hasError && <div className="system-note compact">사용자 이름 또는 비밀번호가 올바르지 않습니다.</div>}
        <form className="login-form" method="post" action="/login">
          <input type="hidden" name="_csrf" value={document.cookie.split("; ").find((item) => item.startsWith("aiws_csrf="))?.split("=")[1] || ""} />
          <label>
            <span>사용자 이름</span>
            <input name="username" autoComplete="username" autoFocus />
          </label>
          <label>
            <span>비밀번호</span>
            <input type="password" name="password" autoComplete="current-password" />
          </label>
          <button className="primary-button" type="submit">로그인</button>
        </form>
      </section>
      <aside className="login-aside">
        <div className="status-card">
          <span className="status-lamp" />
          <strong>Local-first</strong>
          <p>Mac mini에서 실행되고 대화와 파일은 내 워크스페이스에 저장됩니다.</p>
        </div>
        <div className="status-card">
          <strong>가족 계정 지원</strong>
          <p>필요한 사람에게만 접근을 열고 프로젝트 기억을 함께 관리합니다.</p>
        </div>
      </aside>
    </main>
  );
}

function Sidebar({ workspace, activePath, navigate, onRefresh, automations = [], onAutomations }) {
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const projects = workspace?.projects || [];
  const chats = workspace?.chats || [];
  const account = workspace?.account || { username: "local", nickname: "Kwanho Kim", display_name: "Kwanho Kim", profile: {} };
  const activeIsGeneralChat = chats.some((project) => project.path === activePath.projectPath);
  const today = new Date().toISOString().slice(0, 10);
  const allChatSessions = chats.flatMap((project) => project.sessions.map((session) => ({ ...session, projectPath: project.path })));
  const needle = query.trim().toLowerCase();
  const matchesChat = (session) => !needle || `${session.title} ${session.projectPath}`.toLowerCase().includes(needle);
  const todayChats = allChatSessions.filter((session) => session.created_at?.slice(0, 10) === today && matchesChat(session));
  const recentChats = allChatSessions.filter((session) => session.created_at?.slice(0, 10) !== today && matchesChat(session)).slice(0, 8);
  const sharedProjects = projects.filter((project) => project.visibility === "public");
  const privateProjects = projects.filter((project) => project.visibility !== "public");
  const filtered = useMemo(() => {
    if (!needle) return projects;
    return projects.filter((project) =>
      `${project.title} ${project.path} ${project.sessions.map((s) => s.title).join(" ")}`.toLowerCase().includes(needle)
    );
  }, [projects, query]);
  const hasSearchResults = !needle || todayChats.length > 0 || recentChats.length > 0 || filtered.length > 0;
  const ownedProjects = ownerProjects(projects, account);

  async function refreshAndStay() {
    await onRefresh?.();
  }

  async function moveSession(projectPath, sessionSlug, targetProjectPath) {
    const payload = await fetchJson(`/api/move-chat/${projectPath}/${sessionSlug}`, {
      method: "POST",
      body: new URLSearchParams({ target_project: targetProjectPath }),
    });
    await refreshAndStay();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  function dragSession(event, projectPath, sessionSlug) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-aiws-session", JSON.stringify({ projectPath, sessionSlug }));
  }

  async function dropOnProject(event, projectPath) {
    const raw = event.dataTransfer.getData("application/x-aiws-session");
    if (!raw) return;
    event.preventDefault();
    const source = JSON.parse(raw);
    if (source.projectPath === projectPath) return;
    await moveSession(source.projectPath, source.sessionSlug, projectPath);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-account">
        <button className="account-button" type="button" onClick={() => setSettingsOpen(true)}>
          {account.avatar_url ? <img src={account.avatar_url} alt="" /> : <span>{initials(account.display_name || account.username)}</span>}
          <strong>{account.display_name || account.username}</strong>
        </button>
      </div>
      <section className="sidebar-actions">
        <NewGeneralChatForm onCreated={(path) => navigate(path)} />
        <button className="secondary-action" type="button" onClick={() => setProjectOpen(true)}>새 프로젝트</button>
        {activePath.projectPath && !activeIsGeneralChat && <NewSessionForm projectPath={activePath.projectPath} onCreated={(path) => navigate(path)} />}
      </section>
      <label className="visually-hidden" htmlFor="workspace-search">Search workspace</label>
      <div className="search-row">
        <input id="workspace-search" className="search-box" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="대화 제목 검색" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기">×</button>}
      </div>
      <nav className="project-tree" aria-label="Workspace">
        {!workspace && <div className="empty-card">Loading workspace...</div>}
        {!hasSearchResults && <div className="empty-card compact-empty">검색 결과가 없습니다.</div>}
        <ChatSection
          title={needle ? "검색 결과 - 오늘" : "오늘"}
          sessions={todayChats}
          activePath={activePath}
          navigate={navigate}
          query={query}
          projects={ownedProjects}
          onRefresh={refreshAndStay}
          onDragSession={dragSession}
          onMoveSession={moveSession}
        />
        <ChatSection
          title={needle ? "검색 결과 - 최근" : "최근 대화"}
          sessions={recentChats}
          activePath={activePath}
          navigate={navigate}
          query={query}
          projects={ownedProjects}
          onRefresh={refreshAndStay}
          onDragSession={dragSession}
          onMoveSession={moveSession}
        />
        {workspace && privateProjects.length > 0 && <div className="tree-heading"><span>프로젝트</span></div>}
        {workspace && projects.length === 0 && (
          <div className="empty-card">
            <strong>No projects yet.</strong>
            <p>Projects hold sessions, skills, files, and context.</p>
          </div>
        )}
        {filtered.filter((project) => project.visibility !== "public").map((project) => (
          <ProjectNode
            key={project.path}
            project={project}
            activePath={activePath}
            navigate={navigate}
            projects={ownedProjects}
            onRefresh={refreshAndStay}
            onDragSession={dragSession}
            onMoveSession={moveSession}
            onDropOnProject={dropOnProject}
          />
        ))}
        {sharedProjects.length > 0 && <div className="tree-heading"><span>가족 공유</span></div>}
        {sharedProjects.map((project) => (
          <ProjectNode
            key={project.path}
            project={project}
            activePath={activePath}
            navigate={navigate}
            projects={ownedProjects}
            onRefresh={refreshAndStay}
            onDragSession={dragSession}
            onMoveSession={moveSession}
            onDropOnProject={dropOnProject}
          />
        ))}
        {account?.admin && automations.length > 0 && (
          <section className="tree-section local-jobs-section">
            <h2><span>작업 레시피</span></h2>
            {automations.map((project) => (
              <LocalJobItem key={project.slug} project={project} onAutomations={onAutomations} />
            ))}
          </section>
        )}
        <div className="tree-heading archive-heading"><span>보관함</span></div>
      </nav>
      {settingsOpen && <SettingsModal account={account} onClose={() => setSettingsOpen(false)} onSaved={onRefresh} />}
      {projectOpen && <NewProjectModal onClose={() => setProjectOpen(false)} onCreated={(project) => { setProjectOpen(false); onRefresh(); navigate(`/project/${project.path}`); }} />}
    </aside>
  );
}

function LocalJobItem({ project, onAutomations }) {
  const [running, setRunning] = useState(false);
  const latest = project.latest_run;
  async function run() {
    if (running) return;
    setRunning(true);
    try {
      const payload = await fetchJson(`/api/automations/${project.slug}/run`, { method: "POST", body: new URLSearchParams() });
      onAutomations?.(payload.projects || []);
    } finally {
      setRunning(false);
    }
  }
  return (
    <div className="local-job-row">
      <div>
        <strong>{project.title}</strong>
        <small>{project.category || project.kind}</small>
        <small>{latest ? `${latest.status} · ${formatDate(latest.created_at)}` : "아직 실행 전"}</small>
      </div>
      <button type="button" onClick={run} disabled={running}>{running ? "..." : "실행"}</button>
    </div>
  );
}

function ownerProjects(projects, account) {
  const username = account?.username || "local";
  return (projects || []).filter((project) => !project.hidden && (project.owner ? project.owner === username : username === "local"));
}

function ChatSection({ title, sessions, activePath, navigate, query = "", projects, onRefresh, onDragSession, onMoveSession }) {
  if (!sessions.length) return null;
  return (
    <section className="tree-section compact-section">
      <h2><span>{title}</span></h2>
      {sessions.map((session) => (
        <div
          key={`${session.projectPath}/${session.slug}`}
          className="tree-item-row"
          draggable
          onDragStart={(event) => onDragSession(event, session.projectPath, session.slug)}
        >
          <button
            type="button"
            className={`session-slip general ${session.projectPath === activePath.projectPath && session.slug === activePath.sessionSlug ? "active" : ""}`}
            onClick={() => navigate(`/chat/${session.projectPath}/${session.slug}`)}
          >
            <span>{highlightText(session.title, query)}</span>
            <small>{session.created_at?.slice(0, 10) || "chat"}</small>
          </button>
          <ItemOptions
            kind="session"
            projectPath={session.projectPath}
            sessionSlug={session.slug}
            title={session.title}
            isGeneral
            projects={projects}
            navigate={navigate}
            onRefresh={onRefresh}
            onMoveSession={onMoveSession}
          />
        </div>
      ))}
    </section>
  );
}

function highlightText(value, query) {
  const text = String(value || "");
  const needle = query.trim();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function initials(value) {
  return String(value || "A").trim().slice(0, 1).toUpperCase();
}

function ProjectNode({ project, activePath, navigate, projects, onRefresh, onDragSession, onMoveSession, onDropOnProject }) {
  const owned = projects.some((item) => item.path === project.path);
  return (
    <div className={`project-node level-${project.level}`}>
      <div
        className="tree-item-row project-row"
        onDragOver={(event) => owned && event.preventDefault()}
        onDrop={(event) => owned && onDropOnProject(event, project.path)}
      >
        <button
          type="button"
          className={`folder-card ${project.path === activePath.projectPath ? "active" : ""}`}
          onClick={() => navigate(project.firstSessionUrl || `/project/${project.path}`)}
        >
          <span>{project.title}</span>
          <small>{project.owner_display || project.owner || "Kwanho Kim"} · {project.created_at?.slice(0, 10) || "local"}</small>
        </button>
        {owned && <ItemOptions kind="project" projectPath={project.path} title={project.title} navigate={navigate} onRefresh={onRefresh} />}
      </div>
      <div className="session-list">
        {project.sessions.map((session) => (
          <div
            key={session.slug}
            className="tree-item-row"
            draggable
            onDragStart={(event) => onDragSession(event, project.path, session.slug)}
          >
            <button
              type="button"
              className={`session-slip ${project.path === activePath.projectPath && session.slug === activePath.sessionSlug ? "active" : ""}`}
              onClick={() => navigate(`/chat/${project.path}/${session.slug}`)}
            >
              <span>{session.title}</span>
              <small>{session.created_at?.slice(0, 10) || "session"}</small>
            </button>
            {owned && (
              <ItemOptions
                kind="session"
                projectPath={project.path}
                sessionSlug={session.slug}
                title={session.title}
                projects={projects}
                navigate={navigate}
                onRefresh={onRefresh}
                onMoveSession={onMoveSession}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemOptions({ kind, projectPath, sessionSlug, title, isGeneral = false, projects = [], navigate, onRefresh, onMoveSession }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || "");
  const menuRef = useRef(null);
  const targetProjects = projects.filter((project) => project.path !== projectPath);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    }
    function key(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  async function rename() {
    const next = draftTitle.trim();
    if (!next) return;
    if (kind === "project") {
      await fetchJson(`/api/project-title/${projectPath}`, { method: "POST", body: new URLSearchParams({ title: next }) });
    } else {
      await fetchJson(`/api/session-title/${projectPath}/${sessionSlug}`, { method: "POST", body: new URLSearchParams({ title: next }) });
    }
    setRenaming(false);
    setOpen(false);
    await onRefresh?.();
  }

  async function remove() {
    setOpen(false);
    if (!globalThis.confirm(kind === "project" ? "이 프로젝트를 삭제할까요?" : "이 대화를 삭제할까요?")) return;
    if (kind === "project") {
      await fetchJson(`/api/delete-project/${projectPath}`, { method: "POST", body: new URLSearchParams() });
    } else {
      await fetchJson(`/api/delete-session/${projectPath}/${sessionSlug}`, { method: "POST", body: new URLSearchParams() });
    }
    await onRefresh?.();
    navigate("/");
  }

  async function moveToProject(target) {
    setOpen(false);
    if (!target) return;
    await onMoveSession?.(projectPath, sessionSlug, target);
  }

  async function moveOut() {
    setOpen(false);
    const payload = await fetchJson(`/api/move-chat-out/${projectPath}/${sessionSlug}`, { method: "POST", body: new URLSearchParams() });
    await onRefresh?.();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  return (
    <span className="item-options" ref={menuRef}>
      <button className="item-options-button" type="button" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} aria-label="옵션" aria-expanded={open}>
        <span />
        <span />
        <span />
      </button>
      {open && (
        <span className="item-menu" role="menu">
          {renaming ? (
            <form className="mini-menu-form" onSubmit={(event) => { event.preventDefault(); rename(); }}>
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus aria-label={kind === "project" ? "프로젝트 이름" : "대화 제목"} />
              <div>
                <button type="submit">저장</button>
                <button type="button" onClick={() => { setDraftTitle(title || ""); setRenaming(false); }}>취소</button>
              </div>
            </form>
          ) : moving ? (
            <div className="move-menu">
              <strong>옮길 프로젝트</strong>
              {targetProjects.map((project) => (
                <button key={project.path} type="button" onClick={() => moveToProject(project.path)}>
                  <span>{project.title}</span>
                  <small>{project.owner_display || project.owner || project.path}</small>
                </button>
              ))}
              <button type="button" onClick={() => setMoving(false)}>취소</button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setRenaming(true)}>이름 변경</button>
              {kind === "session" && targetProjects.length > 0 && <button type="button" onClick={() => setMoving(true)}>프로젝트로 이동</button>}
              {kind === "session" && !isGeneral && <button type="button" onClick={moveOut}>밖으로 빼기</button>}
              <button type="button" className="danger-option" onClick={remove}>삭제</button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function NewProjectForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("private");
  const canSubmit = title.trim().length > 0;
  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const form = new URLSearchParams({ title, visibility });
    await fetchJson("/api/projects", { method: "POST", body: form });
    setTitle("");
    setVisibility("private");
    setOpen(false);
    onCreated();
  }
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>New project</summary>
      <form onSubmit={submit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project title" aria-label="Project title" />
        <label className="inline-field">
          <span>공개 범위</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)} aria-label="Project visibility">
            <option value="private">비공개 - 작성자와 admin만</option>
            <option value="public">공개 - 모든 사용자</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={!canSubmit}>Create</button>
      </form>
    </details>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [error, setError] = useState("");
  const canSubmit = title.trim().length > 0;
  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    try {
      const form = new URLSearchParams({ title, visibility });
      const payload = await fetchJson("/api/projects", { method: "POST", body: form });
      onCreated(payload.project);
    } catch (err) {
      setError(err.message || "프로젝트를 만들 수 없습니다.");
    }
  }
  return (
    createPortal(<div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal project-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>새 프로젝트</h2>
          <button type="button" onClick={onClose}>닫기</button>
        </header>
        <p className="muted">프로젝트는 대화, 파일, 목표를 함께 기억하는 작업 공간입니다.</p>
        <form onSubmit={submit}>
          <label>
            <span>프로젝트 이름</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </label>
          <label>
            <span>공개 범위</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="private">개인용 - 나와 admin만</option>
              <option value="public">가족 공유</option>
            </select>
          </label>
          {error && <div className="system-note compact">{error}</div>}
          <button className="primary-button" type="submit" disabled={!canSubmit}>프로젝트 만들기</button>
        </form>
      </section>
    </div>, document.body)
  );
}

function NewGeneralChatForm({ onCreated }) {
  function create() {
    onCreated("/");
  }
  return (
    <button className="new-chat-button" type="button" onClick={create}>
      <span>＋</span>New chat
    </button>
  );
}

function NewSessionForm({ projectPath, onCreated }) {
  function startBlankProjectChat() {
    onCreated(`/project/${projectPath}`);
  }
  return (
    <button className="secondary-action project-chat-action" type="button" onClick={startBlankProjectChat}>
      프로젝트 새 대화
    </button>
  );
}

function CenterPane({ chat, activePath, account, projects, onAsk, onPreview, error, navigate, refreshWorkspace, contextOpen, onToggleContext }) {
  const power = isPowerMode(account);
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <StartPane
        error={error}
        navigate={navigate}
        refreshWorkspace={refreshWorkspace}
        onAsk={onAsk}
        account={account}
        projectPath={activePath.projectPath}
      />
    );
  }

  return (
    <section className="center-pane">
      <div className="chat-header">
        <div>
          <p className="breadcrumb">{chat?.project?.hidden ? "Chats" : "Workspace"} / {chat?.project?.title || activePath.projectPath}</p>
          <EditableTitle chat={chat} activePath={activePath} onAsk={onAsk} refreshWorkspace={refreshWorkspace} />
        </div>
        <div className="context-chips">
          <span>{chat?.project?.hidden ? "개인 대화" : "프로젝트 기억"}</span>
          <span>{(chat?.attachments || []).length} files</span>
          {chat?.goal?.objective && <span>Goal set</span>}
          <span>{power ? `${chat?.latest?.provider || "ollama"} · ${modelLabel(chat?.latest?.model || DEFAULT_MODEL)}` : providerFriendlyLabel(chat?.latest?.provider || "ollama")}</span>
          <button className="chip-button" type="button" onClick={onToggleContext}>{contextOpen ? "닫기" : "파일/기억 보기"}</button>
        </div>
      </div>
      <MessageTimeline messages={chat?.messages || []} onPreview={onPreview} />
      <Composer activePath={activePath} onAsk={onAsk} account={account} power={power} />
    </section>
  );
}

function EditableTitle({ chat, activePath, onAsk, refreshWorkspace }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat?.session?.title || activePath.sessionSlug);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setTitle(chat?.session?.title || activePath.sessionSlug), [chat?.session?.title, activePath.sessionSlug]);

  async function submit(event) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setError("");
    try {
      const payload = await fetchJson(`/api/session-title/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: new URLSearchParams({ title: clean }),
      });
      onAsk((current) => ({ ...(current || {}), session: payload.session }));
      refreshWorkspace?.();
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err.message || "제목을 바꿀 수 없습니다.");
    }
  }

  if (editing) {
    return (
      <form className="title-edit-form" onSubmit={submit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setTitle(chat?.session?.title || activePath.sessionSlug);
              setEditing(false);
            }
          }}
          autoFocus
          aria-label="채팅 제목"
        />
        <button type="submit">저장</button>
        <button type="button" onClick={() => setEditing(false)}>취소</button>
        {error && <small>{error}</small>}
      </form>
    );
  }
  return (
    <h1 className="editable-title">
      <span>{chat?.session?.title || activePath.sessionSlug}</span>
      <button type="button" onClick={() => setEditing(true)} aria-label="채팅 제목 변경">✎</button>
      {saved && <small className="title-toast">대화 제목을 변경했습니다.</small>}
    </h1>
  );
}

function StartPane({ error, navigate, refreshWorkspace, onAsk, account, projectPath = "" }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const power = isPowerMode(account);
  const selectedMode = modelMode(mode);

  useEffect(() => {
    setCookie("aiws_model_mode", mode);
  }, [mode]);

  useEffect(() => {
    setCookie("aiws_search_mode", searchMode);
  }, [searchMode]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) setFile(dropped);
  }

  async function submit(event) {
    event.preventDefault();
    if (starting || (!content.trim() && !file)) return;
    if (selectedMode.cloud && !cloudConfirmed(mode)) {
      setCloudPrompt(true);
      return;
    }
    setStarting(true);
    setStartError("");
    try {
      const createForm = new URLSearchParams({ title: content.trim().slice(0, 48) });
      const created = projectPath
        ? await fetchJson(`/api/sessions/${projectPath}`, { method: "POST", body: createForm })
        : await fetchJson("/api/chats", { method: "POST", body: createForm });
      const createdProjectPath = projectPath || created.project_path;
      const createdSession = created.session;
      const path = `/chat/${createdProjectPath}/${createdSession.slug}`;
      navigate(path);
      refreshWorkspace().catch(() => {});
      if (content.trim() || file) {
        onAsk({
          project: { path: createdProjectPath, title: projectPath ? "Project" : "General chats", hidden: !projectPath },
          session: createdSession,
          messages: [
            {
              role: "user",
              actor_display: accountDisplayName(account),
              content: content.trim() || "Attached file",
              attachments: file ? [{ filename: file.name, url: previewUrl || "", is_image: file.type.startsWith("image/"), is_pdf: file.type === "application/pdf" }] : [],
            },
            { role: "assistant", pending: true, content: "", attachments: [] },
          ],
          skills: [],
          attachments: [],
          goal: {},
          codex_prompt: "",
          latest: {},
        });
        const askForm = new FormData();
        askForm.set("content", content.trim());
        askForm.set("provider", selectedMode.provider);
        askForm.set("model", selectedMode.model);
        askForm.set("search_mode", searchMode);
        if (selectedMode.cloud) {
          askForm.set("allow_remote", "1");
          askForm.set("confirm_cost", "1");
        }
        if (file) askForm.set("attachment", file);
        const payload = await fetchJson(`/api/ask/${createdProjectPath}/${createdSession.slug}`, {
          method: "POST",
          body: askForm,
        });
        onAsk(payload);
      }
      setContent("");
      clearFile();
    } catch (err) {
      setStartError(err.message || "Could not start chat.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="center-pane start-pane">
      <div className="start-content">
        <h1>무엇을 도와드릴까요?</h1>
        <p className="start-subtitle">
          {projectPath ? "첫 메시지를 보내면 이 프로젝트 안에 새 대화가 저장됩니다." : "대화, 파일, 프로젝트 기억을 내 Mac 안에서 이어가는 개인 AI 비서입니다."}
        </p>
        <form
          ref={formRef}
          className={`start-composer ${dragging ? "dragging" : ""}`}
          onSubmit={submit}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={pickDroppedFile}
        >
          {dragging && <div className="drop-hint">여기에 파일을 놓으면 첫 메시지에 첨부됩니다.</div>}
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="무엇이든 물어보세요"
            rows={1}
          />
          {file && (
            <div className="selected-file">
              {previewUrl && <img src={previewUrl} alt={file.name} />}
              <span>{file.name}</span>
              <small>{selectedMode.provider === "kimi" && file.type.startsWith("image/") ? "이미지로 전달됨" : file.type.startsWith("image/") ? "이번 대화에 첨부됨" : "텍스트로 읽힘"}</small>
              <button type="button" data-remove-attachment onClick={clearFile}>Remove</button>
            </div>
          )}
          <div className={`composer-toolbar ${power ? "start-toolbar" : ""}`}>
            <label className="attach-key" title="Attach file">
              {power ? "Attach file" : "사진/파일 추가"}
              <input
                ref={inputRef}
                data-attachment-input
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                accept=".txt,.md,.pdf,.docx,image/png,image/jpeg,image/gif,image/webp"
              />
            </label>
            <ModelPickerButton
              open={pickerOpen}
              setOpen={setPickerOpen}
              selectedKey={mode}
              onSelect={setMode}
              content={content}
              hasFile={Boolean(file)}
              power={power}
            />
            <select className="search-select" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
              {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button className="send-key" type="submit" disabled={starting}>{starting ? <span className="typing" /> : "Send"}</button>
          </div>
          {cloudPrompt && (
            <CloudConfirm
              mode={selectedMode}
              hasFile={Boolean(file)}
              onCancel={() => setCloudPrompt(false)}
              onUseOnce={() => {
                confirmCloudOnce(mode);
                setCloudPrompt(false);
                formRef.current?.requestSubmit();
              }}
              onUseAlways={() => {
                confirmCloudAlways(mode);
                setCloudPrompt(false);
                formRef.current?.requestSubmit();
              }}
            />
          )}
        </form>
        {starting && <WaitingNotice label="Assistant is preparing your answer" />}
        <div className="quick-actions">
          {["사진 설명하기", "문서 요약하기", "할 일 정리하기", "글쓰기 도와줘"].map((item) => <button type="button" key={item} onClick={() => setContent(item)}>{item}</button>)}
        </div>
        <p className="honest-note">현재는 저장된 대화, 프로젝트, 첨부파일 컨텍스트를 우선 사용합니다. 웹 검색은 아직 준비 중입니다.</p>
        {startError && <div className="system-note">{startError}</div>}
        {error && <div className="system-note">{error}</div>}
      </div>
    </section>
  );
}

function MessageTimeline({ messages, onPreview }) {
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (messages.length === 0) {
    return (
      <div className="messages empty-thread">
        <div className="desk-note">
          <h2>무엇을 도와드릴까요?</h2>
          <p>This session is ready. Model controls and active context are below.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="messages">
      {messages.map((message, index) => (
        <MessageCard key={`${index}-${message.role}`} message={message} onPreview={onPreview} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function MessageCard({ message, onPreview }) {
  return (
    <article className={`message-card ${message.role} ${message.pending ? "is-pending" : ""}`}>
      <div className="message-meta">
        <strong>{messageAuthorLabel(message)}</strong>
        {message.created_at && <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>}
        {message.provider && <span>{message.provider} {message.model}</span>}
        {message.estimated_cost !== null && message.estimated_cost !== undefined && <span>USD {message.estimated_cost}</span>}
      </div>
      {message.pending ? <WaitingNotice label="Assistant is thinking" compact /> : <RenderedText text={message.content || ""} />}
      <AttachmentList attachments={message.attachments || []} onPreview={onPreview} />
    </article>
  );
}

function messageAuthorLabel(message) {
  if (message.role === "user") return message.actor_display || displayNameForId(message.actor);
  if (message.role === "assistant") return "Assistant";
  if (message.role === "system") return "System";
  if (message.role === "tool") return message.actor_display ? `Tool · ${message.actor_display}` : "Tool";
  return message.actor_display || displayNameForId(message.actor) || message.role || "message";
}

function displayNameForId(id) {
  const map = {
    local: "Kwanho Kim",
    kwanho: "Kwanho Kim",
    kwanho0096: "Kwanho Kim",
    benetea: "Chungja Byun",
    dosadol: "Gunwoo Kim",
  };
  return map[id || "local"] || id || "Kwanho Kim";
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function accountDisplayName(account) {
  return account?.nickname || account?.display_name || displayNameForId(account?.username);
}

function WaitingNotice({ label, compact = false }) {
  return (
    <div className={`waiting-notice ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="orbital-loader" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  );
}

function RenderedText({ text }) {
  const parts = String(text).split(/```/);
  return (
    <div className="message-text" data-markdown-renderer>
      {parts.map((part, index) =>
        index % 2 ? <pre className="code-block" key={index}><code>{part.trim()}</code></pre> : <MarkdownBlock key={index} text={part} />
      )}
    </div>
  );
}

function MarkdownBlock({ text }) {
  const lines = String(text).split(/\n/);
  const nodes = [];
  let list = [];
  function flushList() {
    if (!list.length) return;
    nodes.push(<ul key={`ul-${nodes.length}`}>{list.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>);
    list = [];
  }
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList();
    const heading = trimmed.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}`;
      nodes.push(<Tag key={index}>{renderInline(heading[2])}</Tag>);
    } else if (trimmed.startsWith("> ")) {
      nodes.push(<blockquote key={index}>{renderInline(trimmed.slice(2))}</blockquote>);
    } else {
      nodes.push(<p key={index}>{renderInline(line)}</p>);
    }
  });
  flushList();
  return nodes;
}

function renderInline(text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  return String(text).split(pattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && /^https?:\/\//.test(link[2])) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function AttachmentList({ attachments, onPreview }) {
  if (!attachments.length) return null;
  function statusLabel(item) {
    if (item.extraction_status === "failed") return "읽기 실패";
    if (item.extraction_status === "success") return "텍스트 읽음";
    if (item.delivery === "Sent as vision input") return "이미지로 전달";
    if (item.delivery === "Sent as text context") return "텍스트로 사용";
    return item.delivery || "대화에 첨부";
  }
  return (
    <div className="attachment-list">
      {attachments.map((item) =>
        item.is_image || item.is_pdf ? (
          <button key={item.url} className="attachment-card image" type="button" onClick={() => onPreview(item)}>
            {item.is_image ? <img src={item.url} alt={item.filename} /> : <span className="pdf-thumb" data-pdf-preview>PDF</span>}
            <span>{item.filename}</span>
            <small className={item.extraction_status === "failed" ? "status-failed" : ""}>{statusLabel(item)}</small>
            {item.extraction_status === "failed" && item.extraction_error && <em>{item.extraction_error}</em>}
          </button>
        ) : (
          <a key={item.url} className="attachment-card" href={item.url} target="_blank" rel="noreferrer">
            {item.filename}
            <small className={item.extraction_status === "failed" ? "status-failed" : ""}>{statusLabel(item)}</small>
            {item.extraction_status === "failed" && item.extraction_error && <em>{item.extraction_error}</em>}
          </a>
        )
      )}
    </div>
  );
}

function Composer({ activePath, onAsk, account, power }) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(savedModelMode);
  const [searchMode, setSearchMode] = useState(savedSearchMode);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloudPrompt, setCloudPrompt] = useState(false);
  const inputRef = useRef(null);
  const textRef = useRef(null);
  const formRef = useRef(null);
  const selectedMode = modelMode(mode);

  useEffect(() => {
    setCookie("aiws_model_mode", mode);
  }, [mode]);

  useEffect(() => {
    setCookie("aiws_search_mode", searchMode);
  }, [searchMode]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.style.height = "auto";
    textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 120)}px`;
  }, [content]);

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pickDroppedFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) setFile(dropped);
  }

  async function submit(event) {
    event.preventDefault();
    if (sending || (!content.trim() && !file)) return;
    if (selectedMode.cloud && !cloudConfirmed(mode)) {
      setCloudPrompt(true);
      return;
    }
    const form = new FormData();
    form.set("content", content);
    form.set("provider", selectedMode.provider);
    form.set("model", selectedMode.model);
    form.set("search_mode", searchMode);
    if (selectedMode.cloud) {
      form.set("allow_remote", "1");
      form.set("confirm_cost", "1");
    }
    if (file) form.set("attachment", file);

    const optimistic = {
      role: "user",
      actor_display: accountDisplayName(account),
      content: content || "Attached file",
      attachments: file ? [{ filename: file.name, url: previewUrl || "", is_image: file.type.startsWith("image/") }] : [],
    };

    setSending(true);
    setContent("");
    clearFile();
    onAsk((current) => ({
      ...(current || {}),
      messages: [...(current?.messages || []), optimistic, { role: "assistant", pending: true, content: "", attachments: [] }],
    }));
    try {
      const payload = await fetchJson(`/api/ask/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: form,
      });
      onAsk(payload);
    } catch (err) {
      onAsk((current) => ({
        ...(current || {}),
        messages: [
          ...(current?.messages || []).filter((message) => !message.pending),
          { role: "system", content: err.message, attachments: [] },
        ],
      }));
    } finally {
      setSending(false);
      textRef.current?.focus();
    }
  }

  function keyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      className={`composer ${dragging ? "dragging" : ""}`}
      data-api-action={`/api/ask/${activePath.projectPath}/${activePath.sessionSlug}`}
      encType="multipart/form-data"
      onSubmit={submit}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={pickDroppedFile}
    >
      {dragging && <div className="drop-hint">여기에 파일을 놓으면 이번 대화에 첨부됩니다.</div>}
      <textarea
        ref={textRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={keyDown}
        placeholder="무엇을 도와드릴까요? 파일은 이 입력에만 첨부됩니다."
      />
      {file && (
        <div className="selected-file">
          {previewUrl && <img src={previewUrl} alt={file.name} />}
          <span>{file.name}</span>
          <small>{selectedMode.provider === "kimi" && file.type.startsWith("image/") ? "이미지로 전달됨" : file.type.startsWith("image/") ? "이번 대화에 첨부됨" : "텍스트로 읽힘"}</small>
          <button type="button" data-remove-attachment onClick={clearFile}>Remove</button>
        </div>
      )}
      <div className="composer-toolbar">
        <label className="attach-key" title="Attach file">
          {power ? "Attach file" : "사진/파일 추가"}
          <input
            ref={inputRef}
            data-attachment-input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            accept=".txt,.md,.pdf,.docx,image/png,image/jpeg,image/gif,image/webp"
          />
        </label>
        <ModelPickerButton
          open={pickerOpen}
          setOpen={setPickerOpen}
          selectedKey={mode}
          onSelect={setMode}
          content={content}
          hasFile={Boolean(file)}
          power={power}
        />
        <select className="search-select" name="search_mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
          {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="send-key" type="submit" disabled={sending}>{sending ? <span className="typing" /> : "Send"}</button>
      </div>
      {cloudPrompt && (
        <CloudConfirm
          mode={selectedMode}
          hasFile={Boolean(file)}
          onCancel={() => setCloudPrompt(false)}
          onUseOnce={() => {
            confirmCloudOnce(mode);
            setCloudPrompt(false);
            formRef.current?.requestSubmit();
          }}
          onUseAlways={() => {
            confirmCloudAlways(mode);
            setCloudPrompt(false);
            formRef.current?.requestSubmit();
          }}
        />
      )}
      {power && (
        <div className="advanced-controls always-open">
          <ModePrice mode={selectedMode} field power />
        </div>
      )}
    </form>
  );
}

function ModelPickerButton({ open, setOpen, selectedKey, onSelect, content, hasFile, power }) {
  const mode = modelMode(selectedKey);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);
  return (
    <div className="model-picker-wrap" ref={wrapRef}>
      <button className="model-select-button" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>{mode.label}</strong>
        <span>{compactModelCost(mode)}</span>
      </button>
      {open && (
        <div className="model-picker" role="dialog" aria-label="AI model picker">
          <header>
            <strong>AI 모델 선택</strong>
            <button type="button" onClick={() => setOpen(false)}>닫기</button>
          </header>
          <div className="model-grid">
            {MODEL_MODES.map((item) => {
              const selected = item.value === selectedKey;
              const estimate = estimateCurrentCost(item, content, hasFile);
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`model-card ${selected ? "selected" : ""} ${item.cloud ? "cloud" : "local"}`}
                  onClick={() => {
                    onSelect(item.value);
                    setOpen(false);
                  }}
                >
                  <span className="model-card-title">{item.label}</span>
                  <span className="model-card-privacy">{item.cloud ? "클라우드 AI" : "내 Mac에서 처리"}</span>
                  <span>{item.bestFor}</span>
                  <span className="model-card-price">{power && item.cloud ? `입력 ~$${item.inputPrice.toFixed(2)} / 1M · 출력 ~$${item.outputPrice.toFixed(2)} / 1M` : item.easyPrice || item.cost}</span>
                  <span className="model-card-estimate">이번 요청 예상 비용: {estimate}</span>
                  {power && <code>{item.provider} · {item.model}</code>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CloudConfirm({ mode, hasFile, onUseOnce, onUseAlways, onCancel }) {
  return (
    <div className="cloud-confirm" role="alert">
      <strong>{mode.label}는 클라우드 AI입니다.</strong>
      <p>선택한 대화 내용{hasFile ? "과 첨부파일 내용" : ""}이 외부 API로 전송될 수 있습니다. 예상 비용: {estimateCurrentCost(mode, "", hasFile)}</p>
      <div>
        <button type="button" onClick={onUseOnce}>이번만 사용</button>
        <button type="button" onClick={onUseAlways}>이 모델 계속 사용</button>
        <button type="button" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

function cloudConfirmed(key) {
  return getCookie(`aiws_cloud_ok_${key}`) === "1" || sessionStorage.getItem(`aiws_cloud_once_${key}`) === "1";
}

function confirmCloudOnce(key) {
  sessionStorage.setItem(`aiws_cloud_once_${key}`, "1");
}

function confirmCloudAlways(key) {
  setCookie(`aiws_cloud_ok_${key}`, "1");
}

function compactModelCost(mode) {
  if (!mode.cloud) return "무료 · 내 Mac";
  return mode.easyPrice || "비용 있음";
}

function estimateCurrentCost(mode, content, hasFile) {
  if (!mode.cloud) return "$0";
  const inputTokens = Math.max(120, Math.ceil(String(content || "").length / 3) + (hasFile ? 3000 : 0));
  const outputTokens = 1024;
  const estimated = (inputTokens / 1_000_000) * mode.inputPrice + (outputTokens / 1_000_000) * mode.outputPrice;
  return `~$${estimated.toFixed(5)}`;
}

function ModePrice({ mode, field = false, power = false }) {
  return (
    <div className={`mode-detail mode-price ${field ? "field-like" : ""}`}>
      <strong>{mode.label}</strong>
      <span>{mode.provider} · {mode.model}</span>
      <small>{mode.cost}</small>
      {power && <small>{mode.privacy} · {mode.bestFor}</small>}
    </div>
  );
}

function modelLabel(model) {
  return MODEL_MODES.find((item) => item.model === model)?.label || model;
}

function modelMode(value) {
  return MODEL_MODES.find((item) => item.value === value) || MODEL_MODES[0];
}

function searchLabel(mode) {
  return SEARCH_OPTIONS.find((item) => item.value === mode)?.label || `Search ${mode}`;
}

function providerFriendlyLabel(provider) {
  return provider === "kimi" ? "고성능 AI" : "빠른 로컬 AI";
}

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

function ContextPanel({ chat, activePath, runtime, openclaw, automations = [], projectConfig, onProjectConfig, onAutomations, onPreview, onChat, account }) {
  const power = isPowerMode(account);
  const tabs = power ? ["files", "commands", "memory", "goal", "debug"] : ["files", "commands", "memory", "goal"];
  const [tab, setTab] = useState("files");
  const currentTab = tabs.includes(tab) ? tab : "files";
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
        <h2>{power ? "Context / Workbench" : "파일과 기억"}</h2>
        <section>
          <h3>현재 대화 목적</h3>
          <p className="muted">대화를 시작하면 이 비서가 참고하는 파일, 기억, 목표가 여기에 정리됩니다.</p>
        </section>
        <ProjectActionsPanel activePath={activePath} projectConfig={projectConfig} onProjectConfig={onProjectConfig} power={power} fetchJson={fetchJson} />
        {power && <RuntimePanel runtime={runtime} />}
        {power && <OpenClawPanel openclaw={openclaw} />}
        {power && <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />}
      </aside>
    );
  }
  const attachments = collectVisibleAttachments(chat);
  return (
    <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
      <h2>{power ? "Context / Workbench" : "파일과 기억"}</h2>
      <section className="context-summary">
        <h3>현재 대화 목적</h3>
        <p><strong>{chat?.project?.hidden ? "General chat" : chat?.project?.title || activePath.projectPath}</strong></p>
        {power && <p className="muted">{activePath.projectPath} / {activePath.sessionSlug}</p>}
        <div className="skill-stack">
          {(chat?.skills || []).map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      </section>
      <div className="context-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item} type="button" className={currentTab === item ? "active" : ""} onClick={() => setTab(item)}>
            {{ files: "Files", commands: "Commands", memory: "Memory", goal: "Goal", debug: "Debug" }[item]}
          </button>
        ))}
      </div>
      {currentTab === "files" && (
        <section>
          <h3>사용 중인 파일</h3>
          {attachments.length === 0 ? <p className="muted">아직 이 대화에 사용 중인 파일이 없습니다.</p> : <AttachmentList attachments={attachments} onPreview={onPreview} />}
        </section>
      )}
      {currentTab === "goal" && (
        <section>
          <h3>다음에 할 일</h3>
          <GoalPanel chat={chat} activePath={activePath} onChat={onChat} power={power} />
        </section>
      )}
      {currentTab === "commands" && (
        <section>
          <h3>프로젝트 명령</h3>
          <ProjectActionsPanel activePath={activePath} projectConfig={projectConfig} onProjectConfig={onProjectConfig} power={power} fetchJson={fetchJson} />
        </section>
      )}
      {currentTab === "memory" && (
        <section>
          <h3>기억된 정보</h3>
          <p className="muted">프로필 기억과 프로젝트 노트는 답변 컨텍스트에 함께 사용됩니다.</p>
        </section>
      )}
      {power && currentTab === "debug" && (
        <section>
          <h3>개발자 도구</h3>
          <RuntimePanel runtime={runtime} />
          <OpenClawPanel openclaw={openclaw} />
          <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />
          <a href={`/prompt/${activePath.projectPath}/${activePath.sessionSlug}`}>Open prompt context</a>
          <code>aiws prompt {activePath.projectPath} {activePath.sessionSlug} --root ~/.ai-workspace</code>
        </section>
      )}
    </aside>
  );
}

function OpenClawPanel({ openclaw }) {
  const gateway = openclaw?.gateway?.summary || {};
  const sessionCount = openclaw?.sessions?.count ?? openclaw?.sessions?.totalCount ?? 0;
  return (
    <div className="runtime-card openclaw-card">
      <strong>OpenClaw</strong>
      <p>{openclaw?.installed ? openclaw.version || "installed" : "not installed"}</p>
      <p>gateway: {gateway.connectivity_probe || gateway.runtime || "unknown"}</p>
      <p>sessions: {sessionCount}</p>
      {gateway.dashboard && <a href={gateway.dashboard} target="_blank" rel="noreferrer">{gateway.dashboard}</a>}
      <code>openclaw gateway status</code>
    </div>
  );
}

function collectVisibleAttachments(chat) {
  const seen = new Set();
  const items = [];
  function add(item) {
    if (!item || !item.filename) return;
    const key = item.url || item.filename;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }
  (chat?.attachments || []).forEach(add);
  (chat?.messages || []).forEach((message) => (message.attachments || []).forEach(add));
  return items;
}

function GoalPanel({ chat, activePath, onChat, power = false }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const goal = chat?.goal || {};
  const codexPrompt = chat?.codex_prompt || "";

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = await fetchJson(`/api/goal/${activePath.projectPath}`, { method: "POST", body: form });
      onChat((current) => ({ ...(current || {}), goal: payload.goal, codex_prompt: payload.codex_prompt }));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard?.writeText(codexPrompt);
  }

  async function copyVariant(kind) {
    const prefix = {
      full: "Use the full project context and goal below.",
      task: "Focus only on the next concrete implementation task.",
      ui: "Focus on UI/UX refinement while preserving backend behavior.",
      bugfix: "Find and fix the most likely bug with minimal changes.",
      test: "Strengthen or repair tests first, then implement only what is needed.",
    }[kind];
    await navigator.clipboard?.writeText(`${prefix}\n\n${codexPrompt}`);
  }

  if (editing) {
    return (
      <form className="goal-form" data-goal-panel onSubmit={save}>
        <textarea name="objective" defaultValue={goal.objective || ""} placeholder="Objective" />
        <textarea name="current_status" defaultValue={goal.current_status || ""} placeholder="Current status" />
        <textarea name="next_actions" defaultValue={(goal.next_actions || []).join("\n")} placeholder="Next actions, one per line" />
        <textarea name="constraints" defaultValue={(goal.constraints || []).join("\n")} placeholder="Constraints, one per line" />
        <textarea name="success_criteria" defaultValue={(goal.success_criteria || []).join("\n")} placeholder="Success criteria, one per line" />
        <textarea name="test_commands" defaultValue={(goal.test_commands || []).join("\n")} placeholder="Test commands, one per line" />
        <div className="goal-actions">
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Goal"}</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="goal-panel" data-goal-panel>
      <strong>{goal.objective || "No goal set yet."}</strong>
      {goal.current_status && <p>{goal.current_status}</p>}
      {(goal.next_actions || []).length > 0 && <ul>{goal.next_actions.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>}
      <div className="goal-actions">
        <button type="button" data-edit-goal onClick={() => setEditing(true)}>{goal.objective ? "목표 수정" : "목표 설정"}</button>
        {power && <button type="button" data-copy-codex-prompt onClick={copyPrompt} disabled={!codexPrompt}>Copy full project prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("task")} disabled={!codexPrompt}>Copy task prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("ui")} disabled={!codexPrompt}>Copy UI refinement prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("bugfix")} disabled={!codexPrompt}>Copy bugfix prompt</button>}
        {power && <button type="button" onClick={() => copyVariant("test")} disabled={!codexPrompt}>Copy test prompt</button>}
      </div>
    </div>
  );
}

function RuntimePanel({ runtime }) {
  const url = runtime?.cloudflare_url || "";
  return (
    <div className="runtime-card">
      <strong>Runtime</strong>
      <p>{runtime?.status || "local"}</p>
      {url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span className="muted">No public tunnel URL.</span>}
    </div>
  );
}

function Lightbox({ item, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" data-lightbox onClick={onClose}>
      <button type="button" onClick={onClose}>Close</button>
      {item.is_pdf ? (
        <iframe title={item.filename} src={item.url} data-preview-src={item.url} />
      ) : (
        <img src={item.url} alt={item.filename} data-preview-src={item.url} />
      )}
    </div>
  );
}

function SettingsModal({ account, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const profile = account.profile || {};
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/profile", { method: "POST", body: form });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST", headers: csrfHeader() });
    window.location.href = "/login";
  }

  return (
    createPortal(<div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>내 비서 설정</h2>
          <div className="settings-header-actions">
            <button className="danger-button compact" type="button" onClick={logout}>Logout</button>
            <button type="button" onClick={onClose}>닫기</button>
          </div>
        </header>
        <form onSubmit={submit}>
          <fieldset>
            <legend>Profile</legend>
            <label><span>프로필 사진</span><input name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></label>
            <label><span>이름</span><input name="name" defaultValue={profile.name || account.display_name || ""} /></label>
            <label><span>나이</span><input name="age" defaultValue={profile.age || ""} /></label>
            <label><span>직업 / 역할</span><input name="job" defaultValue={profile.job || ""} /></label>
            <label><span>언어</span><select name="language" defaultValue={profile.language || "ko"}><option value="ko">한국어</option><option value="en">English</option></select></label>
          </fieldset>
          <fieldset>
            <legend>Personal Context</legend>
            <label><span>상황 / 대화 컨텍스트</span><textarea name="situation" defaultValue={profile.situation || ""} /></label>
            <label><span>기억에 추가</span><textarea name="memory" placeholder="비서가 앞으로 기억하면 좋은 내용을 적어주세요." /></label>
          </fieldset>
          <fieldset>
            <legend>Interface</legend>
            <label><span>사용 모드</span><select name="ui_mode" defaultValue={profile.ui_mode || (account.admin ? "power" : "easy")}><option value="easy">Easy Mode - 쉬운 화면</option><option value="power">Power Mode - 개발자 도구 표시</option></select></label>
          </fieldset>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
        </form>
      </section>
    </div>, document.body)
  );
}

function parseRoute(path = window.location.pathname) {
  if (path === "/login") {
    return { view: "login", projectPath: "", sessionSlug: "" };
  }
  if (path.startsWith("/chat/")) {
    const parts = path.replace("/chat/", "").split("/");
    return { projectPath: parts.slice(0, -1).join("/"), sessionSlug: parts.at(-1) };
  }
  if (path.startsWith("/project/")) {
    return { projectPath: path.replace("/project/", ""), sessionSlug: "" };
  }
  return { projectPath: "", sessionSlug: "" };
}

createRoot(document.getElementById("root")).render(<App />);
