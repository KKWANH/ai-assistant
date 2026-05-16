import React from "react";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";
import { AppLauncher } from "./AppLauncher";
import { ChatDock } from "./ChatDock";

export function WorkflowAppShell({
  app,
  running,
  onPreview,
  onRun,
  projectPath,
  account,
  power,
  models,
  navigate,
  children,
}: {
  app: WorkflowAppDefinition;
  running?: boolean;
  onPreview?: () => void;
  onRun?: () => void;
  projectPath?: string;
  account?: unknown;
  power?: boolean;
  models?: unknown[];
  navigate?: (path: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="workflow-app-shell">
      <AppLauncher app={app} running={running} onPreview={onPreview} onRun={onRun} />
      <div className="workflow-viewer-layout">
        {app.defaultViewerLayout.map((slot) => (
          <div className={`workflow-viewer-slot ${slot.position}`} key={slot.id}>
            <div className="section-row"><strong>{slot.title}</strong><span className="soft-pill">{slot.viewer_id}</span></div>
          </div>
        ))}
      </div>
      <ChatDock
        projectPath={projectPath}
        context={{ kind: "workflow", label: app.title, resourceType: app.supportedResources[0] || app.id }}
        account={account}
        power={power}
        models={models}
        navigate={navigate}
      />
      {children}
    </section>
  );
}
