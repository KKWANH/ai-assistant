export type PrivacyMode = "local" | "cloud" | "private";

export type AttachmentMeta = {
  filename: string;
  url?: string;
  is_image?: boolean;
  is_pdf?: boolean;
  delivery?: string;
  text_preview?: string;
  table_preview?: unknown;
};

export type ContextReceipt = {
  provider?: string;
  model?: string;
  privacy_mode?: PrivacyMode | string;
  estimated_cost?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  files_used?: string[];
  files_excluded?: string[];
  files_sent_to_cloud?: string[];
  included_chunks?: Array<Record<string, unknown>>;
  action_plan?: Array<Record<string, unknown>>;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool" | string;
  content: string;
  actor?: string;
  actor_display?: string;
  created_at?: string;
  provider?: string;
  model?: string;
  estimated_cost?: number | null;
  pending?: boolean;
  attachments?: AttachmentMeta[];
  context_receipt?: ContextReceipt;
  execution_plan?: Record<string, unknown>;
};

export type ModelCatalogItem = {
  value: string;
  group: string;
  label: string;
  provider: string;
  model: string;
  cloud: boolean;
  inputPrice?: number;
  outputPrice?: number;
  input_per_million?: number;
  output_per_million?: number;
  api_key_configured?: boolean;
  supportsText?: boolean;
  supportsImage?: boolean;
  supportsFileText?: boolean;
  supportsWebSearch?: boolean;
  recommendedUse?: string;
  bestFor?: string;
  cost?: string;
};

export type PanelDefinition = {
  id: string;
  type: string;
  title?: string;
  source?: string;
  [key: string]: unknown;
};

export type ProjectLink = {
  linkId: string;
  fromProject: string;
  toProject: string;
  allowedResourceTypes: string[];
  mode: "read" | "append" | "compute" | string;
  grantedBy?: string;
  createdAt?: string;
  status?: "pending" | "approved" | "revoked" | string;
};

export type ResourceExport = {
  projectId: string;
  resourceType: string;
  artifactPattern: string;
  schemaVersion: string;
  label?: string;
};

export type ResourceImport = {
  sourceProjectId: string;
  acceptedResourceType: string;
  localAlias: string;
  status?: "pending" | "approved" | "revoked" | string;
};

export type ProjectConnectionsPayload = {
  projectId: string;
  exports: ResourceExport[];
  imports: ResourceImport[];
  incomingLinks: ProjectLink[];
  outgoingLinks: ProjectLink[];
  connectedResources: Array<ResourceExport & { sourceProjectId?: string; mode?: string; linkId?: string }>;
  visibleSources: Array<{ projectId: string; title: string; exports: ResourceExport[] }>;
};

export type RunRecord = {
  run_id: string;
  created_at?: string;
  workspace_id?: string;
  session_id?: string | null;
  project_path?: string | null;
  action_id?: string;
  action_label?: string;
  label?: string;
  command?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  model?: { provider: string; id: string; local: boolean };
  inputs?: Record<string, unknown>;
  context_receipt?: ContextReceipt;
  steps?: Array<Record<string, unknown>>;
  artifacts?: ArtifactRecord[];
  error?: string | null;
};

export type ArtifactRecord = {
  artifact_id?: string;
  id?: string;
  path: string;
  type?: string;
  viewer_type?: string;
  source_run?: string;
  created_at?: string;
  size?: number;
  exists?: boolean;
  summary?: string;
  content?: string;
  run?: Pick<RunRecord, "run_id" | "label" | "command" | "status">;
};
