import React, { useEffect, useState } from "react";
import { ContextPanel } from "../components/inspector/ContextPanel";
import { copyForLocale } from "../shared/copy/copy";
import { getCookie, setCookie } from "../lib/api";
import { WorkbenchShell } from "./shell/WorkbenchShell";
import type { CommandPaletteItem } from "./shell/AppCommandPalette";
import { TopBar } from "./layout/TopBar";
import { WorkspaceSidebar } from "./layout/WorkspaceSidebar";
import { parseRoute } from "./router/parseRoute";
import { WorkbenchRoutes } from "./routes/WorkbenchRoutes";
import { AppOverlays } from "./overlays/AppOverlays";
import { useWorkbenchData } from "./useWorkbenchData";
import "../styles.css";
import type { AccountSummary } from "../entities/workspace/types";

type LightboxItem = { filename: string; url: string; is_pdf?: boolean };

export function WorkbenchApp() {
  const [activePath, setActivePath] = useState(parseRoute());
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
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
  } = useWorkbenchData(activePath);

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

  function commandItems(): CommandPaletteItem[] {
    const items: CommandPaletteItem[] = [
      { id: "home", title: "Home", subtitle: "Open the workbench launcher", keywords: ["start", "launcher"], action: () => navigate("/") },
      { id: "new-chat", title: "New chat", subtitle: "Start a one-off AI conversation", keywords: ["chat"], action: () => navigate("/") },
      { id: "new-project", title: "New project", subtitle: "Create a local workspace", keywords: ["workspace"], action: () => window.dispatchEvent(new CustomEvent("aiws:new-project")) },
      { id: "apps-tools", title: "Workflow Apps", subtitle: "Browse chat tools and project apps", keywords: ["tools", "apps"], action: () => navigate("/apps-tools") },
      { id: "projects", title: "Projects", subtitle: "Browse local workbenches", keywords: ["workspace", "folder"], action: () => navigate("/projects") },
      { id: "runs", title: "Runs", subtitle: "Inspect traceable execution records", keywords: ["execution", "history", "logs"], action: () => navigate("/runs") },
      { id: "artifacts", title: "Artifacts", subtitle: "Browse durable outputs", keywords: ["outputs", "files", "reports"], action: () => navigate("/artifacts") },
      { id: "toggle-inspector", title: contextOpen ? "Hide inspector" : "Show inspector", subtitle: "Context, sources, runs, and outputs", keywords: ["context", "receipt"], action: toggleContext },
    ];
    for (const project of workspace?.projects || []) {
      items.push({
        id: `project:${project.path}`,
        title: project.title || project.path,
        subtitle: "Project",
        keywords: [project.path],
        action: () => navigate(`/project/${project.path}`),
      });
      for (const session of (project.sessions || []).slice(0, 4)) {
        items.push({
          id: `chat:${project.path}:${session.slug}`,
          title: session.title || session.slug,
          subtitle: `Chat · ${project.title || project.path}`,
          keywords: [project.path, session.slug],
          action: () => navigate(`/chat/${project.path}/${session.slug}`),
        });
      }
    }
    for (const chatProject of workspace?.chats || []) {
      for (const session of (chatProject.sessions || []).slice(0, 6)) {
        items.push({
          id: `general:${chatProject.path}:${session.slug}`,
          title: session.title || session.slug,
          subtitle: "Recent chat",
          keywords: [chatProject.path, session.slug],
          action: () => navigate(`/chat/${chatProject.path}/${session.slug}`),
        });
      }
    }
    return items;
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
    <WorkbenchShell
      sidebarOpen={sidebarOpen}
      inspectorOpen={contextOpen}
      commandOpen={commandOpen}
      onCommandOpenChange={setCommandOpen}
      commandItems={commandItems()}
      onCloseSidebar={closeSidebar}
      topbar={<TopBar
        runtime={runtime}
        account={workspace?.account}
        activePath={activePath}
        chat={chat}
        contextOpen={contextOpen}
        onToggleContext={toggleContext}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenCommand={() => setCommandOpen(true)}
      />}
      sidebar={<WorkspaceSidebar
          workspace={workspace}
          activePath={activePath}
          navigate={navigate}
          onRefresh={refreshWorkspace}
          automations={automations}
          onAutomations={setAutomations}
        />}
      main={<WorkbenchRoutes
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
        />}
      inspector={<ContextPanel
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
        />}
      overlays={<AppOverlays
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
      />}
    />
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

export default WorkbenchApp;
