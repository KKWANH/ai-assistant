import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ActionInspector, AutomationPanel, TaskSuggestionsPanel } from "./components/actions/ActionPanels.jsx";
import { ProjectDashboard } from "./components/project/ProjectDashboard.jsx";
import { COPY, copyForAccount, copyForLocale } from "./copy.js";
import "./styles.css";

const DEFAULT_MODEL = "qwen3:4b";
const MODEL_MODES = [
  {
    value: "local",
    group: "local",
    label: "Qwen3 4B Local",
    legacyLabel: "Local only",
    short: "Qwen3 4B",
    provider: "ollama",
    model: "qwen3:4b",
    cloud: false,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Free · local Mac",
    easyPrice: "Free · local Mac",
    privacy: "Local Mac",
    bestFor: "Short questions, notes, everyday chat",
    recommendedUse: "Local/private text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "qwen3:4b · Ollama local",
  },
  {
    value: "local-pro",
    group: "local",
    label: "Qwen3 8B Local",
    short: "Qwen3 8B",
    provider: "ollama",
    model: "qwen3:8b",
    cloud: false,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Free · local Mac",
    easyPrice: "Free · stronger local model",
    privacy: "Local Mac",
    bestFor: "Higher local reasoning for a 24GB Mac mini · pull with Ollama if missing",
    recommendedUse: "Stronger private text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "qwen3:8b · Ollama local",
  },
  {
    value: "cheap",
    group: "fast",
    label: "Gemini 2.5 Flash-Lite",
    legacyLabel: "Cheap cloud",
    short: "Gemini 2.5 Flash-Lite",
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    cloud: true,
    inputPrice: 0.10,
    outputPrice: 0.40,
    agentCalls: 2,
    cost: "~$0.10/M in · ~$0.40/M out",
    easyPrice: "Very cheap · fast cloud",
    privacy: "Cloud AI",
    bestFor: "General questions, fast summaries, low-cost work",
    recommendedUse: "Cheap image analysis",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gemini-2.5-flash-lite",
  },
  {
    value: "gemini-pro",
    group: "reasoning",
    label: "Gemini 2.5 Pro",
    short: "Gemini 2.5 Pro",
    provider: "gemini",
    model: "gemini-2.5-pro",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    agentCalls: 3,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "Higher accuracy · paid",
    privacy: "Cloud AI",
    bestFor: "Complex questions, long writing, accuracy-sensitive work",
    recommendedUse: "Large context and reasoning",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gemini-2.5-pro",
  },
  {
    value: "smart",
    group: "long",
    label: "Kimi K2.6",
    legacyLabel: "Smart cloud",
    short: "Kimi K2.6",
    provider: "kimi",
    model: "kimi-k2.6",
    cloud: true,
    inputPrice: 0.95,
    outputPrice: 4.00,
    agentCalls: 3,
    cost: "~$0.95/M in · ~$4.00/M out",
    easyPrice: "Long context · paid",
    privacy: "Cloud AI",
    bestFor: "Long documents, long context, analysis",
    recommendedUse: "Long context",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "kimi-k2.6",
  },
  {
    value: "kimi-thinking",
    group: "reasoning",
    label: "Kimi Thinking",
    legacyLabel: "Kimi thinking",
    short: "Kimi Thinking",
    provider: "kimi",
    model: "kimi-k2-thinking",
    cloud: true,
    inputPrice: 0.60,
    outputPrice: 2.50,
    agentCalls: 4,
    cost: "~$0.60/M in · ~$2.50/M out",
    easyPrice: "Deep reasoning · slower",
    privacy: "Cloud AI",
    bestFor: "Deep reasoning, long analysis",
    recommendedUse: "Deep reasoning",
    supportsText: true,
    supportsImage: true,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "kimi-k2-thinking",
  },
  {
    value: "coding",
    group: "coding",
    label: "OpenAI GPT-5.1 Codex",
    legacyLabel: "Coding expensive",
    short: "GPT-5.1 Codex",
    provider: "openai",
    model: "gpt-5.1-codex",
    cloud: true,
    inputPrice: 1.25,
    outputPrice: 10.0,
    agentCalls: 4,
    cost: "~$1.25/M in · ~$10/M out",
    easyPrice: "Coding specialist · paid",
    privacy: "Cloud AI",
    bestFor: "Code changes, refactoring, development work",
    recommendedUse: "Codex/code task",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "gpt-5.1-codex",
  },
  {
    value: "ernie",
    group: "cloud",
    label: "ERNIE 5.1",
    short: "ERNIE 5.1",
    provider: "ernie",
    model: "ernie-5.1",
    cloud: true,
    inputPrice: 0,
    outputPrice: 0,
    cost: "Baidu Qianfan API · check console pricing",
    easyPrice: "Qianfan cloud · verify pricing",
    privacy: "Cloud AI",
    bestFor: "Chinese/multilingual work, long context, research analysis",
    recommendedUse: "Multilingual text",
    supportsText: true,
    supportsImage: false,
    supportsFileText: true,
    supportsWebSearch: false,
    version: "ernie-5.1 · Baidu Qianfan API",
  },
];
const MODEL_GROUPS = [
  { value: "recommended", label: "Recommended", match: (model) => ["local", "cheap", "gemini-pro"].includes(model.value) },
  { value: "local", label: "Local", match: (model) => model.group === "local" },
  { value: "fast", label: "Fast", match: (model) => model.group === "fast" },
  { value: "long", label: "Long context", match: (model) => model.group === "long" },
  { value: "reasoning", label: "Reasoning", match: (model) => model.group === "reasoning" },
  { value: "coding", label: "Coding", match: (model) => model.group === "coding" },
  { value: "all", label: "All", match: () => true },
];
const SEARCH_OPTIONS = [
  { value: "off", label: "Search off" },
  { value: "auto", label: "Local context first", legacyLabel: "Local context only" },
  { value: "always", label: "Web search" },
];
const ATTACHMENT_ACCEPT = ".txt,.md,.csv,.json,.yaml,.yml,.pdf,.docx,image/png,image/jpeg,image/gif,image/webp";

