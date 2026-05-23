import { z } from "zod";
import { PROVIDERS } from "./config.js";

/** POST /api/workspaces */
export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  rootPath: z.string().min(1),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** Optional template that scaffolds example files + a custom surface. */
  starter: z.enum(["blank", "portfolio", "budget", "reading", "chefbook", "code", "decisions", "papers"]).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

/** PUT /api/workspaces/:id/surface */
export const SurfacePutSchema = z.object({
  source: z.string(),
});
export type SurfacePutInput = z.infer<typeof SurfacePutSchema>;

/** PUT /api/account/locale */
export const UpdateLocaleSchema = z.object({
  locale: z.string().min(2).max(10),
});
export type UpdateLocaleInput = z.infer<typeof UpdateLocaleSchema>;

/** PATCH /api/workspaces/:id */
export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

/** PUT /api/account/mode */
export const UpdateModeSchema = z.object({
  mode: z.enum(["standard", "simple"]),
});
export type UpdateModeInput = z.infer<typeof UpdateModeSchema>;

/** PUT /api/account/context — the user's saved profile text. */
export const UpdateContextSchema = z.object({
  context: z.string().max(2000),
});
export type UpdateContextInput = z.infer<typeof UpdateContextSchema>;

/** PUT /api/workspaces/:id/actions — raw YAML source of the action defs. */
export const ActionsPutSchema = z.object({
  source: z.string(),
});
export type ActionsPutInput = z.infer<typeof ActionsPutSchema>;

/** POST /api/runs */
export const CreateRunSchema = z.object({
  workspaceId: z.string().min(1),
  templateId: z.string().min(1),
  input: z.record(z.string()),
});
export type CreateRunInput = z.infer<typeof CreateRunSchema>;

/** POST /api/workspaces/:id/actions/:actionId/run — run a block-pipeline action. */
export const CreateActionRunSchema = z.object({
  input: z.record(z.string()).optional(),
});
export type CreateActionRunInput = z.infer<typeof CreateActionRunSchema>;

/** POST /api/runs/:id/context — confirm the context pick. */
export const ConfirmContextSchema = z.object({
  /** Final set of file paths the user approved for the focused read. */
  selected: z.array(z.string()),
});
export type ConfirmContextInput = z.infer<typeof ConfirmContextSchema>;

/** PUT /api/settings */
export const UpdateSettingsSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

/** POST /api/auth/login */
export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** PUT /api/workspaces/:id/scripts/:name */
export const ScriptPutSchema = z.object({
  content: z.string(),
});
export type ScriptPutInput = z.infer<typeof ScriptPutSchema>;

/** POST /api/search */
export const SearchSchema = z.object({
  query: z.string().min(1).max(500),
});
export type SearchInput = z.infer<typeof SearchSchema>;

/** POST /api/reports — anyone may submit a bug report / suggestion. */
export const CreateReportSchema = z.object({
  type: z.enum(["bug", "suggestion", "other"]),
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(4000),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1),
        mediaType: z.string().min(1),
        dataBase64: z.string().min(1),
      }),
    )
    .max(6)
    .optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

/** POST /api/reports/:id/decision — admin files the report as an issue or rejects it. */
export const ReportDecisionSchema = z.object({
  decision: z.enum(["file", "reject"]),
});
export type ReportDecisionInput = z.infer<typeof ReportDecisionSchema>;

/** POST /api/chats */
export const CreateChatSchema = z.object({
  title: z.string().max(200).optional(),
  workspaceId: z.string().nullable().optional(),
});
export type CreateChatInput = z.infer<typeof CreateChatSchema>;

/** PATCH /api/chats/:id */
export const UpdateChatSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  workspaceId: z.string().nullable().optional(),
});
export type UpdateChatInput = z.infer<typeof UpdateChatSchema>;

/** An attachment uploaded inline (base64) with a chat message. */
export const PostAttachmentSchema = z.object({
  name: z.string().min(1),
  mediaType: z.string().min(1),
  dataBase64: z.string().min(1),
});
export type PostAttachmentInput = z.infer<typeof PostAttachmentSchema>;

/** POST /api/chats/:id/messages */
export const PostMessageSchema = z.object({
  content: z.string(),
  attachments: z.array(PostAttachmentSchema).optional(),
  /** Web search mode: off (never), auto (the server decides), on (always). */
  webSearch: z.enum(["off", "auto", "on"]).optional(),
  /**
   * Agent plan-and-execute mode: off (never), auto (classifier decides per
   * message — only kicks in for multi-step research-ish prompts), on
   * (always). Legacy `boolean` still accepted from older clients: true→"on",
   * false→"off".
   */
  agentMode: z.union([z.boolean(), z.enum(["off", "auto", "on"])]).optional(),
});
export type PostMessageInput = z.infer<typeof PostMessageSchema>;

/* ── Action schedules ───────────────────────────────────────────────── */

export const CreateScheduleSchema = z.object({
  workspaceId: z.string().min(1),
  actionId: z.string().min(1),
  frequency: z.enum(["hourly", "daily", "weekly", "monthly"]),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const UpdateScheduleSchema = z.object({
  frequency: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

/* ── Skills ─────────────────────────────────────────────────────────── */

/** POST /api/skills — create a new skill for the calling account. */
export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(40),
  prompt: z.string().min(1).max(4000),
});
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

/** PATCH /api/skills/:id — partial update. */
export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  prompt: z.string().min(1).max(4000).optional(),
});
export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;
