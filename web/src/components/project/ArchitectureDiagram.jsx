import React from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodes = [
  { id: "ui", position: { x: 0, y: 80 }, data: { label: "React UI\nChat · Workbench · Files" }, type: "default" },
  { id: "api", position: { x: 260, y: 80 }, data: { label: "Python HTTP API\nAuth · Routes · CSRF" } },
  { id: "storage", position: { x: 540, y: 0 }, data: { label: "File Workspace\nJSONL · Markdown · Runs" } },
  { id: "context", position: { x: 540, y: 160 }, data: { label: "Context Manifest\nFiles · Goals · Memory" } },
  { id: "models", position: { x: 820, y: 0 }, data: { label: "Model Router\nOllama · Gemini · Kimi · OpenAI" } },
  { id: "actions", position: { x: 820, y: 160 }, data: { label: "Project Commands\nPrompt · Shell · Python" } },
  { id: "publish", position: { x: 1080, y: 80 }, data: { label: "Future Publisher\nArtifacts · Sharing" } },
];

const edges = [
  { id: "ui-api", source: "ui", target: "api", animated: true },
  { id: "api-storage", source: "api", target: "storage" },
  { id: "api-context", source: "api", target: "context" },
  { id: "context-models", source: "context", target: "models", animated: true },
  { id: "context-actions", source: "context", target: "actions" },
  { id: "actions-storage", source: "actions", target: "storage" },
  { id: "storage-publish", source: "storage", target: "publish" },
];

export function ArchitectureDiagram() {
  return (
    <div className="architecture-diagram" aria-label="AIWS architecture diagram">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
        <Background color="rgba(143, 192, 255, .12)" gap={18} />
        <MiniMap pannable={false} zoomable={false} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
