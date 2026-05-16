export type {
  InputSchemaField,
  OutputArtifactSpec,
  RunPolicy,
  ViewerSlot,
  WorkflowAppDefinition,
} from "../../entities/workflow-app/types";

export type WorkflowInputValue = string | number | boolean | File | null;

export type WorkflowRunInputValues = Record<string, WorkflowInputValue>;
