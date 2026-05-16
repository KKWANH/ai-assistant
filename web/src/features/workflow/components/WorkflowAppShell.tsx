import React from "react";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";
import type { AccountLike, ModelMode } from "../../../components/chat/Composer";
import { AppLauncher } from "./AppLauncher";
import { ChatDock } from "./ChatDock";
import { ViewerPane } from "./ViewerPane";

type WorkflowArtifact = {
  path?: string;
  type?: string;
  kind?: string;
  viewer_id?: string;
  viewer_type?: string;
  content?: string;
  exists?: boolean;
};

export function WorkflowAppShell({
  app,
  running,
  onPreview,
  onRun,
  projectPath,
  account,
  power,
  models,
  artifacts = [],
  navigate,
  children,
}: {
  app: WorkflowAppDefinition;
  running?: boolean;
  onPreview?: () => void;
  onRun?: () => void;
  projectPath?: string;
  account?: AccountLike;
  power?: boolean;
  models?: ModelMode[];
  artifacts?: WorkflowArtifact[];
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
            <WorkflowSlotBody
              app={app}
              slotArtifact={slot.artifact}
              artifacts={artifacts}
              fallbackViewerId={slot.viewer_id}
            />
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

function WorkflowSlotBody({
  app,
  slotArtifact,
  artifacts,
  fallbackViewerId,
}: {
  app: WorkflowAppDefinition;
  slotArtifact?: string;
  artifacts: WorkflowArtifact[];
  fallbackViewerId: string;
}) {
  const spec = app.outputSchema.find((output) => output.path === slotArtifact)
    || app.outputSchema.find((output) => output.viewer_id === fallbackViewerId);
  const artifact = artifacts.find((item) => item.path === slotArtifact)
    || (spec ? artifacts.find((item) => item.path === spec.path) : undefined);
  if (!spec) {
    return <p className="muted">No output contract is mapped to this viewer slot yet.</p>;
  }
  if (!artifact) {
    return <p className="muted">Run this Workflow App to populate <code>{spec.path}</code>.</p>;
  }
  if (artifact.exists === false) {
    return <p className="error-text">Expected artifact was not written: {artifact.path}</p>;
  }
  return <ViewerPane artifact={{ ...artifact, viewer_id: artifact.viewer_id || artifact.viewer_type || spec.viewer_id, type: artifact.type || spec.type }} />;
}
