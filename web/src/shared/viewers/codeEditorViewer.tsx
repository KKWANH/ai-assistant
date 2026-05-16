import React from "react";
import type { ViewerArtifact } from "../contracts/viewer";

type CodeArtifact = ViewerArtifact & { content?: string; path?: string };

export function CodeEditorViewer({ artifact }: { artifact: CodeArtifact }) {
  const content = artifact.content || "";
  return (
    <div className="code-viewer">
      <div className="viewer-action-row">
        <span className="muted">{artifact.path || "Code artifact"}</span>
        <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(content)}>
          Copy code
        </button>
      </div>
      <pre><code>{content}</code></pre>
    </div>
  );
}
