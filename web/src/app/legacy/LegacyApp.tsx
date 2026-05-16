/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { ContextPanel } from "../../components/inspector/ContextPanel";
import { copyForAccount, copyForLocale } from "../../shared/copy/copy";
import { fetchJson, getCookie, setCookie } from "../../lib/api";
import {
  useAutomationsQuery,
  useHomeQuery,
  useOpenClawQuery,
  useRuntimeQuery,
  useWorkspaceQuery,
} from "../../shared/api/client";
import { TopBar } from "../layout/TopBar";
import { WorkspaceSidebar } from "../layout/WorkspaceSidebar";
import { parseRoute } from "../router/parseRoute";
import { CenterPane } from "./CenterPane";
import { AppOverlays } from "./Overlays";
import "../../styles.css";


export function LegacyApp() {
  const [workspace, setWorkspace] = useState<any>(null);
  const [chat, setChat] = useState<any>(null);
  const [runtime, setRuntime] = useState<any>(null);
  const [home, setHome] = useState<any>(null);
  const [openclaw, setOpenclaw] = useState<any>(null);
  const [automations, setAutomations] = useState<any[]>([]);
  const [projectConfig, setProjectConfig] = useState<any>(null);
  const [projectRunDetail, setProjectRunDetail] = useState<any>(null);
  const [projectArtifact, setProjectArtifact] = useState<any>(null);
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState<any>(null);
  const [error, setError] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => getCookie("aiws_sidebar_open") !== "0");
  const isLogin = activePath.view === "login";
  const workspaceQuery = useWorkspaceQuery(!isLogin);
  const homeQuery = useHomeQuery(!isLogin);
  const runtimeQuery = useRuntimeQuery(!isLogin);
  const openclawQuery = useOpenClawQuery(!isLogin);
  const automationsQuery = useAutomationsQuery(!isLogin);

  async function refreshWorkspace() {
    const payload = await workspaceQuery.refetch();
    if (payload.data) setWorkspace(payload.data);
  }

  async function refreshHome() {
    const payload = await homeQuery.refetch();
    if (payload.data) setHome(payload.data.home);
  }

  async function refreshChat(target: any = activePath) {
    if (!target.projectPath || !target.sessionSlug) {
      setChat(null);
      return;
    }
    const payload = await fetchJson<any>(`/api/chat/${target.projectPath}/${target.sessionSlug}`);
    setChat((current) => {
      const sameThread = current?.project?.path === target.projectPath && current?.session?.slug === target.sessionSlug;
      const hasPending = (current?.messages || []).some((message) => message.pending);
      if (sameThread && hasPending && (payload.messages || []).length === 0) {
        return current;
      }
      return payload;
    });
  }

  async function refreshProjectConfig(target: any = activePath) {
    if (!target.projectPath) {
      setProjectConfig(null);
      return;
    }
    const payload = await fetchJson<any>(`/api/project-config/${target.projectPath}`);
    setProjectConfig(payload);
  }

  async function openProjectRun(run: any) {
    if (!activePath.projectPath || !run?.run_id) return;
    const payload = await fetchJson<any>(`/api/project-run?project=${encodeURIComponent(activePath.projectPath)}&run_id=${encodeURIComponent(run.run_id)}`);
    setProjectRunDetail(payload);
  }

  async function openProjectArtifact(artifact: any) {
    if (!activePath.projectPath || !artifact?.path) return;
    const payload = await fetchJson<{ artifact: any }>(`/api/project-artifact?project=${encodeURIComponent(activePath.projectPath)}&path=${encodeURIComponent(artifact.path)}`);
    setProjectArtifact(payload.artifact);
  }

  useEffect(() => {
    if (isLogin) return;
    if (workspaceQuery.data) setWorkspace(workspaceQuery.data);
    if (homeQuery.data) setHome(homeQuery.data.home);
    if (runtimeQuery.data) setRuntime(runtimeQuery.data.runtime);
    if (openclawQuery.data) setOpenclaw(openclawQuery.data.openclaw);
    if (automationsQuery.data) setAutomations((automationsQuery.data.projects || []) as any[]);
    if (workspaceQuery.error) setError(workspaceQuery.error.message);
  }, [
    isLogin,
    workspaceQuery.data,
    homeQuery.data,
    runtimeQuery.data,
    openclawQuery.data,
    automationsQuery.data,
    workspaceQuery.error,
  ]);

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

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setActivePath(parseRoute(path));
  }

  async function afterAsk(payload: any) {
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

  function closeSidebar() {
    setSidebarOpen(false);
    setCookie("aiws_sidebar_open", "0");
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
        {sidebarOpen && <button type="button" className="mobile-sidebar-scrim" aria-label="Close sidebar" onClick={closeSidebar} />}
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

function isPowerMode(account: any) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

export default LegacyApp;
