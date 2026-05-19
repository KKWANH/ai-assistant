import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  path: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  visibility: z.enum(["private", "public"]),
  kind: z.enum(["general", "structured", "workflow_app"]),
  created_at: z.string(),
  updated_at: z.string(),
  manifest_status: z.string()
});

export const sessionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  project_path: z.string(),
  title: z.string(),
  kind: z.enum(["chat", "project_chat", "action_thread"]),
  created_at: z.string(),
  updated_at: z.string(),
  summary: z.string()
});
