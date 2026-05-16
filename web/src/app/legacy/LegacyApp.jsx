import React, { useEffect, useState } from "react";
import { ContextPanel } from "../../components/inspector/ContextPanel.jsx";
import { copyForAccount, copyForLocale } from "../../shared/copy/copy";
import { fetchJson, getCookie, setCookie } from "../../lib/api.js";
import { TopBar } from "../layout/TopBar";
import { WorkspaceSidebar } from "../layout/WorkspaceSidebar.jsx";
import { parseRoute } from "../router/parseRoute";
import { CenterPane } from "./CenterPane.jsx";
import { AppOverlays } from "./Overlays.jsx";
import "../../styles.css";


export function LegacyApp() {
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
  // Legacy shell fetch orchestration is being moved to TanStack Query; keep route-keyed refresh stable for now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogin, activePath.projectPath, activePath.sessionSlug]);

  useEffect(() => {
    document.documentElement.lang = copyForAccount(workspace?.account).locale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <WorkspaceSidebar
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
      <AppOverlays
        runDetail={projectRunDetail}
        artifact={projectArtifact}
        lightbox={lightbox}
        activePath={activePath}
        account={workspace?.account}
        power={isPowerMode(workspace?.account)}
        onCloseRun={() => setProjectRunDetail(null)}
        onCloseArtifact={() => setProjectArtifact(null)}
        onCloseLightbox={() => setLightbox(null)}
        onOpenArtifact={openProjectArtifact}
      />
    </div>
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
          <p>Projects can expose Workflow Apps, panels, context, and artifacts through aiws.yaml.</p>
        </div>
      </aside>
    </main>
  );
}

function isPowerMode(account) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

export default LegacyApp;
