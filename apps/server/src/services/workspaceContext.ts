/**
 * Workspace context (project instructions) service.
 *
 * Free-text, user-authored standing context for a workspace, stored at
 * `<root>/.ariadne/context.md`. Distinct from memory (facts the AI captured
 * and the user confirmed): this is the user's OWN brief — "what this project
 * is, how I want you to work, who the audience is". It is injected into every
 * chat's system prompt and into deck/script generation, so one editable place
 * sets the tone for everything. General to all workspaces, not lecture-only.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureAriadneFolder } from "../ariadneFolder.js";

const CONTEXT_FILE = "context.md";
const MAX_LEN = 8000;

function contextPath(root: string): string {
  return path.join(root, ".ariadne", CONTEXT_FILE);
}

/** Read the workspace's project context. Missing file → "". */
export function getWorkspaceContext(root: string): string {
  try {
    return fs.readFileSync(contextPath(root), "utf-8");
  } catch {
    return "";
  }
}

/** Write (or clear) the workspace's project context. */
export function setWorkspaceContext(root: string, text: string): void {
  ensureAriadneFolder(root);
  fs.writeFileSync(contextPath(root), text.slice(0, MAX_LEN), "utf-8");
}

/** Wrap the context as a system-prompt block, or null when empty. */
export function renderContextForPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    "--- Project context (instructions the user wrote for this workspace — follow them) ---\n" +
    trimmed.slice(0, MAX_LEN)
  );
}
