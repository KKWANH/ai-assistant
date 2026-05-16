import React from "react";
import { MarkdownRenderer } from "../../components/markdown/MarkdownRenderer.jsx";

export function MarkdownViewer({ artifact }: { artifact: { content?: string; path?: string } }) {
  const content = artifact.content || "";
  return (
    <div className="markdown-viewer">
      <div className="viewer-action-row">
        <span className="muted">{artifact.path || "Markdown artifact"}</span>
        <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(content)}>
          Copy markdown
        </button>
      </div>
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </div>
  );
}
