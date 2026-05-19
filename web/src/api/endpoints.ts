import { apiGet, apiPost } from "./client";
import type { AdminAnalysis, AdminStatus, Message, Project, Session, Workspace } from "../domain/types";

export const endpoints = {
  health: () => apiGet<{ ok: boolean; workspace_root: string }>("/api/health"),
  workspace: () =>
    apiGet<{ workspace: Workspace | null; initialized: boolean; workspace_root: string }>(
      "/api/workspace"
    ),
  initWorkspace: () => apiPost<{ workspace: Workspace; initialized: boolean }>("/api/workspace/init", {}),
  projects: () => apiGet<{ projects: Project[] }>("/api/projects"),
  createProject: (payload: { path: string; title: string; description?: string }) =>
    apiPost<{ project: Project }>("/api/projects", payload),
  sessions: (projectPath: string) =>
    apiGet<{ sessions: Session[] }>(`/api/projects/${encodeURIComponent(projectPath)}/sessions`),
  createSession: (projectPath: string, payload: { slug: string; title: string }) =>
    apiPost<{ session: Session }>(`/api/projects/${encodeURIComponent(projectPath)}/sessions`, payload),
  messages: (projectPath: string, sessionSlug: string) =>
    apiGet<{ messages: Message[] }>(
      `/api/projects/${encodeURIComponent(projectPath)}/sessions/${encodeURIComponent(sessionSlug)}/messages`
    ),
  appendMessage: (
    projectPath: string,
    sessionSlug: string,
    payload: { session_id: string; content: string; role: "user" }
  ) =>
    apiPost<{ message: Message }>(
      `/api/projects/${encodeURIComponent(projectPath)}/sessions/${encodeURIComponent(sessionSlug)}/messages`,
      payload
    ),
  adminStatus: () => apiGet<AdminStatus>("/api/admin/status"),
  adminLogs: () => apiGet<{ path: string; lines: string[] }>("/api/admin/logs"),
  adminAnalysis: () => apiGet<AdminAnalysis>("/api/admin/analysis")
};
