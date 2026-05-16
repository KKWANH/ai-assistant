export type RunPolicy = {
  mode: "local_only" | "approval_required" | "cloud_allowed";
  requiresConfirmation: boolean;
  network: "blocked" | "approval_required" | "allowed";
  fileWrite: "artifacts_only" | "project" | "blocked";
  cloud: "blocked" | "approval_required" | "allowed";
};

export type InputSchemaField = {
  id: string;
  label: string;
  type: "file" | "text" | "select" | "number" | "boolean";
  required?: boolean;
  accept?: string[];
  placeholder?: string;
  help?: string;
  options?: Array<{ label: string; value: string }>;
};

export type OutputArtifactSpec = {
  id: string;
  path: string;
  type: "json" | "csv" | "markdown" | "chart" | "report" | "text";
  viewer_id: string;
  description?: string;
};

export type ViewerSlot = {
  id: string;
  title: string;
  viewer_id: string;
  artifact?: string;
  position: "left" | "center" | "right" | "full";
};

export type WorkflowAppDefinition = {
  id: string;
  title: string;
  description: string;
  category: string;
  inputSchema: InputSchemaField[];
  outputSchema: OutputArtifactSpec[];
  runPolicy: RunPolicy;
  defaultViewerLayout: ViewerSlot[];
  supportedResources: string[];
  permissions: Record<string, boolean | string>;
};
