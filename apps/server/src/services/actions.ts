/**
 * Action service — load and validate .ariadne/actions.yaml into WorkspaceAction[].
 *
 * Tolerates a missing file (returns empty array + no error) and an invalid/corrupt
 * file (returns empty array + error message).
 */

import yaml from "yaml";
import type { WorkspaceAction, ActionType } from "@ariadne/shared";
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
