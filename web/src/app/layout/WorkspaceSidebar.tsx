import React, { type DragEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COPY, copyForAccount } from "../../shared/copy/copy";
import { csrfHeader, fetchJson } from "../../lib/api";
import { isThemeName, themeNames } from "../../ui/theme/tokens";
import { themes } from "../../ui/theme/themes";
import { useTheme } from "../../ui/theme/useTheme";
import type { AccountSummary, WorkspaceSummary } from "../../entities/workspace/types";
import type { ProjectSummary } from "../../entities/project/types";
import type { SessionSummary } from "../../entities/session/types";
import type { ActivePath, AutomationProject } from "../../shared/contracts/runtime";

type NavSession = SessionSummary & { projectPath: string };
type SidebarCopy = typeof COPY;

type WorkspaceSidebarProps = {
  workspace: WorkspaceSummary | null;
  activePath: ActivePath;
  navigate: (path: string) => void;
  onRefresh?: () => void | Promise<void>;
  automations?: AutomationProject[];
  onAutomations?: (projects: AutomationProject[]) => void;
};

export function WorkspaceSidebar({ workspace, activePath, navigate, onRefresh, automations = [], onAutomations }: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const projects = useMemo(() => workspace?.projects || [], [workspace?.projects]);
  const chats = workspace?.chats || [];
  const account = workspace?.account || { username: "local", nickname: "Kwanho Kim", display_name: "Kwanho Kim", profile: {} };
  const copy = copyForAccount(account);
  const activeIsGeneralChat = chats.some((project) => project.path === activePath.projectPath);
  const allChatSessions: NavSession[] = chats.flatMap((project) => project.sessions.map((session) => ({ ...session, projectPath: project.path })));
  const needle = query.trim().toLowerCase();
  const matchesChat = (session: NavSession) => !needle || `${session.title} ${session.projectPath}`.toLowerCase().includes(needle);
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

  useEffect(() => {
    const openProjectModal = () => setProjectOpen(true);
    window.addEventListener("aiws:new-project", openProjectModal);
    return () => window.removeEventListener("aiws:new-project", openProjectModal);
  }, []);

  async function moveSession(projectPath: string, sessionSlug: string, targetProjectPath: string) {
    const payload = await fetchJson<{ project_path: string; session: { slug: string } }>(`/api/move-chat/${projectPath}/${sessionSlug}`, {
      method: "POST",
      body: new URLSearchParams({ target_project: targetProjectPath }),
    });
    await refreshAndStay();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  function dragSession(event: DragEvent<HTMLElement>, projectPath: string, sessionSlug: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-aiws-session", JSON.stringify({ projectPath, sessionSlug }));
  }

  async function dropOnProject(event: DragEvent<HTMLElement>, projectPath: string) {
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
        <button className={`secondary-action ${activePath.view === "apps-tools" || activePath.view === "actions" ? "active" : ""}`} type="button" onClick={() => navigate("/apps-tools")}>{copy.nav.actions}</button>
        <button className="secondary-action" type="button" onClick={() => setSettingsOpen(true)}>{copy.nav.settings || "Settings"}</button>
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
      {projectOpen && <NewProjectModal onClose={() => setProjectOpen(false)} onCreated={(project) => { setProjectOpen(false); onRefresh?.(); navigate(`/project/${project.path}`); }} />}
    </aside>
  );
}

function LocalJobItem({ project, onAutomations }: { project: AutomationProject; onAutomations?: (projects: AutomationProject[]) => void }) {
  const [running, setRunning] = useState(false);
  const latest = project.latest_run;
  async function run() {
    if (running) return;
    setRunning(true);
    try {
      const payload = await fetchJson<{ projects: AutomationProject[] }>(`/api/automations/${project.slug}/run`, { method: "POST", body: new URLSearchParams() });
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

function ownerProjects(projects: ProjectSummary[], account: AccountSummary) {
  const username = account?.username || "local";
  return (projects || []).filter((project) => !project.hidden && (project.owner ? project.owner === username : username === "local"));
}

function ChatSection({ title, sessions, activePath, navigate, query = "", projects, onRefresh, onDragSession, onMoveSession }: {
  title: string;
  sessions: NavSession[];
  activePath: ActivePath;
  navigate: (path: string) => void;
  query?: string;
  projects: ProjectSummary[];
  onRefresh?: () => void | Promise<void>;
  onDragSession: (event: DragEvent<HTMLElement>, projectPath: string, sessionSlug: string) => void;
  onMoveSession: (projectPath: string, sessionSlug: string, targetProjectPath: string) => void | Promise<void>;
}) {
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

function highlightText(value: string, query: string): ReactNode {
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

function initials(value?: string) {
  return String(value || "A").trim().slice(0, 1).toUpperCase();
}

function ProjectNode({ project, activePath, navigate, projects, onRefresh, onDragSession, onMoveSession, onDropOnProject }: {
  project: ProjectSummary;
  activePath: ActivePath;
  navigate: (path: string) => void;
  projects: ProjectSummary[];
  onRefresh?: () => void | Promise<void>;
  onDragSession: (event: DragEvent<HTMLElement>, projectPath: string, sessionSlug: string) => void;
  onMoveSession: (projectPath: string, sessionSlug: string, targetProjectPath: string) => void | Promise<void>;
  onDropOnProject: (event: DragEvent<HTMLElement>, projectPath: string) => void | Promise<void>;
}) {
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
            {(project.level || 0) > 0 ? " · Subproject" : ""}
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

function ItemOptions({ kind, projectPath, sessionSlug = "", title, isGeneral = false, projects = [], navigate, onRefresh, onMoveSession }: {
  kind: "project" | "session";
  projectPath: string;
  sessionSlug?: string;
  title?: string;
  isGeneral?: boolean;
  projects?: ProjectSummary[];
  navigate: (path: string) => void;
  onRefresh?: () => void | Promise<void>;
  onMoveSession?: (projectPath: string, sessionSlug: string, targetProjectPath: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || "");
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const targetProjects = projects.filter((project) => project.path !== projectPath);

  useEffect(() => {
    if (!open) return undefined;
    function close(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    function key(event: KeyboardEvent) {
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

  async function moveToProject(target: string) {
    setOpen(false);
    if (!target) return;
    await onMoveSession?.(projectPath, sessionSlug, target);
  }

  async function moveOut() {
    setOpen(false);
    const payload = await fetchJson<{ project_path: string; session: { slug: string } }>(`/api/move-chat-out/${projectPath}/${sessionSlug}`, { method: "POST", body: new URLSearchParams() });
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

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: ProjectSummary) => void }) {
  const templates = [
    {
      id: "blank",
      title: "빈 작업대",
      description: "파일, 대화, Workflow App을 나중에 직접 붙임.",
      output: "Project folder + aiws.yaml 기본값",
      defaultTitle: "",
      notes: "Local-first project workspace.",
    },
    {
      id: "investment-advisor",
      title: "투자 리밸런싱",
      description: "portfolio CSV와 target allocation으로 표/차트/리포트를 바로 생성.",
      output: "Rebalance dashboard + artifacts",
      defaultTitle: "Investment Advisor",
      notes: "Educational portfolio analysis workspace. Not financial advice.",
    },
    {
      id: "document-review",
      title: "문서 리뷰",
      description: "PDF/DOCX/MD를 모아 검색, 출처, 요약 산출물 중심으로 운영.",
      output: "Document context + reports",
      defaultTitle: "Document Review",
      notes: "Document review workspace.",
    },
  ];
  const [template, setTemplate] = useState(templates[0]);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [error, setError] = useState("");
  const effectiveTitle = title.trim() || template.defaultTitle;
  const canSubmit = effectiveTitle.trim().length > 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    try {
      const form = new URLSearchParams({ title: effectiveTitle, visibility, notes: template.notes });
      const payload = template.id === "investment-advisor"
        ? await fetchJson<{ project: ProjectSummary }>("/api/projects/import-template", {
          method: "POST",
          body: new URLSearchParams({ template: "investment-advisor", project: "investment-advisor", overwrite: "1" }),
        })
        : await fetchJson<{ project: ProjectSummary }>("/api/projects", { method: "POST", body: form });
      onCreated(payload.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
    }
  }
  return (
    createPortal(<div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal project-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="modal-eyebrow">Project Workbench</span>
            <h2>새 프로젝트 만들기</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <p className="muted">프로젝트는 “파일 + 대화 + Workflow App + 산출물”을 묶는 작업대임. 먼저 목적을 고르면 다음 화면에서 바로 할 일이 보임.</p>
        <form onSubmit={submit}>
          <div className="project-template-grid" role="radiogroup" aria-label="Project template">
            {templates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`project-template-card ${template.id === item.id ? "active" : ""}`}
                onClick={() => {
                  setTemplate(item);
                  if (!title.trim()) setTitle(item.defaultTitle);
                }}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <small>{item.output}</small>
              </button>
            ))}
          </div>
          <label>
            <span>Project name</span>
            <input value={title} placeholder={template.defaultTitle || "예: My Research"} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </label>
          <label>
            <span>Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="private">Private - owner and admins</option>
              <option value="public">Public - logged-in users</option>
            </select>
          </label>
          <div className="project-create-preview">
            <strong>생성 후 하는 일</strong>
            {template.id === "investment-advisor" ? (
              <ol>
                <li>샘플 portfolio/target 파일 자동 설치</li>
                <li>Workflow Apps 탭에서 리밸런싱 실행</li>
                <li>차트/표/리포트를 대시보드에서 확인</li>
              </ol>
            ) : (
              <ol>
                <li>프로젝트 파일 추가</li>
                <li>대화나 Workflow App 실행</li>
                <li>Run과 artifact 기록 확인</li>
              </ol>
            )}
          </div>
          {error && <div className="system-note compact">{error}</div>}
          <button className="primary-button" type="submit" disabled={!canSubmit}>
            {template.id === "investment-advisor" ? "투자 작업대 만들기" : "프로젝트 만들기"}
          </button>
        </form>
      </section>
    </div>, document.body)
  );
}

function NewGeneralChatForm({ onCreated, copy = COPY }: { onCreated: (path: string) => void; copy?: SidebarCopy }) {
  function create() {
    onCreated("/");
  }
  return (
    <button className="new-chat-button" type="button" onClick={create}>
      <span>＋</span>{copy.nav.newChat}
    </button>
  );
}

function NewSessionForm({ projectPath, onCreated }: { projectPath: string; onCreated: (path: string) => void }) {
  function startBlankProjectChat() {
    onCreated(`/project/${projectPath}`);
  }
  return (
    <button className="secondary-action project-chat-action" type="button" onClick={startBlankProjectChat}>
      New project chat
    </button>
  );
}

type UsageProvider = { provider: string; usd?: number; calls?: number };
type UsageSummary = {
  month_usd?: number;
  projected_month_usd?: number;
  providers?: UsageProvider[];
};
type UsageDetail = {
  user?: UsageSummary;
  all_accounts?: UsageSummary;
};

function SettingsModal({ account, onClose, onSaved }: { account: AccountSummary; onClose: () => void; onSaved?: () => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [usageDetail, setUsageDetail] = useState<UsageDetail | null>(null);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const profile = (account.profile || {}) as Record<string, string>;
  const copy = copyForAccount(account);
  const usage = (account.usage || {}) as Record<string, unknown>;
  const costUsage = account.cost_usage || {};
  const costMonthly = recordValue(costUsage.monthly);
  const monthly = usageDetail?.user || recordValue(costMonthly.user);
  const allMonthly = usageDetail?.all_accounts || recordValue(costMonthly.all_accounts);
  useEffect(() => {
    fetchJson<UsageDetail>("/api/model-usage").then(setUsageDetail).catch(() => {});
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/profile", { method: "POST", body: form });
      await onSaved?.();
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
            <strong>{String(usage.messages || 0)}</strong>
            <span>{copy.settings.savedMessages}</span>
          </div>
          <div>
            <strong>{String(usage.asks || 0)}</strong>
            <span>{copy.settings.aiRequests}</span>
          </div>
          <div>
            <strong>${Number(monthly.month_usd ?? costUsage.month_usd ?? 0).toFixed(4)}</strong>
            <span>{copy.settings.monthlyApiCost}</span>
          </div>
          <div>
            <strong>${Number(monthly.projected_month_usd ?? 0).toFixed(4)}</strong>
            <span>{copy.settings.monthlyApiForecast || "Month forecast"}</span>
          </div>
          {account.admin && (
            <div>
              <strong>${Number(allMonthly.projected_month_usd ?? costUsage.all_month_usd ?? 0).toFixed(4)}</strong>
              <span>{copy.settings.allAccountForecast || "All accounts forecast"}</span>
            </div>
          )}
        </section>
        <p className="muted cost-note">{String(costUsage.basis || "Estimated token cost. Provider billing is source of truth.")}</p>
        {Array.isArray(monthly.providers) && monthly.providers.length > 0 && (
          <div className="settings-cost-breakdown">
            {(monthly.providers as UsageProvider[]).map((item) => (
              <span key={item.provider}>{item.provider}: ${Number(item.usd || 0).toFixed(4)} · {item.calls} calls</span>
            ))}
          </div>
        )}
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
            <label>
              <span>Design theme</span>
              <select value={theme} onChange={(event) => {
                if (isThemeName(event.target.value)) setTheme(event.target.value);
              }}>
                {themeNames.map((item) => (
                  <option key={item} value={item}>
                    {item === "system" ? `System (${themes[resolvedTheme].label})` : themes[item].label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-help">
              {theme === "system" ? "OS 설정을 따라감." : themes[theme].description}
            </p>
            <p className="settings-help">{copy.settings.modeHelp}</p>
          </fieldset>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : copy.settings.saveProfile}</button>
        </form>
      </section>
    </div>, document.body)
  );
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
