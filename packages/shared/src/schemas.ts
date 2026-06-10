import { z } from "zod";
import { PROVIDERS } from "./config.js";

/** POST /api/workspaces */
export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  rootPath: z.string().min(1),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** Optional template that scaffolds example files + a custom surface. */
  starter: z.enum(["blank", "portfolio", "budget", "reading", "chefbook", "code", "decisions", "papers", "lecture"]).optional(),
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
  /** AY — when true, the server converts the file to markdown via
   *  markitdown before extracting text. Drops the file's binary
   *  footprint in the prompt by ~10x for slide decks while preserving
   *  headings + tables. Falls back to legacy extraction if markitdown
   *  isn't installed or the conversion fails. */
  useMarkdown: z.boolean().optional(),
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
   * (always), deep (R4 — decompose into 2–4 sub-questions, fan out parallel
   * sub-agents, synthesize; cost-aware, explicit only). Legacy `boolean` still
   * accepted from older clients: true→"on", false→"off".
   */
  agentMode: z.union([z.boolean(), z.enum(["off", "auto", "on", "deep"])]).optional(),
  /**
   * Reply mode:
   *   - "standard" (default): full pipeline — workspace retrieval, memory
   *     injection, optional agent, web-search classifier. What the chat
   *     has always done.
   *   - "instant": skip ALL upstream classification, retrieval, and
   *     memory. Direct provider stream. Speed-first. For chitchat,
   *     definitions, quick one-liners — anything that doesn't need
   *     grounding. When the user picks instant, agentMode/webSearch
   *     fields are ignored by the server.
   */
  mode: z.enum(["standard", "instant"]).optional(),
});
export type PostMessageInput = z.infer<typeof PostMessageSchema>;

/** POST /api/compare — run one prompt against 2–4 models concurrently and
 *  return every answer (the cross-vendor "second opinion"). */
export const CompareSchema = z.object({
  prompt: z.string().min(1),
  models: z
    .array(z.object({ provider: z.enum(PROVIDERS), model: z.string().min(1) }))
    .min(2)
    .max(4),
});
export type CompareInput = z.infer<typeof CompareSchema>;

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

export const CreateTriggerSchema = z.object({
  workspaceId: z.string().min(1),
  actionId: z.string().min(1),
});
export type CreateTriggerInput = z.infer<typeof CreateTriggerSchema>;

/* ── Skills ─────────────────────────────────────────────────────────── */

const SkillVariableSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/i, "lowercase + underscore"),
  label: z.string().max(80).optional(),
  hint: z.string().max(200).optional(),
  default: z.string().max(400).optional(),
});

/** POST /api/skills — create a new skill for the calling account. */
export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(40),
  prompt: z.string().min(1).max(4000),
  description: z.string().max(200).optional(),
  variables: z.array(SkillVariableSchema).max(8).optional(),
});
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

/** PATCH /api/skills/:id — partial update. */
export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  prompt: z.string().min(1).max(4000).optional(),
  description: z.string().max(200).nullable().optional(),
  variables: z.array(SkillVariableSchema).max(8).nullable().optional(),
});
export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;

/**
 * POST /api/eval-cases/promote — promote a bad chat answer or bad search
 * result into a permanent eval case. The case lives under
 * apps/server/src/eval/cases/user-promoted/<workspaceId>/ and is picked up
 * by `npm run eval:retrieval:promoted`.
 *
 * At least one of mustHitPath / shouldNotHitPath / note must be set —
 * a query with no positive or negative expectation isn't a useful case.
 */
/**
 * PUT /api/workspaces/:id/hooks — replace the whole `.ariadne/hooks.yaml`
 * source. Local-only. Validated server-side after YAML parse — the
 * raw schema is intentionally permissive so users can hand-edit
 * comments/anchors without round-trip corruption.
 */
export const PutHooksSchema = z.object({
  source: z.string().max(50_000),
});
export type PutHooksInput = z.infer<typeof PutHooksSchema>;

/**
 * POST /api/mcp-servers — register a new MCP server endpoint. Each
 * entry describes how to launch (stdio) the server; the connection
 * manager spawns lazily on first agent call.
 */
export const CreateMcpServerSchema = z.object({
  name: z.string().min(1).max(60),
  transport: z.enum(["stdio"]).optional(),
  /** Binary to spawn. Validated permissively here — the runtime spawn
   *  enforces "must exist on PATH or be an absolute path". */
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(500)).max(40).optional(),
  /** Env vars merged into the child process. Common case: secrets/tokens. */
  env: z.record(z.string().max(2000)).optional(),
  enabled: z.boolean().optional(),
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerSchema>;

/** PATCH /api/mcp-servers/:id — every field optional. */
export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).max(40).optional(),
  env: z.record(z.string().max(2000)).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerSchema>;

/**
 * POST /api/workspaces/:id/memory — add a new memory entry. The user has
 * already approved the text in the modal; this just persists it to
 * <workspaceRoot>/.ariadne/memory.yaml. No update endpoint in v1: edit
 * via delete + add. Auto-derive is intentionally not exposed; every
 * write goes through this gated path.
 */
export const AddMemorySchema = z.object({
  text: z.string().min(1).max(500),
  /** Optional traceability: a chat message that surfaced this fact. */
  source: z
    .object({
      kind: z.enum(["chat", "manual"]),
      ref: z.string().max(500).optional(),
    })
    .optional(),
});
export type AddMemoryInput = z.infer<typeof AddMemorySchema>;

export const PromoteEvalCaseSchema = z
  .object({
    workspaceId: z.string().min(1),
    query: z.string().min(1).max(500),
    source: z.enum(["chat", "search"]),
    /** Free-form traceability handle: chat message id for source="chat",
     *  chunk file path for source="search". Both kinds get written to the
     *  YAML as `source.ref` so a single field works for both. */
    sourceRef: z.string().max(500).optional(),
    /** "This file should have been retrieved." */
    mustHitPath: z.string().max(500).optional(),
    /** Optional substring on the mustHit file's chunk. */
    mustHitContains: z.string().max(200).optional(),
    /** "This file should NOT have been retrieved." */
    shouldNotHitPath: z.string().max(500).optional(),
    /** Free-text reason. Stored as YAML comment + annotation. */
    note: z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      Boolean(d.mustHitPath) || Boolean(d.shouldNotHitPath) || Boolean(d.note),
    { message: "Provide at least one of mustHitPath / shouldNotHitPath / note" },
  );
export type PromoteEvalCaseInput = z.infer<typeof PromoteEvalCaseSchema>;
