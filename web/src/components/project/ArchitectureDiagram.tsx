import React from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styles from "./ProjectDashboard.module.css";

const nodes = [
  { id: "input", position: { x: 0, y: 130 }, data: { label: "User Input\nChat · Workbench · Recipe" }, type: "default" },
  { id: "intent", position: { x: 245, y: 130 }, data: { label: "Intent Router\nchat · file · code · run" } },
  { id: "planner", position: { x: 490, y: 130 }, data: { label: "Planner AI\nsteps · model · risk · cost" } },
  { id: "context", position: { x: 735, y: 10 }, data: { label: "Context Builder\nfiles · memory · goal · runs" } },
  { id: "approval", position: { x: 735, y: 250 }, data: { label: "Approval Gate\nread-only · cloud · command" } },
  { id: "models", position: { x: 980, y: 10 }, data: { label: "Model Router\nOllama · Gemini · Kimi · OpenAI" } },
  { id: "tools", position: { x: 980, y: 250 }, data: { label: "Tool Executors\nPython · Shell · Codex · OpenClaw" } },
  { id: "store", position: { x: 1225, y: 130 }, data: { label: "Run Store\nplan · steps · stdout · artifacts" } },
  { id: "synthesis", position: { x: 1470, y: 130 }, data: { label: "Synthesis AI\nanswer · next actions" } },
  { id: "output", position: { x: 1715, y: 130 }, data: { label: "Workbench Output\nchat · files · viewer · publish" } },
  { id: "publisher", position: { x: 1470, y: 300 }, data: { label: "Publisher\nplanned · redaction · share" } },
];

const edges = [
  { id: "input-intent", source: "input", target: "intent", animated: true },
  { id: "intent-planner", source: "intent", target: "planner", animated: true },
  { id: "planner-context", source: "planner", target: "context" },
  { id: "planner-approval", source: "planner", target: "approval" },
  { id: "context-models", source: "context", target: "models" },
  { id: "approval-tools", source: "approval", target: "tools", animated: true },
  { id: "models-store", source: "models", target: "store" },
  { id: "tools-store", source: "tools", target: "store" },
  { id: "store-synthesis", source: "store", target: "synthesis", animated: true },
  { id: "synthesis-output", source: "synthesis", target: "output", animated: true },
  { id: "store-publisher", source: "store", target: "publisher" },
  { id: "publisher-output", source: "publisher", target: "output" },
];

export function ArchitectureDiagram() {
  return (
    <div className={styles["architecture-diagram"]} aria-label="AIWS architecture diagram">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
        <Background color="rgba(143, 192, 255, .12)" gap={18} />
        <MiniMap pannable={false} zoomable={false} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
