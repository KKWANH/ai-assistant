import React, { useEffect, useState } from "react";
import { ContextPanel } from "../../components/inspector/ContextPanel";
import { copyForLocale } from "../../shared/copy/copy";
import { getCookie, setCookie } from "../../lib/api";
import { TopBar } from "../layout/TopBar";
import { WorkspaceSidebar } from "../layout/WorkspaceSidebar";
import { parseRoute } from "../router/parseRoute";
import { CenterPane } from "./CenterPane";
import { AppOverlays } from "./Overlays";
import { useLegacyWorkbenchData } from "./useLegacyWorkbenchData";
import "../../styles.css";
import type { AccountSummary } from "../../entities/workspace/types";

type LightboxItem = { filename: string; url: string; is_pdf?: boolean };

export function LegacyApp() {
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => getCookie("aiws_sidebar_open") !== "0");
  const {
    automations,
    chat,
    error,
    home,
    isLogin,
    openclaw,
    projectArtifact,
    projectConfig,
    projectRunDetail,
    runtime,
    workspace,
    afterAsk,
    openProjectArtifact,
    openProjectRun,
    refreshHome,
    refreshWorkspace,
    setAutomations,
    setChat,
    setHome,
    setProjectArtifact,
    setProjectConfig,
    setProjectRunDetail,
  } = useLegacyWorkbenchData(activePath);

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
          onPreview={(item) => setLightbox(item as LightboxItem)}
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
          onPreview={(item) => setLightbox(item as LightboxItem)}
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

function isPowerMode(account?: AccountSummary) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

export default LegacyApp;
