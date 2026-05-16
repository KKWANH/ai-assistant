import { useQuery } from "@tanstack/react-query";
import type { ArtifactRecord, ModelCatalogItem, ProjectConnectionsPayload, RunRecord } from "../contracts/workbench";
import type { WorkspaceSummary } from "../../entities/workspace/types";
import type { ChatSessionPayload } from "../../entities/session/types";
import type { WorkflowAppDefinition } from "../contracts/workflow-app";
import { parseProjectConnections, parseWorkflowApps } from "../contracts/guards";

export type ProjectConfigPayload = {
  project?: Record<string, unknown>;
  config: {
    name?: string;
    description?: string;
    commands?: Record<string, unknown>;
    workflow_apps?: WorkflowAppDefinition[];
    panels?: unknown[];
    views?: unknown[];
    context?: Record<string, unknown>;
  };
  runs: RunRecord[];
  connections?: ProjectConnectionsPayload;
};

export const queryKeys = {
  workspace: ["workspace"] as const,
  models: ["models"] as const,
  session: (projectPath: string, sessionSlug: string) => ["session", projectPath, sessionSlug] as const,
  projectConfig: (projectPath: string) => ["project-config", projectPath] as const,
  projectRun: (projectPath: string, runId: string) => ["project-run", projectPath, runId] as const,
  projectArtifact: (projectPath: string, artifactPath: string) => ["project-artifact", projectPath, artifactPath] as const,
  projectConnections: (projectPath: string) => ["project-connections", projectPath] as const,
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json", ...(init.headers || {}) },
    ...init,
  });
  const text = await response.text();
  const payload = text.trim() ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String((payload as { error: unknown }).error) : "Request failed.";
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function parseProjectConfigPayload(value: unknown): ProjectConfigPayload {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const config = source.config && typeof source.config === "object" ? source.config as Record<string, unknown> : {};
  return {
    project: source.project && typeof source.project === "object" ? source.project as Record<string, unknown> : undefined,
    config: {
      ...config,
      workflow_apps: parseWorkflowApps(config.workflow_apps),
    },
    runs: Array.isArray(source.runs) ? source.runs as RunRecord[] : [],
    connections: parseProjectConnections(source.connections),
  };
}

export function useWorkspaceQuery() {
  return useQuery({ queryKey: queryKeys.workspace, queryFn: () => apiJson<WorkspaceSummary>("/api/workspace") });
}

export function useModelCatalogQuery() {
  return useQuery({ queryKey: queryKeys.models, queryFn: () => apiJson<{ models: ModelCatalogItem[] }>("/api/models") });
}

export function useSessionQuery(projectPath: string, sessionSlug: string) {
  return useQuery({
    queryKey: queryKeys.session(projectPath, sessionSlug),
    queryFn: () => apiJson<ChatSessionPayload>(`/api/chat/${projectPath}/${sessionSlug}`),
    enabled: Boolean(projectPath && sessionSlug),
  });
}

export function useProjectConfigQuery(projectPath: string) {
  return useQuery({
    queryKey: queryKeys.projectConfig(projectPath),
    queryFn: async () => parseProjectConfigPayload(await apiJson<unknown>(`/api/project-config/${projectPath}`)),
    enabled: Boolean(projectPath),
  });
}

export function useProjectRunQuery(projectPath: string, runId: string) {
  return useQuery({
    queryKey: queryKeys.projectRun(projectPath, runId),
    queryFn: () => apiJson<{ run: RunRecord }>(`/api/project-run?project=${encodeURIComponent(projectPath)}&run_id=${encodeURIComponent(runId)}`),
    enabled: Boolean(projectPath && runId),
  });
}

export function useProjectArtifactQuery(projectPath: string, artifactPath: string) {
  return useQuery({
    queryKey: queryKeys.projectArtifact(projectPath, artifactPath),
    queryFn: () => apiJson<{ artifact: ArtifactRecord }>(`/api/project-artifact?project=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(artifactPath)}`),
    enabled: Boolean(projectPath && artifactPath),
  });
}

export function useProjectConnectionsQuery(projectPath: string) {
  return useQuery({
    queryKey: queryKeys.projectConnections(projectPath),
    queryFn: async () => {
      const payload = await apiJson<unknown>(`/api/project-connections/${projectPath}`);
      const source = payload && typeof payload === "object" ? payload as { connections?: unknown } : {};
      return { connections: parseProjectConnections(source.connections) };
    },
    enabled: Boolean(projectPath),
  });
}
