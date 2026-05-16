import React from "react";
import { MarkdownRenderer } from "../../components/markdown/MarkdownRenderer";

export function MarkdownViewer({ artifact }: { artifact: { content?: string; path?: string } }) {
  const content = artifact.content || "";
  function downloadMarkdown() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.path?.split("/").pop() || "artifact.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="markdown-viewer">
      <div className="viewer-action-row">
        <span className="muted">{artifact.path || "Markdown artifact"}</span>
        <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(content)}>
          Copy markdown
        </button>
        <button type="button" className="ghost-button" onClick={downloadMarkdown}>
          Download markdown
        </button>
      </div>
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </div>
  );
}
