import type {
  ArtifactsResponse,
  ChatPayload,
  HomePayload,
  ProjectConfigPayload,
  RunsResponse,
  WorkspaceSummary,
} from "./types";

export function getCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

export function csrfHeader(): Record<string, string> {
  const token = getCookie("aiws_csrf");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...csrfHeader(), ...(init.headers || {}) },
    ...init,
  });
  const text = await response.text();
  const payload = text.trim() ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export async function postForm<T>(path: string, body: URLSearchParams | FormData): Promise<T> {
  return apiJson<T>(path, { method: "POST", body });
}

export const api = {
  workspace: () => apiJson<WorkspaceSummary>("/api/workspace"),
  home: async () => {
    const payload = await apiJson<{ home?: HomePayload } & HomePayload>("/api/home");
    return payload.home || payload;
  },
  projectConfig: (projectPath: string) => apiJson<ProjectConfigPayload>(`/api/project-config/${projectPath}`),
  chat: (projectPath: string, sessionSlug: string) => apiJson<ChatPayload>(`/api/chat/${projectPath}/${sessionSlug}`),
  runs: (query = "") => apiJson<RunsResponse>(`/api/runs${query}`),
  artifacts: (query = "") => apiJson<ArtifactsResponse>(`/api/artifacts${query}`),
  createChat: (title = "") => postForm<{ project_path: string; session: { slug: string; title?: string } }>("/api/chats", new URLSearchParams({ title })),
  ask: (projectPath: string, sessionSlug: string, form: FormData) => postForm<ChatPayload>(`/api/ask/${projectPath}/${sessionSlug}`, form),
};
