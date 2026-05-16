import type { AttachmentMeta, ChatMessage } from "../../shared/contracts/workbench";

export type SessionSummary = {
  slug: string;
  title: string;
  created_at?: string;
  projectPath?: string;
};

export type ChatSessionPayload = {
  project?: { path: string; title: string; hidden?: boolean };
  session?: SessionSummary;
  messages?: ChatMessage[];
  attachments?: AttachmentMeta[];
  skills?: string[];
  goal?: Record<string, unknown>;
  codex_prompt?: string;
  latest?: Record<string, unknown>;
  context_manifest?: Record<string, unknown>;
  work_session?: Record<string, unknown>;
  task_suggestions?: unknown[];
};
