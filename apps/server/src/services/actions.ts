/**
 * Action service — load and validate .ariadne/actions.yaml into WorkspaceAction[].
 *
 * Tolerates a missing file (returns empty array + no error) and an invalid/corrupt
 * file (returns empty array + error message).
 */

import yaml from "yaml";
import type {
  WorkspaceAction,
  ActionType,
  ActionDef,
  ActionBlock,
  BlockType,
} from "@ariadne/shared";
import { readActionsYaml } from "../ariadneFolder.js";
import logger from "../logger.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ActionsLoadResult {
  source: string | null;
  actions: WorkspaceAction[];
  error: string | null;
}

const VALID_TYPES: Set<ActionType> = new Set(["run_script", "read_file", "web_search", "format"]);

export function loadWorkspaceActions(workspaceRoot: string): ActionsLoadResult {
  let source: string | null = null;
  try {
    source = readActionsYaml(workspaceRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ workspaceRoot, err: msg }, "Failed to read actions.yaml");
    return { source: null, actions: [], error: `Failed to read actions.yaml: ${msg}` };
  }

  if (source === null) {
    return { source: null, actions: [], error: null };
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source, actions: [], error: `actions.yaml parse error: ${msg}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { source, actions: [], error: "actions.yaml must be a YAML mapping" };
  }

  const raw = (parsed as Record<string, unknown>)["actions"];
  if (!Array.isArray(raw)) {
    return { source, actions: [], error: "actions.yaml must have a top-level 'actions' list" };
  }

  const actions: WorkspaceAction[] = [];
  const errors: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") {
      errors.push(`actions[${i.toString()}]: not an object`);
      continue;
    }

    const id = item["id"];
    const name = item["name"];
    const type = item["type"];
    const description = item["description"];

    if (typeof id !== "string" || !id.trim()) {
      errors.push(`actions[${i.toString()}]: missing 'id'`);
      continue;
    }
    if (typeof name !== "string" || !name.trim()) {
      errors.push(`actions[${i.toString()}] (id=${id}): missing 'name'`);
      continue;
    }
    if (typeof type !== "string" || !VALID_TYPES.has(type as ActionType)) {
      errors.push(`actions[${i.toString()}] (id=${id}): invalid 'type' (must be run_script|read_file|web_search|format)`);
      continue;
    }
    if (typeof description !== "string") {
      errors.push(`actions[${i.toString()}] (id=${id}): missing 'description'`);
      continue;
    }

    const action: WorkspaceAction = {
      id: id.trim(),
      name: name.trim(),
      description: description.trim(),
      type: type as ActionType,
    };

    if (typeof item["script"] === "string") action.script = item["script"];
    if (typeof item["path"] === "string") action.path = item["path"];
    if (typeof item["query"] === "string") action.query = item["query"];
    if (typeof item["template"] === "string") action.template = item["template"];
    if (typeof item["constraints"] === "string") action.constraints = item["constraints"];

    actions.push(action);
  }

  const error = errors.length > 0 ? errors.join("; ") : null;
  return { source, actions, error };
}

// ---------------------------------------------------------------------------
// Block-pipeline actions (the runnable form — distinct from the flat
// WorkspaceAction[] above, which the agent planner still consumes).
// ---------------------------------------------------------------------------

export interface ActionDefsLoadResult {
  actions: ActionDef[];
  error: string | null;
}

const BLOCK_TYPES: Set<BlockType> = new Set([
  "ask_ai",
  "web_analysis",
  "run_script",
  "read_file",
  "write_file",
  "edit_file",
  "run_tests",
]);

/** Synthesize a single block from an old flat action so it stays runnable. */
function flatActionToBlock(type: ActionType, item: Record<string, unknown>): ActionBlock {
  const str = (k: string): string => (typeof item[k] === "string" ? (item[k] as string) : "");
  switch (type) {
    case "run_script":
      return { id: "blk-1", type: "run_script", config: { script: str("script") } };
    case "read_file":
      return { id: "blk-1", type: "read_file", config: { path: str("path") } };
    case "web_search":
      return { id: "blk-1", type: "web_analysis", config: { query: str("query") } };
    case "format":
      return { id: "blk-1", type: "ask_ai", config: { prompt: str("template") } };
  }
}

/**
 * Load actions.yaml as block-pipeline ActionDefs. A new-form action carries a
 * `blocks:` list; an old flat action is synthesized into a single-block
 * pipeline. Tolerates a missing or corrupt file (returns an empty list).
 */
export function loadActionDefs(workspaceRoot: string): ActionDefsLoadResult {
  let source: string | null;
  try {
    source = readActionsYaml(workspaceRoot);
  } catch {
    return { actions: [], error: null };
  }
  if (source === null) return { actions: [], error: null };

  let parsed: unknown;
  try {
    parsed = yaml.parse(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { actions: [], error: `actions.yaml parse error: ${msg}` };
  }

  const raw =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["actions"]
      : null;
  if (!Array.isArray(raw)) return { actions: [], error: null };

  const actions: ActionDef[] = [];
  const errors: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") continue;

    const id = typeof item["id"] === "string" ? item["id"].trim() : "";
    const name = typeof item["name"] === "string" ? item["name"].trim() : "";
    if (!id || !name) {
      errors.push(`actions[${i.toString()}]: missing 'id' or 'name'`);
      continue;
    }
    const description =
      typeof item["description"] === "string" ? item["description"].trim() : "";
    const category = typeof item["category"] === "string" ? item["category"].trim() : "";

    let blocks: ActionBlock[] = [];
    if (Array.isArray(item["blocks"])) {
      const rawBlocks = item["blocks"] as unknown[];
      for (let b = 0; b < rawBlocks.length; b++) {
        const bi = rawBlocks[b] as Record<string, unknown> | undefined;
        if (!bi || typeof bi !== "object") continue;
        const bt = bi["type"];
        if (typeof bt !== "string" || !BLOCK_TYPES.has(bt as BlockType)) {
          errors.push(`actions[${i.toString()}] (${id}) block[${b.toString()}]: invalid 'type'`);
          continue;
        }
        const cfg: Record<string, string> = {};
        const rawCfg = bi["config"];
        if (rawCfg && typeof rawCfg === "object") {
          for (const [k, v] of Object.entries(rawCfg as Record<string, unknown>)) {
            if (typeof v === "string") cfg[k] = v;
          }
        }
        const bid =
          typeof bi["id"] === "string" && bi["id"].trim()
            ? bi["id"].trim()
            : `blk-${(b + 1).toString()}`;
        blocks.push({ id: bid, type: bt as BlockType, config: cfg });
      }
    } else if (
      typeof item["type"] === "string" &&
      VALID_TYPES.has(item["type"] as ActionType)
    ) {
      blocks = [flatActionToBlock(item["type"] as ActionType, item)];
    } else {
      errors.push(`actions[${i.toString()}] (${id}): no 'blocks' and no valid 'type'`);
      continue;
    }

    actions.push({ id, name, description, category, blocks });
  }

  return { actions, error: errors.length > 0 ? errors.join("; ") : null };
}
