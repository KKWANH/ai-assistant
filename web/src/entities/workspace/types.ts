import type { ModelCatalogItem } from "../../shared/contracts/workbench";
import type { ProjectSummary } from "../project/types";

export type AccountSummary = {
  username: string;
  nickname?: string;
  display_name?: string;
  admin?: boolean;
  avatar_url?: string;
  profile?: {
    name?: string;
    language?: string;
    ui_mode?: "easy" | "power" | string;
    [key: string]: unknown;
  };
  model_catalog?: ModelCatalogItem[];
  cost_usage?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type WorkspaceSummary = {
  projects: ProjectSummary[];
  chats: ProjectSummary[];
  account: AccountSummary;
  model_catalog: ModelCatalogItem[];
  workbench_contract?: Record<string, unknown>;
};
