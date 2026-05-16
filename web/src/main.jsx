import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { TaskSuggestionsPanel } from "./components/actions/ActionPanels.jsx";
import { AttachmentList } from "./components/chat/AttachmentList.jsx";
import { Composer } from "./components/chat/Composer.jsx";
import { ContextReceiptCard } from "./components/chat/ContextReceiptCard.jsx";
import { WaitingNotice } from "./components/chat/WaitingNotice.jsx";
import { MarkdownRenderer } from "./components/markdown/MarkdownRenderer.jsx";
import { StartPane, StarterActionsGrid } from "./components/home/StartPane.jsx";
import { ContextPanel } from "./components/inspector/ContextPanel.jsx";
import { ProjectDashboard } from "./components/project/ProjectDashboard.jsx";
import { COPY, copyForAccount, copyForLocale } from "./copy.js";
import { fetchJson, getCookie, setCookie } from "./lib/api.js";
import {
  DEFAULT_MODEL,
  MODEL_MODES,
  modelLabel,
  normalizeModelCatalog,
} from "./lib/modelModes.jsx";
import "./styles.css";


function App() {
  const [workspace, setWorkspace] = useState(null);
  const [chat, setChat] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [home, setHome] = useState(null);
  const [openclaw, setOpenclaw] = useState(null);
  const [automations, setAutomations] = useState([]);
  const [projectConfig, setProjectConfig] = useState(null);
  const [projectRunDetail, setProjectRunDetail] = useState(null);
  const [projectArtifact, setProjectArtifact] = useState(null);
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => getCookie("aiws_sidebar_open") !== "0");
  const isLogin = activePath.view === "login";

  async function refreshWorkspace() {
    setWorkspace(await fetchJson("/api/workspace"));
  }

  async function refreshHome() {
    const payload = await fetchJson("/api/home");
    setHome(payload.home);
  }

  async function refreshChat(target = activePath) {
    if (!target.projectPath || !target.sessionSlug) {
      setChat(null);
      return;
    }
    const payload = await fetchJson(`/api/chat/${target.projectPath}/${target.sessionSlug}`);
    setChat((current) => {
      const sameThread = current?.project?.path === target.projectPath && current?.session?.slug === target.sessionSlug;
      const hasPending = (current?.messages || []).some((message) => message.pending);
      if (sameThread && hasPending && (payload.messages || []).length === 0) {
        return current;
      }
      return payload;
    });
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

  async function openProjectRun(run) {
    if (!activePath.projectPath || !run?.run_id) return;
    const payload = await fetchJson(`/api/project-run?project=${encodeURIComponent(activePath.projectPath)}&run_id=${encodeURIComponent(run.run_id)}`);
    setProjectRunDetail(payload);
  }

  async function openProjectArtifact(artifact) {
    if (!activePath.projectPath || !artifact?.path) return;
    const payload = await fetchJson(`/api/project-artifact?project=${encodeURIComponent(activePath.projectPath)}&path=${encodeURIComponent(artifact.path)}`);
    setProjectArtifact(payload.artifact);
  }

  useEffect(() => {
    if (isLogin) return;
    refreshWorkspace().catch((err) => setError(err.message));
    refreshHome().catch(() => {});
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
    document.documentElement.lang = copyForAccount(workspace?.account).locale;
  }, [workspace?.account?.profile?.language]);

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
    refreshHome().catch(() => {});
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

  if (!workspace) {
    return (
      <div className="app-shell loading-shell">
        <span className="orbital-loader" aria-hidden="true"><i /><i /><i /></span>
        <span>Loading workspace</span>
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
          projectConfig={projectConfig}
          onProjectConfig={setProjectConfig}
          workspace={workspace}
          home={home}
          onHome={setHome}
          refreshHome={refreshHome}
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
          onOpenRun={openProjectRun}
          onOpenArtifact={openProjectArtifact}
        />
      </main>
      {projectRunDetail && (
        <HomeRunDetailModal
          detail={projectRunDetail}
          power={isPowerMode(workspace?.account)}
          onClose={() => setProjectRunDetail(null)}
          onOpenArtifact={openProjectArtifact}
        />
      )}
      {projectArtifact && (
        <HomeArtifactViewer
          artifact={projectArtifact}
          onClose={() => setProjectArtifact(null)}
        />
      )}
      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function TopBar({ runtime, account, activePath, chat, contextOpen, onToggleContext, sidebarOpen, onToggleSidebar }) {
  const [open, setOpen] = useState(false);
  const url = runtime?.cloudflare_url || "";
  const power = isPowerMode(account);
  const operator = power && Boolean(account?.admin);
  const copy = copyForAccount(account);
  const context = activePath?.sessionSlug ? (chat?.project?.hidden ? "General chat" : `${chat?.project?.title || "Project"} / ${chat?.session?.title || activePath.sessionSlug}`) : "Private AI Cockpit";
  return (
    <header className="topbar">
      <button className="sidebar-toggle" type="button" onClick={onToggleSidebar} aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"} aria-pressed={sidebarOpen}>
        <span />
        <span />
        <span />
      </button>
      <a className="brand" href="/">
        <span className="brand-mark" /> {copy.productName}
      </a>
      <span className="local-badge">{copy.topbar.localFirst}</span>
      <span className="top-context">{context}</span>
      <span className={`mode-chip ${power ? "power" : "easy"}`} title={`${copy.topbar.modeLabel}: ${power ? "Power" : "Easy"}`} aria-label={`${copy.topbar.modeLabel}: ${power ? "Power" : "Easy"}`}>
        <span />
        <b>{power ? "Power" : "Easy"}</b>
      </span>
      <button className={`context-toggle icon-only ${contextOpen ? "active" : ""}`} type="button" onClick={onToggleContext} aria-label={contextOpen ? copy.topbar.contextOpen : copy.topbar.contextClosed} aria-pressed={contextOpen}>
        <span />
        <i />
      </button>
      <button
        className={`runtime-pill ${power ? "" : "dot-only"}`}
        type="button"
        onClick={() => operator && setOpen(!open)}
        aria-label={operator ? `Runtime ${runtime?.status || "local"}` : "Connected"}
        aria-expanded={open}
      >
        <span className="status-lamp" />{power ? (runtime?.status || "local") : ""}
      </button>
      {operator && open && (
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
  const copy = copyForLocale("en");
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">{copy.shortName}</p>
          <h1 id="login-title">{copy.productName}</h1>
          <p className="login-copy">{copy.tagline}</p>
        </div>
        {hasError && <div className="system-note compact">Username or password is incorrect.</div>}
        <form className="login-form" method="post" action="/login">
          <input type="hidden" name="_csrf" value={document.cookie.split("; ").find((item) => item.startsWith("aiws_csrf="))?.split("=")[1] || ""} />
          <label>
            <span>Username</span>
            <input name="username" autoComplete="username" autoFocus />
          </label>
          <label>
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" />
          </label>
          <button className="primary-button" type="submit">Login</button>
        </form>
      </section>
      <aside className="login-aside">
        <div className="status-card">
          <span className="status-lamp" />
          <strong>Local-first</strong>
          <p>Your files, chats, and runs stay in your workspace by default.</p>
        </div>
        <div className="status-card">
          <strong>Configurable workbench</strong>
          <p>Projects can expose actions, panels, context, and artifacts through aiws.yaml.</p>
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
  const copy = copyForAccount(account);
  const activeIsGeneralChat = chats.some((project) => project.path === activePath.projectPath);
  const allChatSessions = chats.flatMap((project) => project.sessions.map((session) => ({ ...session, projectPath: project.path })));
  const needle = query.trim().toLowerCase();
  const matchesChat = (session) => !needle || `${session.title} ${session.projectPath}`.toLowerCase().includes(needle);
  const visibleChats = allChatSessions
    .filter(matchesChat)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, needle ? 40 : 18);
  const filtered = useMemo(() => {
    if (!needle) return projects;
    return projects.filter((project) =>
      `${project.title} ${project.path} ${project.sessions.map((s) => s.title).join(" ")}`.toLowerCase().includes(needle)
    );
  }, [projects, query]);
  const hasSearchResults = !needle || visibleChats.length > 0 || filtered.length > 0;
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
        <button className={`secondary-action home-action ${(!activePath.view || activePath.view === "home") && !activePath.projectPath && !activePath.sessionSlug ? "active" : ""}`} type="button" onClick={() => navigate("/")}>{copy.nav.home}</button>
        <NewGeneralChatForm onCreated={(path) => navigate(path)} copy={copy} />
        <button className="secondary-action" type="button" onClick={() => setProjectOpen(true)}>{copy.nav.newProject}</button>
        <button className={`secondary-action ${activePath.view === "actions" ? "active" : ""}`} type="button" onClick={() => navigate("/actions")}>{copy.nav.actions}</button>
        {activePath.projectPath && !activeIsGeneralChat && <NewSessionForm projectPath={activePath.projectPath} onCreated={(path) => navigate(path)} />}
      </section>
      <label className="visually-hidden" htmlFor="workspace-search">Search workspace</label>
      <div className="search-row">
        <input id="workspace-search" className="search-box" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.nav.searchPlaceholder} />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
      </div>
      <nav className="project-tree" aria-label="Workspace">
        {!workspace && <div className="empty-card">Loading workspace...</div>}
        {!hasSearchResults && <div className="empty-card compact-empty">{copy.nav.noSearchResults}</div>}
        {workspace && projects.length > 0 && <div className="tree-heading primary-heading"><span>{copy.nav.projects}</span><small>{copy.nav.workspace}</small></div>}
        {workspace && projects.length === 0 && (
          <div className="empty-card">
            <strong>No projects yet.</strong>
            <p>Projects are repeatable workspaces for files, actions, and context.</p>
          </div>
        )}
        {filtered.map((project) => (
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
        <div className="tree-heading"><span>{copy.nav.chats}</span><small>{copy.nav.oneOffChats}</small></div>
        <ChatSection
          title={needle ? "Search results" : "Recent"}
          sessions={visibleChats}
          activePath={activePath}
          navigate={navigate}
          query={query}
          projects={ownedProjects}
          onRefresh={refreshAndStay}
          onDragSession={dragSession}
          onMoveSession={moveSession}
        />
        {account?.admin && automations.length > 0 && (
          <section className="tree-section local-jobs-section">
            <h2><span>Automation Recipes</span></h2>
            {automations.map((project) => (
              <LocalJobItem key={project.slug} project={project} onAutomations={onAutomations} />
            ))}
          </section>
        )}
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
        <small>{latest ? `${latest.status} · ${formatDate(latest.created_at)}` : "Not run yet"}</small>
      </div>
      <button type="button" onClick={run} disabled={running}>{running ? "..." : "Run"}</button>
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
  const activeInProject = project.path === activePath.projectPath;
  const [collapsed, setCollapsed] = useState(() => !activeInProject);
  useEffect(() => {
    if (activeInProject) setCollapsed(false);
  }, [activeInProject]);
  const showSessions = !collapsed && project.sessions.length > 0;
  return (
    <div className={`project-node level-${project.level} ${collapsed ? "collapsed" : "expanded"}`}>
      <div
        className="tree-item-row project-row"
        onDragOver={(event) => owned && event.preventDefault()}
        onDrop={(event) => owned && onDropOnProject(event, project.path)}
      >
        <button
          type="button"
          className={`folder-card ${project.path === activePath.projectPath ? "active" : ""}`}
          onClick={() => {
            if (activeInProject) {
              setCollapsed((value) => !value);
            } else {
              navigate(`/project/${project.path}`);
            }
          }}
        >
          <span
            className="folder-icon"
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              setCollapsed((value) => !value);
            }}
          />
          <span>{project.title}</span>
          <small>
            <b>{project.visibility === "public" ? "Shared Project" : "Project"}</b>
            {project.level > 0 ? " · Subproject" : ""}
            {" · "}
            {project.owner_display || project.owner || "Kwanho Kim"}
          </small>
        </button>
        {owned && <ItemOptions kind="project" projectPath={project.path} title={project.title} navigate={navigate} onRefresh={onRefresh} />}
      </div>
      {showSessions && <div className="session-list">
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
      </div>}
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
    if (!globalThis.confirm(kind === "project" ? "Delete this project?" : "Delete this chat?")) return;
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
      <button className="item-options-button" type="button" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} aria-label="Options" aria-expanded={open}>
        <span />
        <span />
        <span />
      </button>
      {open && (
        <span className="item-menu" role="menu">
          {renaming ? (
            <form className="mini-menu-form" onSubmit={(event) => { event.preventDefault(); rename(); }}>
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus aria-label={kind === "project" ? "Project name" : "Chat title"} />
              <div>
                <button type="submit">Save</button>
                <button type="button" onClick={() => { setDraftTitle(title || ""); setRenaming(false); }}>Cancel</button>
              </div>
            </form>
          ) : moving ? (
            <div className="move-menu">
              <strong>Move to project</strong>
              {targetProjects.map((project) => (
                <button key={project.path} type="button" onClick={() => moveToProject(project.path)}>
                  <span>{project.title}</span>
                  <small>{project.owner_display || project.owner || project.path}</small>
                </button>
              ))}
              <button type="button" onClick={() => setMoving(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setRenaming(true)}>Rename</button>
              {kind === "session" && targetProjects.length > 0 && <button type="button" onClick={() => setMoving(true)}>Move to project</button>}
              {kind === "session" && !isGeneral && <button type="button" onClick={moveOut}>Move out</button>}
              <button type="button" className="danger-option" onClick={remove}>Delete</button>
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
          <span>Visibility</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)} aria-label="Project visibility">
            <option value="private">Private - owner and admins</option>
            <option value="public">Public - logged-in users</option>
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
      setError(err.message || "Could not create project.");
    }
  }
  return (
    createPortal(<div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal project-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>New Project</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <p className="muted">Projects are repeatable workbenches for chats, files, goals, actions, and artifacts.</p>
        <form onSubmit={submit}>
          <label>
            <span>Project name</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </label>
          <label>
            <span>Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="private">Private - owner and admins</option>
              <option value="public">Public - logged-in users</option>
            </select>
          </label>
          {error && <div className="system-note compact">{error}</div>}
          <button className="primary-button" type="submit" disabled={!canSubmit}>Create project</button>
        </form>
      </section>
    </div>, document.body)
  );
}

function NewGeneralChatForm({ onCreated, copy = COPY }) {
  function create() {
    onCreated("/");
  }
  return (
    <button className="new-chat-button" type="button" onClick={create}>
      <span>＋</span>{copy.nav.newChat}
    </button>
  );
}

function NewSessionForm({ projectPath, onCreated }) {
  function startBlankProjectChat() {
    onCreated(`/project/${projectPath}`);
  }
  return (
    <button className="secondary-action project-chat-action" type="button" onClick={startBlankProjectChat}>
      New project chat
    </button>
  );
}

function CenterPane({ chat, activePath, account, projects, onAsk, onPreview, error, navigate, refreshWorkspace, contextOpen, onToggleContext, projectConfig, onProjectConfig, workspace, home, onHome, refreshHome }) {
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const models = normalizeModelCatalog(account?.model_catalog);
  if (activePath.view === "actions") {
    return <ActionLibraryPage navigate={navigate} copy={copy} />;
  }
  if (activePath.projectPath && !activePath.sessionSlug) {
    const project = projects.find((item) => item.path === activePath.projectPath);
    return (
      <section className="center-pane project-workbench-page">
        <ProjectDashboard
          activePath={activePath}
          projectConfig={projectConfig}
          project={project}
          power={power}
          fetchJson={fetchJson}
          onProjectConfig={onProjectConfig}
          navigate={navigate}
        />
        <StartPane
          error={error}
          navigate={navigate}
          refreshWorkspace={refreshWorkspace}
          onAsk={onAsk}
          account={account}
          models={models}
          projectPath={activePath.projectPath}
          embedded
        />
      </section>
    );
  }
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <StartPane
        error={error}
        navigate={navigate}
        refreshWorkspace={refreshWorkspace}
        onAsk={onAsk}
        account={account}
        models={models}
        projectPath={activePath.projectPath}
        workspace={workspace}
        home={home}
        onHome={onHome}
        refreshHome={refreshHome}
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
          <span>{chat?.project?.hidden ? "Private chat" : "Project memory"}</span>
          <span>{(chat?.attachments || []).length} files</span>
          {chat?.goal?.objective && <span>Goal set</span>}
          <span>{power ? `${chat?.latest?.provider || "ollama"} · ${modelLabel(chat?.latest?.model || DEFAULT_MODEL, models)}` : providerFriendlyLabel(chat?.latest?.provider || "ollama")}</span>
          <button className="chip-button" type="button" onClick={onToggleContext}>{contextOpen ? "Close" : copy.inspector.title}</button>
        </div>
      </div>
      <MessageTimeline messages={chat?.messages || []} onPreview={onPreview} activePath={activePath} onChat={onAsk} />
      <TaskSuggestionsPanel
        activePath={activePath}
        suggestions={chat?.task_suggestions || []}
        onProjectConfig={onProjectConfig}
        onChat={onAsk}
        power={power}
        fetchJson={fetchJson}
      />
      <Composer activePath={activePath} onAsk={onAsk} account={account} power={power} models={models} />
    </section>
  );
}

function ActionLibraryPage({ navigate, copy = COPY }) {
  return (
    <section className="center-pane action-library-page">
      <div className="home-workbench">
        <div className="home-hero">
          <p className="eyebrow">Action Library</p>
          <h1>Choose a reusable workbench action</h1>
          <p>Start document, image, CSV, and code workflows before creating a project. Save repeatable work as a project action when it becomes useful.</p>
        </div>
        <StarterActionsGrid copy={copy} onStart={(action) => navigate(`/?starter=${encodeURIComponent(action.id)}`)} />
      </div>
    </section>
  );
}

function MessageTimeline({ messages, onPreview, activePath, onChat }) {
  const endRef = useRef(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (messages.length === 0) {
    return (
      <div className="messages empty-thread">
        <div className="desk-note">
          <h2>{copy.chat.emptyTitle}</h2>
          <p>{copy.chat.emptyBody}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="messages">
      {messages.map((message, index) => (
        <MessageCard key={`${index}-${message.role}`} message={message} onPreview={onPreview} activePath={activePath} onChat={onChat} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function MessageCard({ message, onPreview, activePath, onChat }) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  return (
    <article className={`message-card ${message.role} ${message.pending ? "is-pending" : ""}`}>
      <div className="message-meta">
        <strong>{messageAuthorLabel(message)}</strong>
        {message.created_at && <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>}
        {message.provider && <span>{message.provider} {message.model}</span>}
        {message.estimated_cost !== null && message.estimated_cost !== undefined && <span>USD {message.estimated_cost}</span>}
      </div>
      {message.pending ? <WaitingNotice label={copy.chat.assistantThinking} compact /> : <MarkdownRenderer>{message.content || ""}</MarkdownRenderer>}
      {message.role === "assistant" && !message.pending && activePath?.projectPath && (
        <MessageActions activePath={activePath} onChat={onChat} copy={copy} />
      )}
      {message.context_receipt && <ContextReceiptCard receipt={message.context_receipt} compact />}
      {message.execution_plan && <PlannerTraceSummary plan={message.execution_plan} />}
      <AttachmentList attachments={message.attachments || []} onPreview={onPreview} />
    </article>
  );
}

function MessageActions({ activePath, onChat, copy = COPY }) {
  const [saving, setSaving] = useState(false);
  async function saveArtifact() {
    setSaving(true);
    try {
      const payload = await fetchJson(`/api/chat-artifact/${activePath.projectPath}/${activePath.sessionSlug}`, {
        method: "POST",
        body: new URLSearchParams({ title: "Assistant Answer" }),
      });
      onChat((current) => ({
        ...(current || {}),
        work_session: {
          ...(current?.work_session || {}),
          artifacts: [...(current?.work_session?.artifacts || []), payload.artifact],
        },
      }));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="message-actions">
      <button type="button" onClick={saveArtifact} disabled={saving}>{saving ? copy.messageActions.saving : copy.messageActions.saveArtifact}</button>
    </div>
  );
}

function PlannerTraceSummary({ plan }) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return null;
  return (
    <details className="planner-trace-summary">
      <summary>Agent plan · {steps.length} steps · {plan.estimated_model_calls || 1} model call budget</summary>
      <div>
        {steps.map((step) => (
          <span key={step.id || step.title}>
            <b>{step.status}</b> {step.title || step.type}
          </span>
        ))}
      </div>
      {plan.requires_confirmation && <small>Web search runs only when selected. Sandbox/code execution still requires promotion into an Action.</small>}
    </details>
  );
}

function messageAuthorLabel(message) {
  if (message.role === "user") return message.actor_display || displayNameForId(message.actor);
  if (message.role === "assistant") return COPY.brandCompact;
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

function providerFriendlyLabel(provider) {
  return provider === "kimi" ? "High-context AI" : "Fast local AI";
}

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
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
  const copy = copyForAccount(account);
  const usage = account.usage || {};
  const costUsage = account.cost_usage || {};
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
          <h2>{copy.settings.title}</h2>
          <div className="settings-header-actions">
            <button className="danger-button compact" type="button" onClick={logout}>Logout</button>
            <button type="button" onClick={onClose}>{copy.settings.close}</button>
          </div>
        </header>
        <section className="settings-stats" aria-label="Account usage history">
          <div>
            <strong>{usage.messages || 0}</strong>
            <span>{copy.settings.savedMessages}</span>
          </div>
          <div>
            <strong>{usage.asks || 0}</strong>
            <span>{copy.settings.aiRequests}</span>
          </div>
          <div>
            <strong>${Number(costUsage.month_usd || 0).toFixed(4)}</strong>
            <span>{copy.settings.monthlyApiCost}</span>
          </div>
        </section>
        <form onSubmit={submit}>
          <fieldset>
            <legend>{copy.settings.profile}</legend>
            <label><span>{copy.settings.avatar}</span><input name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></label>
            <label><span>{copy.settings.name}</span><input name="name" defaultValue={profile.name || account.display_name || ""} /></label>
            <label><span>{copy.settings.age}</span><input name="age" defaultValue={profile.age || ""} /></label>
            <label><span>{copy.settings.role}</span><input name="job" defaultValue={profile.job || ""} /></label>
            <label><span>{copy.settings.language}</span><select name="language" defaultValue={profile.language || "en"}><option value="en">English</option><option value="ko">한국어</option></select></label>
          </fieldset>
          <fieldset>
            <legend>{copy.settings.personalContext}</legend>
            <label><span>{copy.settings.situation}</span><textarea name="situation" defaultValue={profile.situation || ""} /></label>
            <label><span>{copy.settings.addMemory}</span><textarea name="memory" placeholder={copy.settings.memoryPlaceholder} /></label>
          </fieldset>
          <fieldset>
            <legend>{copy.settings.interface}</legend>
            <label><span>{copy.settings.uiMode}</span><select name="ui_mode" defaultValue={profile.ui_mode || (account.admin ? "power" : "easy")}><option value="easy">{copy.settings.easyMode}</option><option value="power">{copy.settings.powerMode}</option></select></label>
            <p className="settings-help">{copy.settings.modeHelp}</p>
          </fieldset>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : copy.settings.saveProfile}</button>
        </form>
      </section>
    </div>, document.body)
  );
}

function parseRoute(path = window.location.pathname) {
  if (path === "/login") {
    return { view: "login", projectPath: "", sessionSlug: "" };
  }
  if (path === "/actions") {
    return { view: "actions", projectPath: "", sessionSlug: "" };
  }
  if (path === "/actions/new") {
    return { view: "actions", projectPath: "", sessionSlug: "" };
  }
  if (path === "/home") {
    return { view: "home", projectPath: "", sessionSlug: "" };
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
