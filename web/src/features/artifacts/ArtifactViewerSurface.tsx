import { ChatDock } from "../workflow/components/ChatDock";
import { ViewerPane } from "../workflow/components/ViewerPane";
import type { ActivePath, ArtifactPayload } from "../../shared/contracts/runtime";
import styles from "./ArtifactViewerSurface.module.css";

export type ArtifactViewerSurfaceProps = {
  artifact: ArtifactPayload;
  activePath: ActivePath;
};

export function ArtifactViewerSurface({ artifact, activePath }: ArtifactViewerSurfaceProps) {
  const filename = artifact.path?.split("/").pop() || artifact.path || "artifact";
  const apiHref = activePath?.projectPath
    ? `/api/project-artifact?project=${encodeURIComponent(activePath.projectPath)}&path=${encodeURIComponent(artifact.path)}`
    : `/api/home-artifact?path=${encodeURIComponent(artifact.path)}`;

  async function copyPath() {
    await navigator.clipboard?.writeText(artifact.path || "");
  }

  return (
    <section className={styles.surface}>
      <div className={styles.main}>
        <div>
          <p className="eyebrow">Artifact</p>
          <h2>{filename}</h2>
        </div>
        <ViewerPane artifact={artifact} />
        <ChatDock
          projectPath={activePath?.projectPath}
          context={{ kind: "artifact", label: artifact.path, path: artifact.path }}
        />
      </div>
      <aside className={styles.meta} aria-label="Artifact metadata">
        <h3>Output metadata</h3>
        <MetaRow label="Path"><code>{artifact.path}</code></MetaRow>
        <MetaRow label="Type"><strong>{artifact.kind || artifact.type || "artifact"}</strong></MetaRow>
        <MetaRow label="Viewer"><strong>{artifact.viewer_type || artifact.type || "auto"}</strong></MetaRow>
        <MetaRow label="Size"><strong>{artifact.size ? `${artifact.size} bytes` : "unknown"}</strong></MetaRow>
        <MetaRow label="Source run"><strong>{artifact.source_run || artifact.run?.run_id || "unknown"}</strong></MetaRow>
        <div className={styles.actions}>
          <a href={apiHref} target="_blank" rel="noreferrer">Open raw</a>
          <button type="button" onClick={copyPath}>Copy path</button>
        </div>
      </aside>
    </section>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      {children}
    </div>
  );
}
