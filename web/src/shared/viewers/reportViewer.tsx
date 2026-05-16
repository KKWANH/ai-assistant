import React from "react";
import { MarkdownViewer } from "./markdownViewer";

export function ReportViewer({ artifact }: { artifact: { content?: string } }) {
  return (
    <div className="report-viewer">
      <MarkdownViewer artifact={artifact} />
    </div>
  );
}
