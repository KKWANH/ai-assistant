import React from "react";
import { MarkdownViewer } from "./markdownViewer";

export function ReportViewer({ artifact }: { artifact: { content?: string } }) {
  function downloadHtml() {
    const html = `<!doctype html><meta charset="utf-8"><pre>${escapeHtml(artifact.content || "")}</pre>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "report.html";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="report-viewer">
      <div className="viewer-action-row">
        <strong>Report</strong>
        <button type="button" className="ghost-button" onClick={() => void navigator.clipboard?.writeText(artifact.content || "")}>
          Copy report
        </button>
        <button type="button" className="ghost-button" onClick={downloadHtml}>
          Download HTML
        </button>
      </div>
      <MarkdownViewer artifact={artifact} />
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
