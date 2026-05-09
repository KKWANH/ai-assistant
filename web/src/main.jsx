import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const DEFAULT_MODEL = "qwen3:0.6b";
const MODEL_OPTIONS = [
  { value: "qwen3:0.6b", label: "qwen3:0.6b - local, fastest, basic" },
  { value: "qwen3:8b", label: "qwen3:8b - local, better, slower" },
  { value: "kimi-k2.5", label: "Kimi K2.5 - cloud, cheap, strong" },
  { value: "kimi-k2.6", label: "Kimi K2.6 - cloud, latest if enabled" },
  { value: "kimi-k2-thinking", label: "Kimi Thinking - cloud, smarter, slower" },
];
const SEARCH_OPTIONS = [
  { value: "off", label: "검색 안 함" },
  { value: "auto", label: "로컬 컨텍스트 우선" },
  { value: "always", label: "웹 검색 준비 중" },
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
  const token = document.cookie
    .split("; ")
    .find((item) => item.startsWith("aiws_csrf="))
    ?.split("=")[1];
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

function App() {
  const [workspace, setWorkspace] = useState(null);
  const [chat, setChat] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState("");
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

  useEffect(() => {
    if (isLogin) return;
    refreshWorkspace().catch((err) => setError(err.message));
    refreshRuntime().catch(() => {});
    const id = window.setInterval(() => refreshRuntime().catch(() => {}), 15000);
    return () => window.clearInterval(id);
  }, [isLogin]);

  useEffect(() => {
    if (isLogin) return;
    refreshChat(activePath).catch((err) => setError(err.message));
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

  if (isLogin) {
    return (
      <div className="app-shell auth-shell">
        <LoginPage />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar runtime={runtime} />
      <main className="layout">
        <Sidebar workspace={workspace} activePath={activePath} navigate={navigate} onRefresh={refreshWorkspace} />
        <CenterPane
          chat={chat}
          activePath={activePath}
          account={workspace?.account}
          onAsk={afterAsk}
          onPreview={setLightbox}
          error={error}
          navigate={navigate}
          refreshWorkspace={refreshWorkspace}
        />
        <Workbench chat={chat} activePath={activePath} runtime={runtime} onPreview={setLightbox} onChat={setChat} />
      </main>
      {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function TopBar({ runtime }) {
  const url = runtime?.cloudflare_url || "";
  const label = url ? "Cloudflare" : "Local";
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="brand-mark" /> Assistant
      </a>
      {url && <a className="runtime-link" href={url} target="_blank" rel="noreferrer">{url.replace("https://", "")}</a>}
      <span className="runtime-pill"><span className="status-lamp" />{label}</span>
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
          <h1 id="login-title">로그인</h1>
          <p className="login-copy">프로젝트, 대화, 파일 컨텍스트를 안전하게 여는 개인 AI 작업실입니다.</p>
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
          <p>대화는 워크스페이스 파일로 보관되고, 외부 접속은 인증 뒤에만 열립니다.</p>
        </div>
        <div className="status-card">
          <strong>Project memory</strong>
          <p>프로젝트, 세션, 스킬, 첨부파일 컨텍스트를 한 곳에서 이어갑니다.</p>
        </div>
      </aside>
    </main>
  );
}

function Sidebar({ workspace, activePath, navigate, onRefresh }) {
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const projects = workspace?.projects || [];
  const chats = workspace?.chats || [];
  const account = workspace?.account || { username: "local", nickname: "Kwanho Kim", display_name: "Kwanho Kim", profile: {} };
  const activeIsGeneralChat = chats.some((project) => project.path === activePath.projectPath);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      `${project.title} ${project.path} ${project.sessions.map((s) => s.title).join(" ")}`.toLowerCase().includes(needle)
    );
  }, [projects, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-account">
        <button className="account-button" type="button" onClick={() => setSettingsOpen(true)}>
          {account.avatar_url ? <img src={account.avatar_url} alt="" /> : <span>{initials(account.display_name || account.username)}</span>}
          <strong>{account.display_name || account.username}</strong>
        </button>
      </div>
      <section className="sidebar-actions">
        <NewGeneralChatForm onCreated={(path) => { onRefresh(); navigate(path); }} />
        <NewProjectForm onCreated={onRefresh} />
        {activePath.projectPath && !activeIsGeneralChat && <NewSessionForm projectPath={activePath.projectPath} onCreated={(path) => navigate(path)} />}
      </section>
      <label className="visually-hidden" htmlFor="workspace-search">Search workspace</label>
      <input id="workspace-search" className="search-box" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspace" />
      <nav className="project-tree" aria-label="Workspace">
        {!workspace && <div className="empty-card">Loading workspace...</div>}
        {chats.length > 0 && (
          <section className="tree-section chat-section">
            <h2><span>Personal chats</span><em>Chat</em></h2>
            {chats.flatMap((project) =>
              project.sessions.map((session) => (
                <button
                  key={`${project.path}/${session.slug}`}
                  type="button"
                  className={`session-slip general ${project.path === activePath.projectPath && session.slug === activePath.sessionSlug ? "active" : ""}`}
                  onClick={() => navigate(`/chat/${project.path}/${session.slug}`)}
                >
                  <em className="item-kind">Chat</em>
                  <span>{session.title}</span>
                  <small>{session.created_at?.slice(0, 10) || "chat"}</small>
                </button>
              ))
            )}
          </section>
        )}
        {workspace && projects.length > 0 && <div className="tree-heading"><span>Projects</span><em>Project</em></div>}
        {workspace && projects.length === 0 && (
          <div className="empty-card">
            <strong>No projects yet.</strong>
            <p>Projects hold sessions, skills, files, and context.</p>
          </div>
        )}
        {filtered.map((project) => (
          <ProjectNode key={project.path} project={project} activePath={activePath} navigate={navigate} />
        ))}
      </nav>
      {settingsOpen && <SettingsModal account={account} onClose={() => setSettingsOpen(false)} onSaved={onRefresh} />}
    </aside>
  );
}

function initials(value) {
  return String(value || "A").trim().slice(0, 1).toUpperCase();
}

function ProjectNode({ project, activePath, navigate }) {
  return (
    <div className={`project-node level-${project.level}`}>
      <button
        type="button"
        className={`folder-card ${project.path === activePath.projectPath ? "active" : ""}`}
        onClick={() => navigate(project.firstSessionUrl || `/project/${project.path}`)}
      >
        <span>{project.title}</span>
        <em className="item-kind">Project</em>
        <small>{project.created_at?.slice(0, 10) || "local"}</small>
      </button>
      <div className="session-list">
        {project.sessions.map((session) => (
          <button
            key={session.slug}
            type="button"
            className={`session-slip ${project.path === activePath.projectPath && session.slug === activePath.sessionSlug ? "active" : ""}`}
            onClick={() => navigate(`/chat/${project.path}/${session.slug}`)}
          >
            <em className="item-kind">Session</em>
            <span>{session.title}</span>
            <small>{session.created_at?.slice(0, 10) || "session"}</small>
          </button>
        ))}
      </div>
    </div>
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
    await fetch("/projects", { method: "POST", body: form, headers: csrfHeader() });
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

function NewGeneralChatForm({ onCreated }) {
  const [creating, setCreating] = useState(false);
  async function create() {
    if (creating) return;
    setCreating(true);
    const form = new URLSearchParams({ title: "New chat" });
    const response = await fetch("/api/chats", { method: "POST", body: form, headers: csrfHeader() });
    const payload = await response.json();
    setCreating(false);
    if (!response.ok) throw new Error(payload.error || "Could not create chat.");
    onCreated(`/chat/${payload.project_path}/${payload.session.slug}`);
  }
  return (
    <button className="new-chat-button" type="button" onClick={create} disabled={creating}>
      <span>＋</span>{creating ? "Creating..." : "New chat"}
    </button>
  );
}

function NewSessionForm({ projectPath, onCreated }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const canSubmit = title.trim().length > 0;
  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const form = new URLSearchParams({ title });
    const response = await fetch(`/api/sessions/${projectPath}`, { method: "POST", body: form, headers: csrfHeader() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not create session.");
    setTitle("");
    setOpen(false);
    onCreated(`/chat/${projectPath}/${payload.session.slug}`);
  }
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>New chat in project</summary>
      <form onSubmit={submit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Chat title" aria-label="Chat title" />
        <button className="primary-button" type="submit" disabled={!canSubmit}>Create</button>
      </form>
    </details>
  );
}

function CenterPane({ chat, activePath, account, onAsk, onPreview, error, navigate, refreshWorkspace }) {
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <StartPane error={error} navigate={navigate} refreshWorkspace={refreshWorkspace} onAsk={onAsk} account={account} />
    );
  }

  return (
    <section className="center-pane">
      <div className="chat-header">
        <div>
          <p className="breadcrumb">{chat?.project?.hidden ? "Chats" : "Workspace"} / {chat?.project?.title || activePath.projectPath}</p>
          <h1>{chat?.session?.title || activePath.sessionSlug}</h1>
        </div>
        <div className="context-chips">
          <span>Provider {chat?.latest?.provider || "ollama"}</span>
          <span>Model {modelLabel(chat?.latest?.model || DEFAULT_MODEL)}</span>
          <span>{searchLabel(chat?.latest?.search_mode || "off")}</span>
        </div>
      </div>
      <MessageTimeline messages={chat?.messages || []} onPreview={onPreview} />
      <Composer activePath={activePath} onAsk={onAsk} account={account} />
    </section>
  );
}

function StartPane({ error, navigate, refreshWorkspace, onAsk, account }) {
  const [content, setContent] = useState("");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [searchMode, setSearchMode] = useState("off");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const createForm = new URLSearchParams({ title: content.trim().slice(0, 48) });
      const created = await fetchJson("/api/chats", { method: "POST", body: createForm });
      const path = `/chat/${created.project_path}/${created.session.slug}`;
      navigate(path);
      refreshWorkspace().catch(() => {});
      if (content.trim()) {
        onAsk({
          project: { path: created.project_path, title: "General chats", hidden: true },
          session: created.session,
          messages: [
            { role: "user", actor_display: accountDisplayName(account), content: content.trim(), attachments: [] },
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
        askForm.set("provider", provider);
        askForm.set("model", model);
        askForm.set("search_mode", searchMode);
        const payload = await fetchJson(`/api/ask/${created.project_path}/${created.session.slug}`, {
          method: "POST",
          body: askForm,
        });
        onAsk(payload);
      }
      setContent("");
    } catch (err) {
      setStartError(err.message || "Could not start chat.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="center-pane start-pane">
      <div className="start-content">
        <h1>지금 무슨 생각을 하시나요?</h1>
        <form className="start-composer" onSubmit={submit}>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="무엇이든 물어보세요"
            rows={1}
          />
          <div className="composer-toolbar">
            <span className="attach-key muted">Attach after chat starts</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="ollama">ollama</option>
              <option value="kimi">kimi</option>
            </select>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={searchMode} onChange={(event) => setSearchMode(event.target.value)}>
              {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button className="send-key" type="submit" disabled={starting}>{starting ? <span className="typing" /> : "Send"}</button>
          </div>
        </form>
        {starting && <WaitingNotice label="Assistant is preparing your answer" />}
        <p className="honest-note">웹 검색과 이미지 생성은 아직 꺼져 있습니다. 현재는 저장된 프로젝트/세션/파일 컨텍스트만 사용합니다.</p>
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
  return (
    <div className="attachment-list">
      {attachments.map((item) =>
        item.is_image || item.is_pdf ? (
          <button key={item.url} className="attachment-card image" type="button" onClick={() => onPreview(item)}>
            {item.is_image ? <img src={item.url} alt={item.filename} /> : <span className="pdf-thumb" data-pdf-preview>PDF</span>}
            <span>{item.filename}</span>
            <small>{item.delivery || "Attached to chat"}</small>
          </button>
        ) : (
          <a key={item.url} className="attachment-card" href={item.url} target="_blank" rel="noreferrer">
            {item.filename}
            <small>{item.delivery || "Sent as text context"}</small>
          </a>
        )
      )}
    </div>
  );
}

function Composer({ activePath, onAsk, account }) {
  const [content, setContent] = useState("");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [searchMode, setSearchMode] = useState("auto");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const textRef = useRef(null);

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
    textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 220)}px`;
  }, [content]);

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit(event) {
    event.preventDefault();
    if (sending || (!content.trim() && !file)) return;
    const form = new FormData();
    form.set("content", content);
    form.set("provider", provider);
    form.set("model", model);
    form.set("search_mode", searchMode);
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
    <form className="composer" data-api-action={`/api/ask/${activePath.projectPath}/${activePath.sessionSlug}`} encType="multipart/form-data" onSubmit={submit}>
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
          <small>{provider === "kimi" && file.type.startsWith("image/") ? "Sent as vision input" : file.type.startsWith("image/") ? "Attached to chat" : "Sent as text context"}</small>
          <button type="button" data-remove-attachment onClick={clearFile}>Remove</button>
        </div>
      )}
      <div className="composer-toolbar">
        <label className="attach-key" title="Attach file">
          Attach file
          <input
            ref={inputRef}
            data-attachment-input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            accept=".txt,.md,.pdf,.docx,image/png,image/jpeg,image/gif,image/webp"
          />
        </label>
        <select name="provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="ollama">ollama</option>
          <option value="kimi">kimi</option>
        </select>
        <select name="model" value={model} onChange={(event) => setModel(event.target.value)}>
          {MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select name="search_mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)}>
          {SEARCH_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="send-key" type="submit" disabled={sending}>{sending ? <span className="typing" /> : "Send"}</button>
      </div>
    </form>
  );
}

function modelLabel(model) {
  return MODEL_OPTIONS.find((item) => item.value === model)?.label || model;
}

function searchLabel(mode) {
  return SEARCH_OPTIONS.find((item) => item.value === mode)?.label || `Search ${mode}`;
}

function Workbench({ chat, activePath, runtime, onPreview, onChat }) {
  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <aside className="workbench">
        <h2>Workbench</h2>
        <RuntimePanel runtime={runtime} />
        <section>
          <h3>Context</h3>
          <p className="muted">Start or open a chat to inspect project context, files, goal, runtime, and dev commands.</p>
        </section>
      </aside>
    );
  }
  const attachments = chat?.attachments || [];
  return (
    <aside className="workbench">
      <h2>Workbench</h2>
      <section>
        <h3>Context</h3>
        <p><strong>{chat?.project?.hidden ? "General chat" : chat?.project?.title || activePath.projectPath}</strong></p>
        <p className="muted">{activePath.projectPath} / {activePath.sessionSlug}</p>
        <div className="skill-stack">
          {(chat?.skills || []).map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      </section>
      <section>
        <h3>Files</h3>
        {attachments.length === 0 ? <p className="muted">No files attached to this session yet.</p> : <AttachmentList attachments={attachments} onPreview={onPreview} />}
      </section>
      <section>
        <h3>Goal</h3>
        <GoalPanel chat={chat} activePath={activePath} onChat={onChat} />
      </section>
      <section>
        <h3>Prompt</h3>
        <a href={`/prompt/${activePath.projectPath}/${activePath.sessionSlug}`}>Open prompt context</a>
      </section>
      <section>
        <h3>Dev</h3>
        <RuntimePanel runtime={runtime} />
        <code>aiws prompt {activePath.projectPath} {activePath.sessionSlug} --root ~/.ai-workspace</code>
      </section>
    </aside>
  );
}

function GoalPanel({ chat, activePath, onChat }) {
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
        <button type="button" data-edit-goal onClick={() => setEditing(true)}>Edit Goal</button>
        <button type="button" data-copy-codex-prompt onClick={copyPrompt} disabled={!codexPrompt}>Copy Codex Prompt</button>
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
    <div className="modal-backdrop" onClick={onClose}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Settings</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <form onSubmit={submit}>
          <label>
            <span>프로필 사진</span>
            <input name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" />
          </label>
          <label>
            <span>이름</span>
            <input name="name" defaultValue={profile.name || account.display_name || ""} />
          </label>
          <label>
            <span>나이</span>
            <input name="age" defaultValue={profile.age || ""} />
          </label>
          <label>
            <span>직업</span>
            <input name="job" defaultValue={profile.job || ""} />
          </label>
          <label>
            <span>상황 / 대화 컨텍스트</span>
            <textarea name="situation" defaultValue={profile.situation || ""} />
          </label>
          <label>
            <span>언어</span>
            <select name="language" defaultValue={profile.language || "ko"}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
        </form>
        <button className="danger-button" type="button" onClick={logout}>Logout</button>
      </section>
    </div>
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