const STARTER_ACTIONS = [
  {
    id: "document_summary",
    label: "Summarize document",
    category: "Document",
    status: "Ready",
    description: "Read a PDF, DOCX, TXT, or MD file and start a structured summary.",
    inputs: ".pdf · .docx · .txt · .md",
    output: "Chat answer + Markdown",
    prompt: "Summarize the attached document structurally. Separate core claims, important evidence, and follow-up questions.",
    wantsFile: true,
  },
  {
    id: "image_explain",
    label: "Describe image",
    category: "Image",
    status: "Ready",
    description: "Attach an image and ask the workspace to describe or compare what it sees.",
    inputs: ".png · .jpg · .webp",
    output: "Chat answer",
    prompt: "Describe the attached image. Split visible elements, important context, and things I should verify.",
    wantsFile: true,
  },
  {
    id: "csv_analysis",
    label: "Analyze CSV",
    category: "Data",
    status: "Ready",
    description: "Inspect CSV structure, key figures, and possible outliers.",
    inputs: ".csv",
    output: "Table preview + Summary",
    prompt: "Read the attached CSV and summarize the column structure, key figures, possible outliers, and next analysis steps.",
    wantsFile: true,
  },
  {
    id: "codex_task_prompt",
    label: "Create Codex task prompt",
    category: "Code",
    status: "Ready",
    description: "Turn a goal and constraints into an execution-ready Codex prompt.",
    inputs: "goal · files",
    output: "Codex prompt",
    prompt: "Turn the goal below into a Codex task prompt. Include repo context, constraints, test commands, and acceptance criteria.",
    wantsBrief: true,
  },
  {
    id: "investment_rebalancer",
    label: "Investment rebalancer",
    category: "Investment",
    status: "Ready",
    description: "Start a rebalancing workspace from CSV/YAML inputs.",
    inputs: ".csv · .yaml",
    output: "CSV artifact + Report",
    prompt: "Use the portfolio CSV and target allocation YAML to summarize current weights, target gaps, and rebalance candidates.",
    wantsFile: true,
  },
  {
    id: "folder_index",
    label: "Read folder structure",
    category: "Files",
    status: "Planned",
    description: "Plan a file index for turning a local folder into an AIWS project.",
    inputs: "folder",
    output: "File index",
    prompt: "Propose file grouping and a workspace plan for turning this folder structure into an AIWS project.",
    disabled: true,
  },
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

function fileNeedsVisionModel(file, mode, models = MODEL_MODES) {
  return Boolean(file?.type?.startsWith("image/") && !["kimi", "gemini"].includes(modelMode(mode, models).provider));
}

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
        onClick={() => power && setOpen(!open)}
        aria-label={power ? `Runtime ${runtime?.status || "local"}` : "Connected"}
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
      <MessageTimeline messages={chat?.messages || []} onPreview={onPreview} />
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

function StarterActionsGrid({ actions, onStart, onRun, running = "", hasFile = false, copy = COPY }) {
  const items = actions?.length ? actions.map((action) => ({
    ...action,
    label: action.label || action.title,
    inputs: Array.isArray(action.inputs) ? action.inputs.join(" · ") : action.inputs,
    output: Array.isArray(action.expected_output_artifacts) ? action.expected_output_artifacts.join(" · ") : action.output,
    disabled: String(action.status).toLowerCase() === "planned",
    wantsFile: Array.isArray(action.inputs) && action.inputs.some((item) => String(item).startsWith(".")),
    wantsBrief: action.id === "codex_task_prompt",
  })) : STARTER_ACTIONS;
  const localizedItems = items.map((action) => localizeStarterAction(action, copy));
  return (
    <section className="starter-actions" aria-label={copy.home.quickActions}>
      <div className="section-row">
        <div className="panel-title-stack">
          <p className="eyebrow">{copy.home.quickActions}</p>
          <h2>{copy.home.runBeforeProject}</h2>
        </div>
        <span className="soft-pill">{copy.home.workbenchOutputs}</span>
      </div>
      <div className="starter-grid">
        {localizedItems.map((action) => (
          <article className={`starter-card ${action.disabled ? "is-disabled" : ""}`} key={action.id}>
            <div className="starter-card-head">
              <span className="starter-category">{action.category}</span>
              <span className={`status-badge ${String(action.status).toLowerCase()}`}>{action.status}</span>
            </div>
            <h3>{action.label}</h3>
            <p>{action.description}</p>
            <div className="starter-meta">
                <span>Input: {action.inputs}</span>
                <span>Output: {action.output}</span>
            </div>
            <div className="starter-actions-row">
              <button type="button" onClick={() => onStart?.(action)} disabled={action.disabled}>
                {action.disabled ? copy.home.notAvailable : action.wantsBrief ? copy.home.prepareBrief : hasFile ? copy.home.useInput : copy.home.configure}
              </button>
              <button
                type="button"
                onClick={() => onRun?.(action)}
                disabled={action.disabled || running === action.id || (action.wantsFile && !hasFile)}
                title={action.wantsFile && !hasFile ? copy.home.attachRequired : action.disabled ? copy.home.notAvailable : action.wantsBrief ? copy.home.createPrompt : copy.home.createArtifact}
              >
                {running === action.id ? copy.home.creating : action.wantsBrief ? copy.home.createPrompt : copy.home.createArtifact}
              </button>
            </div>
            {action.wantsFile && !hasFile && <small className="action-requirement">{copy.home.attachRequired}</small>}
            {action.wantsBrief && <small className="action-requirement">{copy.home.codexBriefHint}</small>}
          </article>
        ))}
      </div>
    </section>
  );
}

function localizeStarterAction(action, copy) {
  const localized = copy.starterActions?.[action.id];
  return localized ? { ...action, ...localized } : action;
}

function HomeWorkbenchHints({ copy = COPY }) {
  return (
    <section className="home-hints" aria-label="Home Workbench next steps">
      <article className="home-hint-card">
        <span>1</span>
        <strong>{copy.home.hintCreateTitle}</strong>
        <p>{copy.home.hintCreateBody}</p>
      </article>
      <article className="home-hint-card">
        <span>2</span>
        <strong>{copy.home.hintInspectTitle}</strong>
        <p>{copy.home.hintInspectBody}</p>
      </article>
      <article className="home-hint-card">
        <span>3</span>
        <strong>{copy.home.hintPromoteTitle}</strong>
        <p>{copy.home.hintPromoteBody}</p>
      </article>
    </section>
  );
}

function HomeWorkSessionOverview({ home, hasFile, onAttach, onCreateProject, copy = COPY }) {
  const runCount = home?.runs?.length || 0;
  const artifactCount = home?.artifacts?.length || 0;
  const actionCount = home?.actions?.filter((action) => String(action.status || "").toLowerCase() !== "planned").length || STARTER_ACTIONS.length;
  return (
    <section className="work-session-overview" aria-label="Start a work session">
      <div className="work-session-copy">
        <p className="eyebrow">{copy.home.workSessionEyebrow}</p>
        <h2>{copy.home.workSessionTitle}</h2>
        <p>{copy.home.workSessionBody}</p>
      </div>
      <div className="work-session-lanes">
        <button type="button" className="work-lane" onClick={() => document.querySelector(".start-composer textarea")?.focus()}>
          <strong>{copy.home.laneAsk}</strong>
          <span>{copy.home.laneAskBody}</span>
        </button>
        <button type="button" className={`work-lane ${hasFile ? "ready" : ""}`} onClick={onAttach}>
          <strong>{copy.home.laneFile}</strong>
          <span>{hasFile ? copy.home.laneFileReady : copy.home.laneFileBody}</span>
        </button>
        <button type="button" className="work-lane" onClick={onCreateProject}>
          <strong>{copy.home.laneProject}</strong>
          <span>{copy.home.laneProjectBody}</span>
        </button>
      </div>
      <div className="work-session-facts" aria-label="Persisted workbench facts">
        <span><strong>{actionCount}</strong>{copy.home.factActions}</span>
        <span><strong>{runCount}</strong>{copy.home.factRuns}</span>
        <span><strong>{artifactCount}</strong>{copy.home.factArtifacts}</span>
      </div>
    </section>
  );
}

function HomeWorkbenchPanels({ home, power, onOpenRun, onOpenArtifact, copy = COPY }) {
  const runs = home?.runs || [];
  const artifacts = home?.artifacts || [];
  return (
    <section className="home-object-panels" aria-label="Recent runs and artifacts">
      <div className="dashboard-card">
        <div className="section-row">
          <div className="panel-title-stack">
            <p className="eyebrow">{copy.home.recentRuns}</p>
            <h2>{copy.home.runHistory}</h2>
          </div>
          <span className="soft-pill">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <div className="empty-action-state">
            <p className="muted">{copy.home.starterEmpty}</p>
            <span>{copy.home.starterEmptyAction}</span>
          </div>
        ) : (
          <div className="run-list">
            {runs.slice(0, 6).map((run) => (
              <button className="run-row clickable-row" type="button" key={run.run_id || run.id} onClick={() => onOpenRun?.(run)}>
                <strong>{run.label}</strong>
                <span>{run.status}</span>
                <small>{power ? run.action_id : run.created_at}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="dashboard-card">
        <div className="section-row">
          <div className="panel-title-stack">
            <p className="eyebrow">{copy.home.recentArtifacts}</p>
            <h2>{copy.home.artifacts}</h2>
          </div>
          <span className="soft-pill">{artifacts.length}</span>
        </div>
        {artifacts.length === 0 ? (
          <div className="empty-action-state">
            <p className="muted">{copy.home.artifactEmpty}</p>
            <span>{copy.home.artifactEmptyAction}</span>
          </div>
        ) : (
          <div className="artifact-grid">
            {artifacts.slice(0, 8).map((artifact) => (
              <button className="artifact-tile clickable-row" type="button" key={artifact.id || artifact.path} onClick={() => onOpenArtifact?.(artifact)}>
                <strong>{artifact.path.split("/").pop()}</strong>
                <span>{artifact.viewer_type || artifact.type}</span>
                <small>{artifact.summary || artifact.run?.label}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HomeRunDetailModal({ detail, power, onClose, onOpenArtifact }) {
  const run = detail.run || {};
  const plan = run.execution_plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Work Detail</p>
        <h2>{run.label || run.action_id || "Workbench output"}</h2>
        <div className="run-meta-grid">
          <span>Status: {run.status}</span>
          <span>Action: {run.action_id}</span>
          <span>{run.created_at}</span>
        </div>
        {run.artifacts?.length > 0 && (
          <div className="artifact-list">
            <strong>Artifacts</strong>
            {run.artifacts.map((item) => (
              <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>
                {item.path.split("/").pop()} · {item.viewer_type}
              </button>
            ))}
          </div>
        )}
        {steps.length > 0 && (
          <div className="run-step-list">
            <strong>Steps</strong>
            {steps.map((step) => (
              <span key={step.id || step.type}>
                <b>{step.id || step.type}</b>
                <small>{step.output || step.status || "done"}</small>
              </span>
            ))}
          </div>
        )}
        <details className="run-log-details" open={power}>
          <summary>Logs</summary>
          <pre>{(run.logs || detail.logs || []).map((item) => `[${item.kind || item.type || "log"}] ${item.content || item.message || ""}`).join("\n") || "(empty)"}</pre>
          {run.errors?.length > 0 && <pre className="error-text">{run.errors.join("\n")}</pre>}
        </details>
        {power && (
          <details className="run-log-details">
            <summary>Raw plan</summary>
            <pre>{JSON.stringify(plan, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function HomeArtifactViewer({ artifact, onClose, onAsk, onReport }) {
  const filename = artifact.path?.split("/")?.pop() || artifact.path;
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Artifact Viewer</p>
        <h2>{filename}</h2>
        <small className="artifact-path">{artifact.path}</small>
        <div className="artifact-toolbar">
          <div className="next-actions">
            <button type="button" onClick={() => onAsk?.(artifact)}>Ask AI about this</button>
            <button type="button" onClick={() => onReport?.(artifact)}>Generate report</button>
            <a className="button-link" href={`/api/home-artifact?path=${encodeURIComponent(artifact.path)}`} target="_blank" rel="noreferrer">Open</a>
          </div>
          <span className="soft-pill">{artifact.viewer_type} · {artifact.size} bytes</span>
        </div>
        <HomeArtifactContent artifact={artifact} />
      </div>
    </div>
  );
}

function HomeArtifactContent({ artifact }) {
  const kind = artifact.type || artifact.kind;
  const content = artifact.content || "";
  if (kind === "csv") {
    const rows = content.trim().split(/\r?\n/).slice(0, 80).map((line) => line.split(","));
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
  if (kind === "md" || kind === "markdown") {
    return <MarkdownPreview content={content} />;
  }
  return <pre>{content}</pre>;
}

function MarkdownPreview({ content }) {
  return (
    <div className="markdown-preview" data-markdown-renderer>
      {content.split(/\n{2,}/).map((block, index) => {
        if (block.startsWith("# ")) return <h1 key={index}>{block.slice(2)}</h1>;
        if (block.startsWith("## ")) return <h2 key={index}>{block.slice(3)}</h2>;
        if (block.startsWith("- ")) {
          return (
            <ul key={index}>
              {block.split(/\n/).filter(Boolean).map((line) => <li key={line}>{line.replace(/^- /, "")}</li>)}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
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
      setError(err.message || "Could not change title.");
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
          aria-label="Chat title"
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        {error && <small>{error}</small>}
      </form>
    );
  }
  return (
    <h1 className="editable-title">
      <span>{chat?.session?.title || activePath.sessionSlug}</span>
      <button type="button" onClick={() => setEditing(true)} aria-label="Edit chat title">✎</button>
      {saved && <small className="title-toast">Chat title saved.</small>}
    </h1>
  );
}

function StartPane({ error, navigate, refreshWorkspace, onAsk, account, models = MODEL_MODES, projectPath = "", embedded = false, home, onHome, refreshHome }) {
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
  const [homeRunning, setHomeRunning] = useState("");
  const [homeRunDetail, setHomeRunDetail] = useState(null);
  const [homeArtifact, setHomeArtifact] = useState(null);
  const [homeError, setHomeError] = useState("");
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const modelModes = normalizeModelCatalog(models);
  const selectedMode = modelMode(mode, modelModes);
  const isHomeWorkbench = !embedded && !projectPath;

  useEffect(() => {
    if (!isHomeWorkbench) return;
    const starterId = new URLSearchParams(window.location.search).get("starter");
    if (!starterId) return;
    const rawAction = STARTER_ACTIONS.find((item) => item.id === starterId);
    const action = rawAction ? localizeStarterAction(rawAction, copy) : null;
    if (action && !action.disabled) {
      setContent(action.prompt || action.label);
      if (action.wantsFile) window.setTimeout(() => inputRef.current?.click(), 50);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [copy, isHomeWorkbench]);

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

  function startAction(action) {
    if (action.disabled) return;
    setContent(action.prompt || action.label);
    if (action.wantsFile) {
      window.setTimeout(() => inputRef.current?.click(), 30);
    }
  }

  async function runHomeAction(action) {
    if (!isHomeWorkbench || homeRunning || action.disabled || String(action.status).toLowerCase() === "planned") return;
    if (action.wantsFile && !file) {
      setHomeError(copy.home.attachRequired);
      inputRef.current?.click();
      return;
    }
    if (action.id === "codex_task_prompt" && !content.trim()) {
      setHomeError(copy.home.codexBriefRequired);
      return;
    }
    setHomeRunning(action.id);
    setHomeError("");
    try {
      const form = new FormData();
      form.set("content", content.trim() || action.prompt || action.label || action.title || "");
      form.set("provider", selectedMode.provider);
      form.set("model", selectedMode.model);
      if (file) form.set("attachment", file);
      const payload = await fetchJson(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact) {
        await openHomeArtifact(firstArtifact);
      } else {
        setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
      }
      clearFile();
    } catch (err) {
      setHomeError(err.message || "Could not run Starter Action.");
    } finally {
      setHomeRunning("");
    }
  }

  async function openHomeRun(run) {
    setHomeError("");
    try {
      setHomeRunDetail(await fetchJson(`/api/home-run?run_id=${encodeURIComponent(run.run_id || run.id)}`));
    } catch (err) {
      setHomeError(err.message);
    }
  }

  async function openHomeArtifact(item) {
    setHomeError("");
    try {
      const payload = await fetchJson(`/api/home-artifact?path=${encodeURIComponent(item.path)}`);
      setHomeArtifact(payload.artifact);
    } catch (err) {
      setHomeError(err.message);
    }
  }

  async function askAboutHomeArtifact(artifact) {
    const payload = await fetchJson("/api/home-artifact/ask", {
      method: "POST",
      body: new URLSearchParams({ path: artifact.path }),
    });
    refreshWorkspace?.();
    navigate(`/chat/${payload.project_path}/${payload.session.slug}`);
  }

  async function reportFromHomeArtifact(artifact) {
    setHomeError("");
    try {
      const payload = await fetchJson("/api/home-artifact/report", {
        method: "POST",
        body: new URLSearchParams({ path: artifact.path }),
      });
      onHome?.(payload.home);
      setHomeRunDetail({ run: payload.run, result: { run: payload.run }, stdout: "", stderr: "", markdown: "" });
    } catch (err) {
      setHomeError(err.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (starting || (!content.trim() && !file)) return;
    let submitMode = selectedMode;
    if (fileNeedsVisionModel(file, mode, modelModes)) {
      setMode("cheap");
      submitMode = modelMode("cheap", modelModes);
    }
    setStarting(true);
    setStartError("");
    try {
      const createForm = new URLSearchParams({ title: "" });
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
        askForm.set("provider", submitMode.provider);
        askForm.set("model", submitMode.model);
        askForm.set("search_mode", searchMode);
        if (searchMode === "always") askForm.set("allow_network", "1");
        if (submitMode.cloud) {
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

  function keyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const contentNode = (
      <div className={`start-content ${isHomeWorkbench ? "home-workbench" : ""}`}>
        <div className={isHomeWorkbench ? "home-hero" : ""}>
        {isHomeWorkbench && <p className="eyebrow">Home Workbench</p>}
        <h1>{isHomeWorkbench ? copy.home.workSessionTitle : copy.chat.emptyTitle}</h1>
        <p className="start-subtitle">
          {projectPath
            ? "Your first message creates a saved chat inside this project."
            : copy.home.subtitle}
        </p>
        </div>
        {isHomeWorkbench && (
          <HomeWorkSessionOverview
            home={home}
            hasFile={Boolean(file)}
            onAttach={() => inputRef.current?.click()}
            onCreateProject={() => navigate("/projects/new")}
            copy={copy}
          />
        )}
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
          {dragging && <div className="drop-hint">Drop a file to attach it to the first message.</div>}
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={keyDown}
            placeholder={copy.chat.placeholder}
            rows={1}
          />
          {file && (
            <div className="selected-file">
              {previewUrl && <img src={previewUrl} alt={file.name} />}
              <span>{file.name}</span>
              <small>{selectedMode.supportsImage && file.type.startsWith("image/") ? "Sent as image input" : file.type.startsWith("image/") ? "Needs vision model" : "Read as text"}</small>
              <button type="button" data-remove-attachment onClick={clearFile}>Remove</button>
            </div>
          )}
          {file?.type?.startsWith("image/") && !selectedMode.supportsImage && (
            <div className="system-note compact-warning">This image needs a vision model. AIWS will switch to Gemini Flash-Lite before sending.</div>
          )}
          <div className={`composer-toolbar ${power ? "start-toolbar" : ""}`}>
            <label className="attach-key" title="Attach file">
              {power ? copy.chat.attachFile : copy.chat.attachFile}
              <input
                ref={inputRef}
                data-attachment-input
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                accept={ATTACHMENT_ACCEPT}
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
              modelCatalog={modelModes}
            />
            <select className="search-select" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
              {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{copy.search[item.value] || item.label}</option>)}
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
        {starting && <WaitingNotice label={copy.chat.preparing} />}
        {isHomeWorkbench ? (
          <>
            <StarterActionsGrid
              actions={home?.actions}
              onStart={startAction}
              onRun={runHomeAction}
              running={homeRunning}
              hasFile={Boolean(file)}
              copy={copy}
            />
            <HomeWorkbenchPanels
              home={home}
              power={power}
              copy={copy}
              onOpenRun={openHomeRun}
              onOpenArtifact={openHomeArtifact}
            />
            <HomeWorkbenchHints copy={copy} />
          </>
        ) : (
          <div className="quick-actions">
            {copy.chat.quickPrompts.map((item) => <button type="button" key={item} onClick={() => setContent(item)}>{item}</button>)}
          </div>
        )}
        <p className="honest-note">AIWS prioritizes saved chats, project context, and attached files. Agentic web/search execution is exposed through controlled actions and plan previews.</p>
        {startError && <div className="system-note">{startError}</div>}
        {homeError && <div className="system-note">{homeError}</div>}
        {error && <div className="system-note">{error}</div>}
        {homeRunDetail && (
          <HomeRunDetailModal
            detail={homeRunDetail}
            power={power}
            onClose={() => setHomeRunDetail(null)}
            onOpenArtifact={openHomeArtifact}
          />
        )}
        {homeArtifact && (
          <HomeArtifactViewer
            artifact={homeArtifact}
            onClose={() => setHomeArtifact(null)}
            onAsk={askAboutHomeArtifact}
            onReport={reportFromHomeArtifact}
          />
        )}
      </div>
  );
  if (embedded) {
    return <div className="start-pane embedded-start-pane">{contentNode}</div>;
  }
  return <section className="center-pane start-pane">{contentNode}</section>;
}

function MessageTimeline({ messages, onPreview }) {
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
        <MessageCard key={`${index}-${message.role}`} message={message} onPreview={onPreview} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function MessageCard({ message, onPreview }) {
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  return (
    <article className={`message-card ${message.role} ${message.pending ? "is-pending" : ""}`}>
      <div className="message-meta">
        <strong>{messageAuthorLabel(message)}</strong>
        {message.created_at && <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>}
        {message.provider && <span>{message.provider} {message.model}</span>}
        {message.estimated_cost !== null && message.estimated_cost !== undefined && <span>USD {message.estimated_cost}</span>}
      </div>
      {message.pending ? <WaitingNotice label={copy.chat.assistantThinking} compact /> : <RenderedText text={message.content || ""} />}
      {message.context_receipt && <ContextReceipt receipt={message.context_receipt} compact />}
      {message.execution_plan && <PlannerTraceSummary plan={message.execution_plan} />}
      <AttachmentList attachments={message.attachments || []} onPreview={onPreview} />
    </article>
  );
}

function ContextReceipt({ receipt, compact = false }) {
  if (!receipt) return null;
  const used = Array.isArray(receipt.used_files) ? receipt.used_files : [];
  const unused = Array.isArray(receipt.unused_files) ? receipt.unused_files : [];
  const excluded = Array.isArray(receipt.excluded) ? receipt.excluded : [];
  const chunks = Array.isArray(receipt.included_chunks) ? receipt.included_chunks : [];
  const privacy = receipt.privacy || {};
  return (
    <details className={`context-receipt ${compact ? "compact" : ""}`}>
      <summary>View context receipt · {receipt.privacy_mode === "local" ? "local" : "cloud"} · {chunks.length || used.length} chunks used</summary>
      <div className="receipt-grid">
        <span><strong>Model</strong><small>{receipt.provider} {receipt.model}</small></span>
        <span><strong>Cost</strong><small>{receipt.estimated_cost ?? 0} {receipt.currency || "USD"}</small></span>
        <span><strong>Tokens</strong><small>{receipt.input_tokens || 0} in · {receipt.output_tokens || 0} out</small></span>
        <span><strong>Used files</strong><small>{used.length ? used.map((item) => item.filename).join(", ") : "None"}</small></span>
        <span><strong>Not used</strong><small>{unused.length ? unused.map((item) => item.filename).join(", ") : "None"}</small></span>
        <span><strong>Cloud files</strong><small>{privacy.files_sent_to_cloud?.length ? privacy.files_sent_to_cloud.join(", ") : "None"}</small></span>
      </div>
      {chunks.length > 0 && (
        <div className="receipt-chunks">
          {chunks.slice(0, 4).map((chunk) => (
            <span key={chunk.chunk_id || `${chunk.path}-${chunk.token_count}`}>
              <strong>{chunk.filename || chunk.path}</strong>
              <small>{chunk.reason} · {chunk.token_count} tokens · {chunk.privacy}</small>
            </span>
          ))}
        </div>
      )}
      {excluded.length > 0 && <p className="muted">{excluded.length} file/path exclusions were active.</p>}
    </details>
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
    if (item.extraction_status === "failed") return "Read failed";
    if (item.extraction_status === "success") return "Text extracted";
    if (item.delivery === "Sent as vision input") return "Sent as image input";
    if (item.delivery === "Sent as text context") return "Used as text";
    return item.delivery || "Attached to chat";
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

function Composer({ activePath, onAsk, account, power, models = MODEL_MODES }) {
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
  const modelModes = normalizeModelCatalog(models);
  const selectedMode = modelMode(mode, modelModes);
  const copy = copyForAccount(account);

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
    let submitMode = selectedMode;
    if (fileNeedsVisionModel(file, mode, modelModes)) {
      setMode("cheap");
      submitMode = modelMode("cheap", modelModes);
    }
    const form = new FormData();
    form.set("content", content);
    form.set("provider", submitMode.provider);
    form.set("model", submitMode.model);
    form.set("search_mode", searchMode);
    if (searchMode === "always") form.set("allow_network", "1");
    if (submitMode.cloud) {
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
      {dragging && <div className="drop-hint">Drop a file to attach it to this message.</div>}
      <textarea
        ref={textRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={keyDown}
        placeholder={copy.chat.placeholder}
      />
          {file && (
        <div className="selected-file">
          {previewUrl && <img src={previewUrl} alt={file.name} />}
          <span>{file.name}</span>
          <small>{selectedMode.supportsImage && file.type.startsWith("image/") ? "Sent as image input" : file.type.startsWith("image/") ? "Needs vision model" : "Read as text"}</small>
          <button type="button" data-remove-attachment onClick={clearFile}>Remove</button>
        </div>
      )}
      {file?.type?.startsWith("image/") && !selectedMode.supportsImage && (
        <div className="system-note compact-warning">This image needs a vision model. AIWS will switch to Gemini Flash-Lite before sending.</div>
      )}
      <div className="composer-toolbar">
        <label className="attach-key" title="Attach file">
          {copy.chat.attachFile}
          <input
            ref={inputRef}
            data-attachment-input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            accept={ATTACHMENT_ACCEPT}
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
            modelCatalog={modelModes}
          />
        <select className="search-select" name="search_mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Search mode">
          {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{copy.search[item.value] || item.label}</option>)}
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
    </form>
  );
}

function ModelPickerButton({ open, setOpen, selectedKey, onSelect, content, hasFile, power, modelCatalog = [] }) {
  const models = normalizeModelCatalog(modelCatalog);
  const mode = modelMode(selectedKey, models);
  const [group, setGroup] = useState("recommended");
  const wrapRef = useRef(null);
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  const visibleModels = models.filter((item) => (MODEL_GROUPS.find((entry) => entry.value === group) || MODEL_GROUPS[0]).match(item));
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
            <div>
              <strong>{copy.modelPicker.title}</strong>
              <small>{mode.label} {copy.modelPicker.selected}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </header>
          <div className="model-quick-row">
            {MODEL_GROUPS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={group === item.value ? "active" : ""}
                onClick={() => setGroup(item.value)}
              >
                {copy.modelPicker.groups[item.value] || item.label}
              </button>
            ))}
          </div>
          <div className="model-grid">
            {visibleModels.map((item) => {
              const selected = item.value === selectedKey;
              const singleEstimate = estimateCurrentCost(item, content, hasFile);
              const agentCalls = item.agentCalls || (item.cloud ? 2 : 1);
              const agentEstimate = estimateCurrentCost(item, content, hasFile, agentCalls);
              const catalog = models.find((entry) => entry.provider === item.provider && entry.model === item.model);
              const keyStatus = item.cloud ? (catalog?.api_key_configured ? "API key connected" : "API key missing") : "Local";
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
                  <span className="model-card-version">{item.version || item.model}</span>
                  <span className="model-card-privacy">{item.cloud ? "Cloud AI" : "Local Mac"}</span>
                  <span>{item.recommendedUse || item.bestFor}</span>
                  <span className="model-card-capabilities">
                    {item.supportsText && "Text"}
                    {item.supportsImage ? " · Image" : " · No image"}
                    {item.supportsFileText && " · File text"}
                    {item.supportsWebSearch ? " · Web" : " · No web"}
                  </span>
                  <span className="model-card-price">{power && item.cloud && item.inputPrice > 0 ? `Input ~$${item.inputPrice.toFixed(2)} / 1M · output ~$${item.outputPrice.toFixed(2)} / 1M` : item.easyPrice || item.cost}</span>
                  <span className="model-card-estimate">Single call estimate: {singleEstimate}</span>
                  {item.cloud && <span className="model-card-estimate">Agent {agentCalls}-step budget: {agentEstimate}</span>}
                  {item.cloud && <span className="model-card-estimate">Actual cost accumulates per executed model call</span>}
                  <span className={`model-key-status ${item.cloud && !catalog?.api_key_configured ? "missing" : ""}`}>{keyStatus}</span>
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
      <strong>{mode.label} is a cloud AI model.</strong>
      <p>The selected chat content{hasFile ? " and attachment content" : ""} may be sent to an external API. Estimated cost: {estimateCurrentCost(mode, "", hasFile)}</p>
      <div>
        <button type="button" onClick={onUseOnce}>Use once</button>
        <button type="button" onClick={onUseAlways}>Keep using this model</button>
        <button type="button" onClick={onCancel}>Cancel</button>
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
  if (!mode.cloud) return "Free · local Mac";
  return mode.easyPrice || "Paid";
}

function estimateCurrentCost(mode, content, hasFile, calls = 1) {
  if (!mode.cloud) return "$0";
  if (!(mode.inputPrice > 0) && !(mode.outputPrice > 0)) return "Verify pricing";
  const inputTokens = Math.max(120, Math.ceil(String(content || "").length / 3) + (hasFile ? 3000 : 0));
  const outputTokens = 1024;
  const estimated = ((inputTokens / 1_000_000) * mode.inputPrice + (outputTokens / 1_000_000) * mode.outputPrice) * calls;
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

function modelLabel(model, models = MODEL_MODES) {
  return normalizeModelCatalog(models).find((item) => item.model === model)?.label || model;
}

function modelMode(value, models = MODEL_MODES) {
  const normalized = normalizeModelCatalog(models);
  return normalized.find((item) => item.value === value) || normalized.find((item) => item.value === "local") || normalized[0] || MODEL_MODES[0];
}

function normalizeModelCatalog(models = []) {
  if (!Array.isArray(models) || models.length === 0) return MODEL_MODES;
  return models.map((item) => ({
    value: item.value,
    group: item.group || (item.privacy === "local" ? "local" : "cloud"),
    label: item.label || item.model,
    legacyLabel: item.legacyLabel || item.legacy_label || "",
    short: item.short || item.model,
    provider: item.provider,
    model: item.model,
    cloud: Boolean(item.cloud ?? item.privacy === "cloud"),
    inputPrice: Number(item.inputPrice ?? item.input_per_million ?? 0),
    outputPrice: Number(item.outputPrice ?? item.output_per_million ?? 0),
    agentCalls: Number(item.agentCalls || 0),
    cost: item.cost || item.note || "",
    easyPrice: item.easyPrice || item.cost || "",
    privacy: item.privacy === "local" ? "Local Mac" : item.privacy || (item.cloud ? "Cloud AI" : "Local Mac"),
    bestFor: item.bestFor || item.recommendedUse || item.recommended_use || "",
    recommendedUse: item.recommendedUse || item.recommended_use || "",
    supportsText: Boolean(item.supportsText ?? item.supports_text ?? true),
    supportsImage: Boolean(item.supportsImage ?? item.supports_image),
    supportsFileText: Boolean(item.supportsFileText ?? item.supports_file_text ?? true),
    supportsWebSearch: Boolean(item.supportsWebSearch ?? item.supports_web_search),
    version: item.version || item.model,
    api_key_configured: Boolean(item.api_key_configured),
  })).filter((item) => item.value && item.provider && item.model);
}

function searchLabel(mode) {
  return SEARCH_OPTIONS.find((item) => item.value === mode)?.label || `Search ${mode}`;
}

function providerFriendlyLabel(provider) {
  return provider === "kimi" ? "High-context AI" : "Fast local AI";
}

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

function ContextPanel({ chat, activePath, runtime, openclaw, automations = [], projectConfig, onProjectConfig, onAutomations, onPreview, onChat, account, onOpenRun, onOpenArtifact }) {
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const tabs = power ? ["context", "files", "memory", "runs", "artifacts", "diagnostics"] : ["context", "files", "memory", "runs", "artifacts"];
  const [tab, setTab] = useState("context");
  const currentTab = tabs.includes(tab) ? tab : "context";
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
        <h2>{power ? copy.inspector.powerTitle : copy.inspector.title}</h2>
        <section>
          <h3>{copy.inspector.currentContext}</h3>
          <p className="muted">{copy.inspector.emptyPurpose}</p>
        </section>
        <ActionInspector projectConfig={projectConfig} power={power} />
        {power && <RuntimePanel runtime={runtime} />}
        {power && <OpenClawPanel openclaw={openclaw} />}
        {power && <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />}
      </aside>
    );
  }
  const attachments = collectVisibleAttachments(chat);
  const runs = projectConfig?.runs || [];
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((artifact) => ({ ...artifact, run })));
  const latestReceipt = latestContextReceipt(chat);
  const manifest = chat?.context_manifest || {};
  const manifestChunks = Array.isArray(manifest.included_chunks) ? manifest.included_chunks : [];
  const manifestExcluded = Array.isArray(manifest.excluded) ? manifest.excluded : [];
  return (
    <aside className={`workbench context-panel ${power ? "power" : "easy"}`}>
      <h2>{power ? copy.inspector.powerTitle : copy.inspector.title}</h2>
      <section className="context-summary">
        <h3>{copy.inspector.currentContext}</h3>
        <p><strong>{chat?.project?.hidden ? "General chat" : chat?.project?.title || activePath.projectPath}</strong></p>
        {power && <p className="muted">{activePath.projectPath} / {activePath.sessionSlug}</p>}
        <div className="skill-stack">
          {(chat?.skills || []).map((skill) => <span key={skill}>{skill}</span>)}
        </div>
        <div className="inspector-fact-grid">
          <span><strong>{latestReceipt?.included_chunks?.length || manifestChunks.length || 0}</strong>{copy.inspector.factChunks}</span>
          <span><strong>{attachments.length}</strong>{copy.inspector.factFiles}</span>
          <span><strong>{runs.length}</strong>{copy.inspector.factRuns}</span>
          <span><strong>{artifacts.length}</strong>{copy.inspector.factArtifacts}</span>
        </div>
      </section>
      <ContextManifestCard manifest={chat?.context_manifest} power={power} />
      <div className="context-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item} type="button" className={currentTab === item ? "active" : ""} onClick={() => setTab(item)}>
            {copy.inspector.tabs[item]}
          </button>
        ))}
      </div>
      {currentTab === "context" && (
        <section>
          <h3>{latestReceipt ? "Latest context receipt" : "What will be sent"}</h3>
          {latestReceipt ? <ContextReceipt receipt={latestReceipt} /> : <p className="muted">Send a message to create a receipt showing files, privacy mode, model, exclusions, and estimated cost.</p>}
          <ActionInspector projectConfig={projectConfig} power={power} />
          <GoalPanel chat={chat} activePath={activePath} onChat={onChat} power={power} />
        </section>
      )}
      {currentTab === "files" && (
        <section>
          <h3>Active files</h3>
          {attachments.length === 0 ? <div className="empty-action-state"><p className="muted">No files are attached to this chat yet.</p><span>Attach file from the composer or start from file on Home.</span></div> : <AttachmentList attachments={attachments} onPreview={onPreview} />}
          {manifestChunks.length > 0 && (
            <div className="manifest-file-facts">
              <strong>{copy.inspector.includedChunks}</strong>
              {manifestChunks.slice(0, 5).map((chunk) => (
                <span key={chunk.chunk_id || chunk.path}>
                  {chunk.filename || chunk.path}
                  <small>{chunk.reason} · {chunk.privacy}</small>
                </span>
              ))}
            </div>
          )}
          {power && manifestExcluded.length > 0 && (
            <details className="manifest-exclusions">
              <summary>{manifestExcluded.length} exclusions</summary>
              {manifestExcluded.slice(0, 8).map((item, index) => (
                <span key={`${item.path || item.pattern}-${index}`}>
                  {item.path || item.pattern}
                  <small>{item.reason}</small>
                </span>
              ))}
            </details>
          )}
        </section>
      )}
      {currentTab === "memory" && (
        <section>
          <h3>Workspace memory</h3>
          <p className="muted">Profile memory, project notes, and chat summaries are available as explicit context when the workspace includes them.</p>
        </section>
      )}
      {currentTab === "runs" && (
        <section>
          <h3>{copy.inspector.tabs.runs}</h3>
          {runs.length === 0 ? <div className="empty-action-state"><p className="muted">No project runs yet.</p><span>Run an aiws.yaml action to create logs and artifacts.</span></div> : (
            <div className="compact-list">
              {runs.slice(0, 6).map((run) => (
                <button type="button" className="compact-row-button" key={run.run_id || `${run.command}-${run.created_at}`} onClick={() => onOpenRun?.(run)}>
                  <strong>{run.label || run.command}</strong>
                  <small>{run.status} · {run.created_at}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {currentTab === "artifacts" && (
        <section>
          <h3>{copy.inspector.tabs.artifacts}</h3>
          {artifacts.length === 0 ? <div className="empty-action-state"><p className="muted">No artifacts yet.</p><span>Run an action to generate shareable files.</span></div> : (
            <div className="compact-list">
              {artifacts.slice(0, 8).map((artifact) => (
                <button type="button" className="compact-row-button" key={`${artifact.run.run_id}-${artifact.path}`} onClick={() => onOpenArtifact?.(artifact)}>
                  <strong>{artifact.path}</strong>
                  <small>{artifact.exists ? `${artifact.size} bytes` : "not found"} · {artifact.run.label || artifact.run.command}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {power && currentTab === "diagnostics" && (
        <section>
          <h3>{copy.inspector.tabs.diagnostics}</h3>
          <RuntimePanel runtime={runtime} />
          <OpenClawPanel openclaw={openclaw} />
          <div className="runtime-card diagnostics-link-card">
            <strong>Local Diagnostics</strong>
            <p>Open the protected local dashboard for model failures, logs, tunnel status, and structured health checks.</p>
            <a href="http://127.0.0.1:8790" target="_blank" rel="noreferrer">Open diagnostics dashboard</a>
            <code>scripts/aiws-admin-dashboard.sh</code>
          </div>
          <AutomationPanel projects={automations} onAutomations={onAutomations} fetchJson={fetchJson} formatDate={formatDate} />
          <a href={`/prompt/${activePath.projectPath}/${activePath.sessionSlug}`}>Open prompt context</a>
          <code>aiws prompt {activePath.projectPath} {activePath.sessionSlug} --root ~/.ai-workspace</code>
        </section>
      )}
    </aside>
  );
}

function ContextManifestCard({ manifest, power }) {
  if (!manifest) return null;
  const included = manifest.included || [];
  const excluded = manifest.excluded || [];
  const estimates = manifest.estimates || {};
  return (
    <section className="manifest-card">
      <h3>Context Manifest</h3>
      {included.length === 0 ? (
        <p className="muted">This chat has little additional context.</p>
      ) : (
        <div className="manifest-list">
          {included.map((item, index) => (
            <span key={`${item.type}-${index}`}>
              {manifestLabel(item)}
            </span>
          ))}
        </div>
      )}
      {power && (
        <div className="manifest-details">
          <small>{estimates.input_tokens || 0} estimated tokens</small>
          {estimates.estimated_cost !== null && estimates.estimated_cost !== undefined && <small>~USD {estimates.estimated_cost}</small>}
          <small>{manifest.privacy_mode === "local" ? "local-only" : "cloud allowed"}</small>
        </div>
      )}
      {power && excluded.length > 0 && <p className="muted">{excluded.length} security exclusion patterns are active.</p>}
    </section>
  );
}

function manifestLabel(item) {
  if (item.type === "goal") return `Goal: ${item.label}`;
  if (item.type === "skills") return `${item.count} skills`;
  if (item.type === "chat_files") return `${item.count} chat files`;
  if (item.type === "project_files") return `${item.count} project files`;
  if (item.type === "recent_runs") return `${item.count} recent runs`;
  return item.label || item.type;
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

function latestContextReceipt(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.context_receipt) return messages[index].context_receipt;
  }
  return null;
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
        <button type="button" data-edit-goal onClick={() => setEditing(true)}>{goal.objective ? "Edit goal" : "Set goal"}</button>
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
  const copy = copyForLocale(document.documentElement.lang || navigator.language || "en");
  return (
    <div className="runtime-card">
      <strong>Runtime</strong>
      <p>{runtime?.status || "local"}</p>
      {url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span className="muted">No public tunnel URL.</span>}
      {url && <p className="warning-text">{copy.inspector.diagnosticsWarning}</p>}
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
