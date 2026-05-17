import React, { useEffect, useRef } from "react";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";
import type { AccountLike } from "../../../components/chat/Composer";
import type { ModelMode } from "../../../lib/modelModes";
import type { RunRecord } from "../../../shared/contracts/workbench";
import type { WorkflowRunInputValues } from "../../../shared/contracts/workflow";
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
  error,
  latestRun,
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
  error?: string;
  latestRun?: RunRecord | null;
  onPreview?: () => void;
  onRun?: (values: WorkflowRunInputValues) => void;
  projectPath?: string;
  account?: AccountLike;
  power?: boolean;
  models?: ModelMode[];
  artifacts?: WorkflowArtifact[];
  navigate?: (path: string) => void;
  children?: React.ReactNode;
}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const latestRunId = latestRun?.run_id;
  const latestArtifactCount = latestRun?.artifacts?.length || 0;
  const hasLatestRun = Boolean(latestRun);
  useEffect(() => {
    if (!hasLatestRun || running) return;
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hasLatestRun, latestRunId, latestArtifactCount, running]);

  return (
    <section className={`workflow-app-shell ${latestRun ? "has-run" : ""}`}>
      <AppLauncher app={app} running={running} error={error} onPreview={onPreview} onRun={onRun} />
      <RunReceipt run={latestRun} running={running} />
      <div className="workflow-viewer-focus" ref={viewerRef}>
        {latestRun && <div className="workflow-complete-banner">완료됨 · 산출물 {(latestRun.artifacts || []).length}개 · 아래 대시보드 갱신됨</div>}
      </div>
      <div className="workflow-viewer-layout" aria-live="polite">
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
        context={{
          kind: "workflow",
          label: app.title,
          runId: latestRun?.run_id,
          workflowAppId: app.id,
          viewerSlotId: app.defaultViewerLayout[0]?.id,
          resourceType: app.supportedResources[0] || app.id,
        }}
        account={account}
        power={power}
        models={models}
        navigate={navigate}
      />
      {children}
    </section>
  );
}

function RunReceipt({ run, running }: { run?: RunRecord | null; running?: boolean }) {
  if (running) {
    return <div className="workflow-run-receipt"><strong>Run Receipt</strong><span>실행 중. 입력 확인 → 실행 → 산출물 수집.</span></div>;
  }
  if (!run) {
    return <div className="workflow-run-receipt"><strong>Run Receipt</strong><span>아직 실행 없음.</span></div>;
  }
  return (
    <div className={`workflow-run-receipt ${run.status === "failed" ? "failed" : ""}`}>
      <strong>Run Receipt</strong>
      <span>{run.status} · {run.run_id}</span>
      <span>{(run.artifacts || []).length} artifacts</span>
      {run.error && <small className="error-text">{run.error}</small>}
    </div>
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
