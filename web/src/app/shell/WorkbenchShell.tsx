import { Activity, Cloud, FolderKanban, Play, RefreshCw, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import type { AdminAnalysis, AdminStatus, Message, Project, Session } from "../../domain/types";
import { Button } from "../../ui/primitives/Button";
import { AdminDashboard } from "../../features/admin/AdminDashboard";
import { ProjectOverview } from "../../features/projects/ProjectOverview";
import { SessionPanel } from "../../features/sessions/SessionPanel";
import styles from "./WorkbenchShell.module.css";

interface WorkbenchShellProps {
  projects: Project[];
  sessions: Session[];
  messages: Message[];
  selectedProject?: Project;
  selectedSession?: Session;
  adminStatus: AdminStatus | null;
  adminAnalysis: AdminAnalysis | null;
  logs: string[];
  error: string;
  onRefresh: () => void;
  onSelectProject: (path: string) => void;
  onSelectSession: (slug: string) => void;
  onCreateProject: () => void;
  onCreateSession: () => void;
  onAppendMessage: (content: string) => void;
}

export function WorkbenchShell(props: WorkbenchShellProps) {
  const [view, setView] = useState<"workbench" | "admin">("workbench");
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Terminal size={18} />
          <strong>AIWS</strong>
        </div>
        <div className={styles.navTitle}>Projects</div>
        <button className={styles.navItem} onClick={props.onCreateProject}>
          <FolderKanban size={16} />
          New project
        </button>
        {props.projects.map((project) => (
          <button
            className={`${styles.navItem} ${
              props.selectedProject?.path === project.path ? styles.active : ""
            }`}
            key={project.id}
            onClick={() => props.onSelectProject(project.path)}
          >
            <span>{project.title}</span>
            <small>{project.path}</small>
          </button>
        ))}
      </aside>

      <header className={styles.topbar}>
        <div className={styles.scope}>
          <span>{props.selectedProject?.title ?? "No Project"}</span>
          <small>{props.adminStatus?.workspace_root ?? "Workspace not initialized"}</small>
        </div>
        <div className={styles.statusChips}>
          <span className={styles.chip}>
            <ShieldCheck size={14} /> local-first
          </span>
          <span className={styles.chip}>
            <Cloud size={14} /> Cloudflare ready
          </span>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={props.onRefresh}>
          Refresh
        </Button>
        <Button
          icon={view === "workbench" ? <Activity size={15} /> : <Play size={15} />}
          onClick={() => setView(view === "workbench" ? "admin" : "workbench")}
          variant="primary"
        >
          {view === "workbench" ? "Admin" : "Workbench"}
        </Button>
      </header>

      <main className={styles.main}>
        {props.error ? <div className={styles.error}>{props.error}</div> : null}
        {view === "admin" ? (
          <AdminDashboard
            status={props.adminStatus}
            analysis={props.adminAnalysis}
            logs={props.logs}
          />
        ) : (
          <ProjectOverview
            project={props.selectedProject}
            sessions={props.sessions}
            selectedSession={props.selectedSession}
            messages={props.messages}
            onCreateSession={props.onCreateSession}
            onSelectSession={props.onSelectSession}
            onAppendMessage={props.onAppendMessage}
          />
        )}
      </main>

      <aside className={styles.inspector}>
        <div className={styles.panelTitle}>Traceability</div>
        <dl>
          <dt>Project</dt>
          <dd>{props.selectedProject?.path ?? "none"}</dd>
          <dt>Session</dt>
          <dd>{props.selectedSession?.slug ?? "none"}</dd>
          <dt>Context Receipt</dt>
          <dd>pending Phase 7</dd>
          <dt>Run</dt>
          <dd>pending Phase 5</dd>
          <dt>Artifact</dt>
          <dd>pending Phase 9</dd>
        </dl>
      </aside>
    </div>
  );
}
