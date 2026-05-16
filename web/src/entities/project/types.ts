import type { SessionSummary } from "../session/types";
export type { ProjectConnectionsPayload, ProjectLink, ResourceExport, ResourceImport } from "../../shared/contracts/workbench";

export type ProjectSummary = {
  path: string;
  title: string;
  created_at?: string;
  parent?: string;
  level?: number;
  owner?: string;
  owner_display?: string;
  visibility?: "private" | "public" | string;
  hidden?: boolean;
  firstSessionUrl?: string;
  sessions: SessionSummary[];
};
