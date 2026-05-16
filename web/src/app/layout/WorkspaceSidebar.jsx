import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COPY, copyForAccount } from "../../shared/copy/copy";
import { csrfHeader, fetchJson } from "../../lib/api.js";

export function WorkspaceSidebar({ workspace, activePath, navigate, onRefresh, automations = [], onAutomations }) {
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const projects = useMemo(() => workspace?.projects || [], [workspace?.projects]);
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
  }, [projects, needle]);
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
            <p>Projects are repeatable workspaces for files, Workflow Apps, and context.</p>
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
        <p className="muted">Projects are repeatable workbenches for chats, files, goals, Workflow Apps, and artifacts.</p>
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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
