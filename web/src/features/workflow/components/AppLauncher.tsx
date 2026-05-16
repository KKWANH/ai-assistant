import React from "react";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";
import { InputSchemaForm } from "./InputSchemaForm";

export function AppLauncher({ app, running, onPreview, onRun }: { app: WorkflowAppDefinition; running?: boolean; onPreview?: () => void; onRun?: () => void }) {
  return (
    <article className="workflow-app-launcher">
      <div>
        <div className="action-title-row">
          <strong>{app.title}</strong>
          <span className="status-badge ready">{app.category}</span>
        </div>
        <p>{app.description}</p>
        <div className="action-badges">
          <span>{app.runPolicy.mode}</span>
          <span>{app.outputSchema.length} outputs</span>
          <span>{app.defaultViewerLayout.length} viewer slots</span>
        </div>
      </div>
      <InputSchemaForm fields={app.inputSchema} />
      <div className="action-buttons">
        <button type="button" onClick={onPreview}>Review inputs</button>
        <button type="button" onClick={onRun} disabled={running}>{running ? "Running" : "Run app"}</button>
      </div>
    </article>
  );
}
