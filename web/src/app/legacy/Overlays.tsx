import React, { useEffect } from "react";
import { ViewerPane } from "../../features/workflow/components/ViewerPane";
import { ChatDock } from "../../features/workflow/components/ChatDock";
import type { ActivePath } from "../router/parseRoute";
import type { ArtifactRecord, RunRecord } from "../../shared/contracts/workbench";
import type { ModelMode } from "../../components/chat/Composer";

type AccountLike = Record<string, unknown> | null | undefined;
type OverlayArtifact = ArtifactRecord & { kind?: string; content?: string; viewer_type?: string };
type RunStep = { id?: string; type?: string; output?: string; status?: string };
type RunLog = { kind?: string; type?: string; content?: string; message?: string };
type OverlayRun = RunRecord & { execution_plan?: { steps?: RunStep[] }; logs?: RunLog[]; stdout?: string; stderr?: string; run_id?: string; action_id?: string; command?: string };
type RunDetail = {
  run?: OverlayRun;
  logs?: RunLog[];
  stdout?: string;
  stderr?: string;
};
type LightboxItem = { filename: string; url: string; is_pdf?: boolean };

type AppOverlaysProps = {
  runDetail?: RunDetail | null;
  artifact?: OverlayArtifact | null;
  lightbox?: LightboxItem | null;
  activePath: ActivePath;
  account?: AccountLike;
  models?: ModelMode[];
  power?: boolean;
  onCloseRun: () => void;
  onCloseArtifact: () => void;
  onCloseLightbox: () => void;
  onOpenArtifact?: (artifact: ArtifactRecord) => void;
};

export function AppOverlays({ runDetail, artifact, lightbox, activePath, account, models, power, onCloseRun, onCloseArtifact, onCloseLightbox, onOpenArtifact }: AppOverlaysProps) {
  return (
    <>
      {runDetail && (
        <RunDetailOverlay
          detail={runDetail}
          power={power}
          activePath={activePath}
          account={account}
          models={models}
          onClose={onCloseRun}
          onOpenArtifact={onOpenArtifact}
        />
      )}
      {artifact && <ArtifactOverlay artifact={artifact} activePath={activePath} account={account} models={models} onClose={onCloseArtifact} />}
      {lightbox && <Lightbox item={lightbox} onClose={onCloseLightbox} />}
    </>
  );
}

type RunDetailOverlayProps = {
  detail: RunDetail;
  power?: boolean;
  activePath: ActivePath;
  account?: AccountLike;
  models?: ModelMode[];
  onClose: () => void;
  onOpenArtifact?: (artifact: ArtifactRecord) => void;
};

function RunDetailOverlay({ detail, power, activePath, account, models, onClose, onOpenArtifact }: RunDetailOverlayProps) {
  const run: OverlayRun = detail.run || ({ status: "", run_id: "" } as OverlayRun);
  const plan = run.execution_plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Run Detail</p>
        <h2>{run.label || run.action_id || run.command || "Workbench output"}</h2>
        <div className="run-meta-grid"><span>Status: {run.status}</span><span>Tool/App: {run.action_id || run.command}</span><span>{run.created_at}</span></div>
        {run.artifacts && run.artifacts.length > 0 && <div className="artifact-list"><strong>Artifacts</strong>{run.artifacts.map((item: ArtifactRecord) => <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>{item.path.split("/").pop()} · {item.viewer_type}</button>)}</div>}
        {steps.length > 0 && <div className="run-step-list"><strong>Steps</strong>{steps.map((step: RunStep) => <span key={step.id || step.type}><b>{step.id || step.type}</b><small>{step.output || step.status || "done"}</small></span>)}</div>}
        <details className="run-log-details" open={power}>
          <summary>Logs</summary>
          <pre>{(run.logs || detail.logs || []).map((item: RunLog) => `[${item.kind || item.type || "log"}] ${item.content || item.message || ""}`).join("\n") || "(empty)"}</pre>
          {detail.stdout && <pre>{detail.stdout}</pre>}
          {detail.stderr && <pre className="error-text">{detail.stderr}</pre>}
        </details>
        <ChatDock
          projectPath={activePath?.projectPath}
          context={{ kind: "run", label: run.label || run.action_id || run.command || "Run", runId: run.run_id }}
          account={account}
          models={models}
          power={power}
        />
      </div>
    </div>
  );
}

type ArtifactOverlayProps = {
  artifact: OverlayArtifact;
  activePath: ActivePath;
  account?: AccountLike;
  models?: ModelMode[];
  onClose: () => void;
};

function ArtifactOverlay({ artifact, activePath, account, models, onClose }: ArtifactOverlayProps) {
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Artifact Viewer</p>
        <h2>{artifact.path}</h2>
        <span className="soft-pill">{artifact.viewer_type || artifact.kind || artifact.type} · {artifact.size || 0} bytes</span>
        <ViewerPane artifact={artifact} />
        <ChatDock
          projectPath={activePath?.projectPath}
          context={{ kind: "artifact", label: artifact.path, path: artifact.path }}
          account={account}
          models={models}
        />
      </div>
    </div>
  );
}

function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" data-lightbox onClick={onClose}>
      <button type="button" onClick={onClose}>Close</button>
      {item.is_pdf ? (
        <iframe title={item.filename} src={item.url} data-preview-src={item.url} />
      ) : (
        <img src={item.url} alt={item.filename} data-preview-src={item.url} />
      )}
    </div>
  );
}
