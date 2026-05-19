import { useEffect, useState } from "react";
import { copyForAccount } from "../shared/copy/copy";
import { fetchJson } from "../lib/api";
import {
  useAutomationsQuery,
  useHomeQuery,
  useOpenClawQuery,
  useProjectConfigQuery,
  useRuntimeQuery,
  useSessionQuery,
  useWorkspaceQuery,
} from "../shared/api/client";
import type { ActivePath } from "./router/parseRoute";
import type { WorkspaceSummary } from "../entities/workspace/types";
import type {
  AutomationProject,
  ArtifactPayload,
  ChatState,
  HomePayload,
  OpenClawPayload,
  ProjectConfigState,
  RunDetail,
  RuntimePayload,
} from "../shared/contracts/runtime";
import type { ArtifactRecord, RunRecord } from "../shared/contracts/workbench";

export function useWorkbenchData(activePath: ActivePath) {
  const isLogin = activePath.view === "login";
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [home, setHome] = useState<HomePayload | null>(null);
  const [openclaw, setOpenclaw] = useState<OpenClawPayload | null>(null);
  const [automations, setAutomations] = useState<AutomationProject[]>([]);
  const [projectConfig, setProjectConfig] = useState<ProjectConfigState>(null);
  const [projectRunDetail, setProjectRunDetail] = useState<RunDetail | null>(null);
  const [projectArtifact, setProjectArtifact] = useState<ArtifactPayload | null>(null);
  const [error, setError] = useState("");

  const workspaceQuery = useWorkspaceQuery(!isLogin);
  const homeQuery = useHomeQuery(!isLogin);
  const runtimeQuery = useRuntimeQuery(!isLogin);
  const openclawQuery = useOpenClawQuery(!isLogin);
  const automationsQuery = useAutomationsQuery(!isLogin);
  const sessionQuery = useSessionQuery(activePath.projectPath || "", activePath.sessionSlug || "", !isLogin);
  const projectConfigQuery = useProjectConfigQuery(activePath.projectPath || "", !isLogin);

  async function refreshWorkspace() {
    const payload = await workspaceQuery.refetch();
    if (payload.data) setWorkspace(payload.data);
  }

  async function refreshHome() {
    const payload = await homeQuery.refetch();
    if (payload.data) setHome(payload.data.home);
  }

  async function openProjectRun(run: RunRecord) {
    if (!activePath.projectPath || !run?.run_id) return;
    const payload = await fetchJson<RunDetail>(`/api/project-run?project=${encodeURIComponent(activePath.projectPath)}&run_id=${encodeURIComponent(run.run_id)}`);
    setProjectRunDetail(payload);
  }

  async function openProjectArtifact(artifact: ArtifactRecord) {
    if (!activePath.projectPath || !artifact?.path) return;
    const payload = await fetchJson<{ artifact: ArtifactPayload }>(`/api/project-artifact?project=${encodeURIComponent(activePath.projectPath)}&path=${encodeURIComponent(artifact.path)}`);
    setProjectArtifact(payload.artifact);
  }

  async function afterAsk(payload: ChatState | ((current: ChatState | null) => ChatState | null)) {
    setChat((current: ChatState | null) => (typeof payload === "function" ? payload(current) : payload));
    refreshWorkspace().catch(() => {});
    refreshHome().catch(() => {});
  }

  useEffect(() => {
    if (isLogin) return;
    if (workspaceQuery.data) setWorkspace(workspaceQuery.data);
    if (homeQuery.data) setHome(homeQuery.data.home);
    if (runtimeQuery.data) setRuntime(runtimeQuery.data.runtime);
    if (openclawQuery.data) setOpenclaw(openclawQuery.data.openclaw);
    if (automationsQuery.data) setAutomations((automationsQuery.data.projects || []) as AutomationProject[]);
    if (sessionQuery.data) {
      setChat((current: ChatState | null) => {
        const sameThread = current?.project?.path === activePath.projectPath && current?.session?.slug === activePath.sessionSlug;
        const hasPending = (current?.messages || []).some((message) => message.pending);
        if (sameThread && hasPending && (sessionQuery.data?.messages || []).length === 0) return current;
        return sessionQuery.data || current;
      });
    } else if (!activePath.sessionSlug) {
      setChat(null);
    }
    if (projectConfigQuery.data) setProjectConfig(projectConfigQuery.data);
    if (!activePath.projectPath) setProjectConfig(null);
    if (workspaceQuery.error) setError(workspaceQuery.error.message);
  }, [
    isLogin,
    workspaceQuery.data,
    homeQuery.data,
    runtimeQuery.data,
    openclawQuery.data,
    automationsQuery.data,
    sessionQuery.data,
    projectConfigQuery.data,
    activePath.projectPath,
    activePath.sessionSlug,
    workspaceQuery.error,
  ]);

  useEffect(() => {
    if (isLogin) return;
    if (sessionQuery.error) setError(sessionQuery.error instanceof Error ? sessionQuery.error.message : String(sessionQuery.error));
    if (projectConfigQuery.error) setProjectConfig(null);
  }, [isLogin, sessionQuery.error, projectConfigQuery.error]);

  useEffect(() => {
    document.documentElement.lang = copyForAccount(workspace?.account).locale;
  }, [workspace?.account]);

  return {
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
  };
}
