export type WorkspaceMode = "local" | "server" | "public_demo";
export type ProjectKind = "general" | "structured" | "workflow_app";
export type SessionKind = "chat" | "project_chat" | "action_thread";
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Workspace {
  id: string;
  root_path: string;
  mode: WorkspaceMode;
  created_at: string;
  users_enabled: boolean;
  public_demo: boolean;
}

export interface Project {
  id: string;
  path: string;
  slug: string;
  title: string;
  description: string;
  visibility: "private" | "public";
  kind: ProjectKind;
  created_at: string;
  updated_at: string;
  manifest_status: string;
}

export interface Session {
  id: string;
  slug: string;
  project_path: string;
  title: string;
  kind: SessionKind;
  created_at: string;
  updated_at: string;
  summary: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface AdminStatus {
  pid: number;
  workspace_root: string;
  project_count: number;
  session_count: number;
  log_files: string[];
  generated_at: string;
}

export interface AdminAnalysis {
  generated_at: string;
  error_count: number;
  warning_count: number;
  findings: string[];
  metadata: Record<string, unknown>;
}
