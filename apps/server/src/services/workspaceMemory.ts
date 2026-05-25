/**
 * Workspace memory service.
 *
 * Reads, writes, and renders the per-workspace memory file at
 * `<workspaceRoot>/.ariadne/memory.yaml`. The file is the durable
 * source of truth — the route layer is thin and just delegates.
 *
 * Schema on disk (human-edited friendly):
 *
 *   # Workspace memory — facts the AI knows about this workspace.
 *   # Each entry was approved by the user via the "Save to memory"
 *   # modal. Edit the file directly to fix typos; the next read
 *   # picks up changes immediately.
 *   memories:
 *     - id: mem-<ts>-<rand>
 *       text: "This project uses `npm run typecheck` as the test command."
 *       addedAt: 2026-05-25T12:00:00Z
 *       addedBy: kwanhokim
 *       source: { kind: chat, ref: <messageId> }
 *
 * Memory is injected into the chat system prompt by chatContext.ts —
 * see `renderMemoryForPrompt()` for the exact wire format.
 */
import crypto from "node:crypto";
import yaml from "yaml";
import type { WorkspaceMemory } from "@ariadne/shared";
import { readMemoryYaml, writeMemoryYaml } from "../ariadneFolder.js";

interface MemoryFile {
  memories: WorkspaceMemory[];
}

function newMemoryId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(3).toString("hex");
  return `mem-${ts}-${rand}`;
}

/** Read every memory entry for a workspace. Missing file → empty list. */
export function listMemories(workspaceRoot: string): WorkspaceMemory[] {
  const raw = readMemoryYaml(workspaceRoot);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch {
    // Bad YAML shouldn't crash chat — the file is human-editable and a
    // syntax error is recoverable. Return empty; the panel will show
    // the raw error separately when we add a "view source" view.
    return [];
  }
  const memories = (parsed as MemoryFile | null)?.memories;
  if (!Array.isArray(memories)) return [];
  return memories.filter(
    (m): m is WorkspaceMemory =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as WorkspaceMemory).id === "string" &&
      typeof (m as WorkspaceMemory).text === "string",
  );
}

/** Append a new memory entry and persist. Returns the persisted row. */
export function addMemory(
  workspaceRoot: string,
  input: {
    text: string;
    addedBy: string | null;
    source?: WorkspaceMemory["source"];
  },
): WorkspaceMemory {
  const existing = listMemories(workspaceRoot);
  const entry: WorkspaceMemory = {
    id: newMemoryId(),
    text: input.text.trim(),
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy,
    ...(input.source ? { source: input.source } : {}),
  };
  const next = [...existing, entry];
  writeMemoryYaml(workspaceRoot, serialise(next));
  return entry;
}

/** Remove one memory by id. Returns true if a row was deleted. */
export function deleteMemory(workspaceRoot: string, memoryId: string): boolean {
  const existing = listMemories(workspaceRoot);
  const next = existing.filter((m) => m.id !== memoryId);
  if (next.length === existing.length) return false;
  writeMemoryYaml(workspaceRoot, serialise(next));
  return true;
}

function serialise(memories: WorkspaceMemory[]): string {
  const header =
    "# Workspace memory — facts the AI knows about this workspace.\n" +
    "# Each entry was approved by the user via the \"Save to memory\" modal.\n" +
    "# Edit by hand or via the Memory tab in the workspace view.\n" +
    "\n";
  if (memories.length === 0) {
    return header + "memories: []\n";
  }
  return header + yaml.stringify({ memories });
}

/**
 * Render the memory list as a markdown block ready to splice into a
 * system prompt. Returns null when there is no memory — the caller
 * skips the block entirely so an empty workspace isn't padded with
 * noise.
 *
 * The wire format is intentionally compact: one bullet per memory,
 * source omitted (the AI doesn't need to know which message a fact
 * came from to use it). Cap at 60 entries / ~6 kB to prevent runaway
 * prompts even on a heavily-memoried workspace.
 */
export function renderMemoryForPrompt(memories: WorkspaceMemory[]): string | null {
  if (memories.length === 0) return null;
  const capped = memories.slice(0, 60);
  let text = "";
  let chars = 0;
  const bullets: string[] = [];
  for (const m of capped) {
    const bullet = `- ${m.text}`;
    if (chars + bullet.length > 6000) break;
    chars += bullet.length;
    bullets.push(bullet);
    text += bullet + "\n";
  }
  if (bullets.length === 0) return null;
  const moreNote =
    memories.length > bullets.length
      ? `\n(+${(memories.length - bullets.length).toString()} more memories truncated for context budget.)`
      : "";
  return (
    "--- Workspace memory (facts the user has confirmed about this workspace) ---\n" +
    "Treat these as authoritative; prefer them when they conflict with general knowledge.\n" +
    text +
    moreNote
  );
}
