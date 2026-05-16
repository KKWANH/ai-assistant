import React from "react";
import { resolveViewerPlugin, type ViewerArtifact } from "../../../shared/viewers/registry";

export function ViewerPane({ artifact }: { artifact: ViewerArtifact & { kind?: string } }) {
  const normalizedArtifact = normalizeArtifact(artifact);
  const plugin = resolveViewerPlugin(
    normalizedArtifact.viewer_id || normalizedArtifact.viewer_type || fallbackViewer(normalizedArtifact),
    normalizedArtifact,
  );
  const Viewer = plugin.render;
  if (!plugin.validateArtifact(normalizedArtifact)) {
    return (
      <div className="empty-action-state">
        <p className="muted">This artifact does not match the selected viewer contract.</p>
      </div>
    );
  }
  return <Viewer artifact={normalizedArtifact} />;
}

function normalizeArtifact(artifact: ViewerArtifact & { kind?: string }): ViewerArtifact & { kind?: string } {
  return { ...artifact, type: artifact.type || artifact.kind };
}

function fallbackViewer(artifact: { kind?: string; type?: string; path?: string }) {
  const kind = artifact.kind || artifact.type || "";
  if (kind === "csv") return "tableViewer";
  if (kind === "json") return "jsonViewer";
  if (kind === "md" || kind === "markdown") return "markdownViewer";
  if (kind === "chart") return "chartViewer";
  if (kind === "report") return "reportViewer";
  if (artifact.path?.endsWith(".csv")) return "tableViewer";
  if (artifact.path?.endsWith(".md")) return "markdownViewer";
  if (artifact.path?.endsWith(".json")) return "jsonViewer";
  return "textViewer";
}
