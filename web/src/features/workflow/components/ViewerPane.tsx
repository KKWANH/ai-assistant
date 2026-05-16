import React from "react";
import { resolveViewerId, VIEWER_REGISTRY } from "../../../shared/viewers/registry";

export function ViewerPane({ artifact }: { artifact: { viewer_id?: string; viewer_type?: string; kind?: string; type?: string; content?: string } }) {
  const viewerId = resolveViewerId(artifact.viewer_id || artifact.viewer_type || fallbackViewer(artifact));
  const Viewer = VIEWER_REGISTRY[viewerId];
  return <Viewer artifact={artifact} />;
}

function fallbackViewer(artifact: { kind?: string; type?: string }) {
  const kind = artifact.kind || artifact.type || "";
  if (kind === "csv") return "tableViewer";
  if (kind === "json") return "jsonViewer";
  if (kind === "md" || kind === "markdown") return "markdownViewer";
  return "textViewer";
}
