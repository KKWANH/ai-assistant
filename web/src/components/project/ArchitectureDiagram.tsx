import React from "react";
import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styles from "./ProjectDashboard.module.css";

const nodes = [
  { id: "project", position: { x: 0, y: 130 }, data: { label: "Project Folder\naiws.yaml · files · viewers" }, type: "default" },
  { id: "inputs", position: { x: 245, y: 130 }, data: { label: "Inputs\nchat · files · linked resources" } },
  { id: "planner", position: { x: 490, y: 130 }, data: { label: "Context Planner\nmode · budget · privacy" } },
  { id: "retrieval", position: { x: 735, y: 10 }, data: { label: "Retrieval Index\nFTS5 · native watcher · linked RAG" } },
  { id: "manifest", position: { x: 735, y: 250 }, data: { label: "Context Receipt\nsources · files · cost" } },
  { id: "models", position: { x: 980, y: 10 }, data: { label: "Model Router\nOllama · Gemini · BYOK" } },
  { id: "apps", position: { x: 980, y: 250 }, data: { label: "Workflow Apps\nschema · run policy · approval" } },
  { id: "runs", position: { x: 1225, y: 130 }, data: { label: "Run Store\nlogs · stdout · artifacts" } },
  { id: "viewers", position: { x: 1470, y: 70 }, data: { label: "Viewers\nbuilt-in · trusted TSX iframe" } },
  { id: "connections", position: { x: 1470, y: 250 }, data: { label: "Project Links\nexports · imports · aliases" } },
  { id: "output", position: { x: 1715, y: 130 }, data: { label: "Workbench Output\nanswer · dashboard · report" } },
];

const edges = [
  { id: "project-inputs", source: "project", target: "inputs", animated: true },
  { id: "inputs-planner", source: "inputs", target: "planner", animated: true },
  { id: "planner-retrieval", source: "planner", target: "retrieval" },
  { id: "planner-manifest", source: "planner", target: "manifest" },
  { id: "retrieval-models", source: "retrieval", target: "models" },
  { id: "manifest-apps", source: "manifest", target: "apps", animated: true },
  { id: "models-runs", source: "models", target: "runs" },
  { id: "apps-runs", source: "apps", target: "runs" },
  { id: "runs-viewers", source: "runs", target: "viewers", animated: true },
  { id: "runs-connections", source: "runs", target: "connections" },
  { id: "viewers-output", source: "viewers", target: "output", animated: true },
  { id: "connections-output", source: "connections", target: "output" },
];

export function ArchitectureDiagram() {
  return (
    <div className={styles["architecture-diagram"]} aria-label="AIWS architecture diagram">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(143, 192, 255, .12)" gap={18} />
      </ReactFlow>
    </div>
  );
}
