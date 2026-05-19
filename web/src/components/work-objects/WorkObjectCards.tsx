import type { ProjectSummary } from "../../entities/project/types";
import type { SessionSummary } from "../../entities/session/types";
import type { ArtifactRecord, RunRecord } from "../../shared/contracts/workbench";
import styles from "./WorkObjectCards.module.css";

export type NavigateTo = (path: string) => void;

export type ProjectCardProps = {
  project: ProjectSummary;
  onOpen?: NavigateTo;
};

export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  return (
    <button type="button" className={styles.card} onClick={() => onOpen?.(`/project/${project.path}`)}>
      <span className={styles.kind}>Project</span>
      <strong>{project.title || project.path}</strong>
      <small>{project.sessions?.length || 0} chats · {project.visibility || "private"}</small>
    </button>
  );
}

export type SessionCardProps = {
  session: SessionSummary & { projectPath?: string; projectTitle?: string };
  onOpen?: NavigateTo;
};

export function SessionCard({ session, onOpen }: SessionCardProps) {
  const projectPath = session.projectPath || "";
  return (
    <button type="button" className={styles.card} onClick={() => projectPath && onOpen?.(`/chat/${projectPath}/${session.slug}`)}>
      <span className={styles.kind}>Session</span>
      <strong>{session.title || session.slug}</strong>
      <small>{session.projectTitle || projectPath || "General"} · {session.created_at?.slice(0, 10) || "no date"}</small>
    </button>
  );
}

export type RunCardProps = {
  run: RunRecord & { projectTitle?: string };
  onOpen?: (run: RunRecord) => void;
};

export function RunCard({ run, onOpen }: RunCardProps) {
  const mode = run.model?.local === false ? "cloud" : "local";
  const statusClass = statusClassName(run.status);
  return (
    <button type="button" className={styles.card} onClick={() => onOpen?.(run)}>
      <span className={`${styles.kind} ${statusClass}`}>Run · {run.status}</span>
      <strong>{run.label || run.action_label || run.command || run.action_id || "Execution"}</strong>
      <small>{mode} · {run.artifacts?.length || 0} artifacts · {run.created_at?.slice(0, 16) || "no date"}</small>
    </button>
  );
}

export type ArtifactCardProps = {
  artifact: ArtifactRecord & { projectPath?: string; projectTitle?: string; run?: Pick<RunRecord, "run_id" | "label" | "command" | "status"> };
  onOpen?: (artifact: ArtifactRecord) => void;
};

export function ArtifactCard({ artifact, onOpen }: ArtifactCardProps) {
  const filename = artifact.path?.split("/").pop() || artifact.path || "artifact";
  return (
    <button type="button" className={styles.card} onClick={() => onOpen?.(artifact)}>
      <span className={styles.kind}>Artifact</span>
      <strong>{filename}</strong>
      <small>{artifact.viewer_type || artifact.type || "output"} · {artifact.projectTitle || artifact.projectPath || "workspace"}</small>
    </button>
  );
}

export type StatPillProps = {
  label: string;
  value: string | number;
};

export function StatPill({ label, value }: StatPillProps) {
  return (
    <span className={styles.statPill}>
      <b>{value}</b>
      <small>{label}</small>
    </span>
  );
}

function statusClassName(status: unknown): string {
  const normalized = String(status || "unknown").toLowerCase();
  if (normalized === "completed") return styles.completed;
  if (normalized === "failed" || normalized === "cancelled") return styles.failed;
  if (normalized === "running" || normalized === "queued") return styles.running;
  return "";
}
