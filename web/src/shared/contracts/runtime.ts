import type { AccountSummary, WorkspaceSummary } from "../../entities/workspace/types";
import type { ProjectSummary } from "../../entities/project/types";
import type { ChatSessionPayload } from "../../entities/session/types";
import type { ArtifactRecord, ModelCatalogItem, ProjectConnectionsPayload, RunRecord } from "./workbench";
import type { ProjectConfigPayload } from "../api/client";

export type ActivePath = {
  view?: string;
  projectPath?: string;
  sessionSlug?: string;
};

export type NavigateFn = (path: string) => void;
export type RefreshFn = () => void | Promise<void>;

export type ChatUpdater = ChatSessionPayload | ((current: ChatSessionPayload | null) => ChatSessionPayload | null);

export type HomePayload = {
  actions?: HomeAction[];
  runs?: RunRecord[];
  [key: string]: unknown;
};

export type HomeAction = {
  id: string;
  label?: string;
  title?: string;
  category?: string;
  status?: string;
  description?: string;
  inputs?: string | string[];
  input?: string;
  output?: string;
  expected_output_artifacts?: string[];
  resource_type?: string;
  tool_type?: string;
  workflow_app?: {
    defaultViewerLayout?: Array<{ viewer_id?: string }>;
  };
  disabled?: boolean;
  wantsFile?: boolean;
  wantsBrief?: boolean;
  prompt?: string;
  viewer?: string;
  scope?: string;
  [key: string]: unknown;
};

export type RuntimePayload = {
  status?: string;
  cloudflare_url?: string;
  diagnostics_visible?: boolean;
  [key: string]: unknown;
};

export type OpenClawPayload = {
  installed?: boolean;
  version?: string;
  gateway?: { summary?: Record<string, unknown> };
  sessions?: { count?: number; totalCount?: number };
  [key: string]: unknown;
};

export type AutomationProject = {
  slug: string;
  title: string;
  category?: string;
  kind?: string;
  latest_run?: RunRecord;
};

export type ProjectConfigState = ProjectConfigPayload | null;

export type RunDetail = {
  run?: RunRecord;
  result?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  logs?: Array<Record<string, unknown>>;
  markdown?: string;
};

export type ArtifactPayload = ArtifactRecord & {
  kind?: string;
  content?: string;
};

export type WorkspaceLike = WorkspaceSummary;
export type AccountLike = AccountSummary;
export type ProjectLike = ProjectSummary;
export type ModelLike = ModelCatalogItem;
export type ConnectionsLike = ProjectConnectionsPayload | null;
