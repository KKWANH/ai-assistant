export const PANEL_TYPES = [
  "fileExplorer",
  "tableViewer",
  "markdownViewer",
  "pdfViewer",
  "imageViewer",
  "jsonTree",
  "chart",
  "runTimeline",
  "actionLauncher",
  "costMeter",
  "modelRouter",
  "diffViewer",
  "logConsole",
  "plannerTrace",
  "webPreview",
  "formPanel",
  "folderStats",
  "artifactGallery",
  "codeEditor",
  "reportBuilder",
];

export const ACTION_KINDS = [
  "prompt_recipe",
  "shell",
  "python",
  "file_index",
  "codex_prompt",
  "openclaw_status",
];

export const AGENT_PLAN_STATUSES = ["draft", "waiting_approval", "running", "completed", "failed"];
export const AGENT_STEP_KINDS = ["search", "read_file", "write_file", "python", "shell", "llm", "report"];

type ContractSource = Record<string, unknown>;

export function normalizePanelDefinition(panel: ContractSource = {}, index = 0) {
  const type = String(panel.type || "panel");
  return {
    id: String(panel.id || `${type}-${index}`),
    type: PANEL_TYPES.includes(type) ? type : "markdownViewer",
    title: String(panel.title || type || "Panel"),
    source: String(panel.source || ""),
    layout: String(panel.layout || ""),
    actions: Array.isArray(panel.actions) ? panel.actions : [],
    visibility: String(panel.visibility || "default"),
    props: panel.props && typeof panel.props === "object" ? panel.props : {},
  };
}

export function normalizeActionDefinition(id: string, action: ContractSource = {}) {
  const kind = String(action.kind || "prompt_recipe");
  return {
    id: String(id || action.id || action.label || "action"),
    label: String(action.label || action.title || id || "Workflow App"),
    kind: ACTION_KINDS.includes(kind) ? kind : "prompt_recipe",
    permission: String(action.permission || "read-only"),
    inputs: Array.isArray(action.inputs) ? action.inputs : [],
    outputs: Array.isArray(action.outputs) ? action.outputs : [],
  };
}

export function createAgentPlanPreview(goal: unknown, steps: ContractSource[] = []) {
  return {
    id: `preview-${Date.now()}`,
    goal: String(goal || "Untitled agent run"),
    status: "draft",
    modelPolicy: {
      planner: "local-first",
      executor: "confirm-dangerous-steps",
      synthesizer: "selected-chat-model",
    },
    steps: steps.map((step, index) => ({
      id: String(step.id || `step-${index + 1}`),
      title: String(step.title || step.kind || `Step ${index + 1}`),
      kind: AGENT_STEP_KINDS.includes(String(step.kind)) ? String(step.kind) : "llm",
      status: String(step.status || "pending"),
      input: step.input || null,
      output: step.output || null,
      artifacts: Array.isArray(step.artifacts) ? step.artifacts : [],
      requiresApproval: Boolean(step.requiresApproval),
      costUsd: Number(step.costUsd || 0),
      logs: Array.isArray(step.logs) ? step.logs : [],
    })),
  };
}
