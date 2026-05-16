import React from "react";
import { MarkdownViewer } from "./markdownViewer";

export function ReportViewer({ artifact }: { artifact: { content?: string } }) {
  return (
    <div className="report-viewer">
      <div className="viewer-action-row">
        <strong>Report</strong>
        <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(artifact.content || "")}>
          Copy report
        </button>
      </div>
      <MarkdownViewer artifact={artifact} />
    </div>
  );
}
