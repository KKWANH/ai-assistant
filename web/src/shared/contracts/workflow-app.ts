export type {
  InputSchemaField,
  OutputArtifactSpec,
  RunPolicy,
  ViewerSlot,
  WorkflowAppDefinition,
} from "../../entities/workflow-app/types";
import type { WorkflowAppDefinition } from "../../entities/workflow-app/types";

export type WorkflowActionDefinition = {
  id: string;
  kind: "prompt_recipe" | "shell" | "python" | "file_index" | "codex_prompt" | string;
  label: string;
  description?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown> | string;
  permissions?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
  workflow_app?: WorkflowAppDefinition;
};
