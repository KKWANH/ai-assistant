export type AccountSummary = {
  username: string;
  nickname?: string;
  display_name?: string;
  admin?: boolean;
  profile?: { ui_mode?: string; language?: string; [key: string]: unknown };
  model_catalog?: ModelCatalogItem[];
};

export type ModelCatalogItem = {
  id?: string;
  model?: string;
  provider?: string;
  label?: string;
  local?: boolean;
  available?: boolean;
  missing_key?: boolean;
  cost?: string;
  [key: string]: unknown;
};

export type ProjectSummary = {
  path: string;
  title: string;
  visibility?: string;
  hidden?: boolean;
  sessions?: SessionSummary[];
};

export type SessionSummary = {
  slug: string;
  title?: string;
  created_at?: string;
  projectPath?: string;
  projectTitle?: string;
};

export type WorkspaceSummary = {
  account: AccountSummary;
  projects: ProjectSummary[];
  chats: ProjectSummary[];
  model_catalog?: ModelCatalogItem[];
};

export type RunRecord = {
  run_id: string;
  action_id?: string;
  action_label?: string;
  command?: string;
  label?: string;
  status?: string;
  created_at?: string;
  duration_ms?: number;
  estimated_cost?: number;
  model?: { provider?: string; id?: string; local?: boolean };
  artifacts?: ArtifactRecord[];
  [key: string]: unknown;
};

export type ArtifactRecord = {
  id?: string;
  path: string;
  filename?: string;
  type?: string;
  viewer_type?: string;
  viewer_id?: string;
  size?: number;
  created_at?: string;
  projectPath?: string;
  projectTitle?: string;
  run_id?: string;
  [key: string]: unknown;
};

export type HomePayload = {
  runs?: RunRecord[];
  actions?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type ProjectConfigPayload = {
  project?: Record<string, unknown>;
  config?: {
    name?: string;
    description?: string;
    commands?: Record<string, Record<string, unknown>>;
    context?: { include?: string[]; exclude?: string[]; [key: string]: unknown };
    workflow_apps?: Array<Record<string, unknown>>;
  };
  runs?: RunRecord[];
  connections?: unknown;
};

export type ChatMessage = {
  role: string;
  content?: string;
  created_at?: string;
  provider?: string;
  model?: string;
  estimated_cost?: number;
  context_receipt?: ContextReceipt;
  attachments?: Array<Record<string, unknown>>;
  pending?: boolean;
};

export type ChatPayload = {
  project?: ProjectSummary;
  session?: SessionSummary;
  messages?: ChatMessage[];
  latest?: { provider?: string; model?: string };
  attachments?: Array<Record<string, unknown>>;
};

export type ContextReceipt = {
  provider?: string;
  model?: string;
  local?: boolean;
  cloud?: boolean;
  estimated_cost?: number;
  estimated_cost_usd?: number;
  included_files?: unknown[];
  files_used?: unknown[];
  included_chunks?: unknown[];
  excluded_files?: unknown[];
  [key: string]: unknown;
};

export type RunsResponse = {
  runs: RunRecord[];
  total?: number;
  limit?: number;
  offset?: number;
};

export type ArtifactsResponse = {
  artifacts: ArtifactRecord[];
  total?: number;
  limit?: number;
  offset?: number;
};
