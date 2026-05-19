import React from "react";
import { AppsToolsCatalogPage } from "../../pages/AppsToolsCatalogPage";
import { WorkObjectPages } from "../../pages/WorkObjectPages";
import { SettingsRoute } from "../../pages/SettingsRoute";
import { copyForAccount } from "../../shared/copy/copy";
import { normalizeModelCatalog } from "../../lib/modelModes";
import { ChatSurface } from "../surfaces/ChatSurface";
import { HomeSurface } from "../surfaces/HomeSurface";
import { ProjectSurface } from "../surfaces/ProjectSurface";
import type { AccountSummary, WorkspaceSummary } from "../../entities/workspace/types";
import type { ProjectSummary } from "../../entities/project/types";
import type {
  ActivePath,
  ChatState,
  HomePayload,
  NavigateFn,
  ProjectConfigState,
  RefreshFn,
  SetChatFn,
} from "../../shared/contracts/runtime";

type WorkbenchRoutesProps = {
  chat: ChatState | null;
  activePath: ActivePath;
  account?: AccountSummary;
  projects: ProjectSummary[];
  onAsk: SetChatFn;
  onPreview?: (attachment: unknown) => void;
  error?: string;
  navigate: NavigateFn;
  refreshWorkspace?: RefreshFn;
  contextOpen: boolean;
  onToggleContext: () => void;
  projectConfig: ProjectConfigState;
  onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigState>>;
  workspace?: WorkspaceSummary | null;
  home?: HomePayload | null;
  onHome?: (home: HomePayload) => void;
  refreshHome?: RefreshFn;
};

export function WorkbenchRoutes({
  chat,
  activePath,
  account,
  projects,
  onAsk,
  onPreview,
  error,
  navigate,
  refreshWorkspace,
  contextOpen,
  onToggleContext,
  projectConfig,
  onProjectConfig,
  workspace,
  home,
  onHome,
  refreshHome,
}: WorkbenchRoutesProps) {
  const power = isPowerMode(account);
  const copy = copyForAccount(account);
  const models = normalizeModelCatalog(account?.model_catalog);

  if (activePath.view === "apps-tools" || activePath.view === "actions") {
    return <AppsToolsCatalogPage navigate={navigate} copy={copy} home={home} onHome={onHome} />;
  }

  if (activePath.view === "projects" || activePath.view === "runs" || activePath.view === "artifacts") {
    return <WorkObjectPages view={activePath.view} workspace={workspace || null} home={home} navigate={navigate} />;
  }

  if (activePath.view === "settings" && account) {
    return <SettingsRoute account={account} onSaved={refreshWorkspace} />;
  }

  if (activePath.projectPath && !activePath.sessionSlug) {
    const project = projects.find((item) => item.path === activePath.projectPath);
    return (
      <ProjectSurface
        activePath={activePath}
        projectConfig={projectConfig}
        project={project}
        power={power}
        copy={copy}
        activeAppId={activePath.view === "workflow-app" ? activePath.appId : undefined}
        onProjectConfig={onProjectConfig}
        navigate={navigate}
        error={error}
        refreshWorkspace={refreshWorkspace}
        onAsk={onAsk}
        account={account}
        models={models}
      />
    );
  }

  if (!activePath.projectPath || !activePath.sessionSlug) {
    return (
      <HomeSurface
        error={error}
        navigate={navigate}
        refreshWorkspace={refreshWorkspace}
        onAsk={onAsk}
        account={account}
        models={models}
        workspace={workspace}
        home={home}
        onHome={onHome}
        refreshHome={refreshHome}
      />
    );
  }

  return (
    <ChatSurface
      chat={chat}
      activePath={activePath}
      account={account}
      models={models}
      power={power}
      onAsk={onAsk}
      onPreview={onPreview}
      refreshWorkspace={refreshWorkspace}
      contextOpen={contextOpen}
      onToggleContext={onToggleContext}
      onProjectConfig={onProjectConfig}
    />
  );
}

function isPowerMode(account?: AccountSummary) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}
