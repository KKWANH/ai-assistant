/**
 * Grounding gather (MW5) — one place that assembles the source text a
 * deliverable is grounded in, so deck / exam / document routes don't each
 * re-implement it.
 *
 * By default it retrieves only from the primary workspace (week-scoped when a
 * week is given) — the per-workspace isolation that's the default everywhere.
 * The opt-in part is `sourceIds`: other workspaces the lecturer deliberately
 * pulls from (e.g. last year's version of the course, or a sibling subject).
 * Each pull is access-checked with the SAME read gate as the rest of the API —
 * a source the account can't view is silently skipped, never leaked — and is
 * labeled in the prompt so the model can tell the courses apart. Transfer is a
 * deliberate pull, never automatic; with no sourceIds this is exactly the old
 * single-workspace behavior.
 */
import type { Account, Workspace } from "@ariadne/shared";
import { retrieveRelevantChunks, formatChunksForPrompt } from "@ariadne/server/src/services/retrieval.js";
import { dbGetLatestSnapshot, dbGetWorkspace } from "@ariadne/server/src/db/repo.js";
import { canViewWorkspace } from "@ariadne/server/src/routes/workspaceGuard.js";

/** Retrieve + format the top chunks of one workspace for `query`, week-scoped
 *  when given. Returns "" when the workspace has no indexed snapshot. */
async function retrieveForWorkspace(
  ws: Workspace,
  query: string,
  week: string | undefined,
  topK: number,
  limit: number,
): Promise<string> {
  const snapshot = dbGetLatestSnapshot(ws.id);
  if (!snapshot || snapshot.files.length === 0) return "";
  try {
    const chunks = await retrieveRelevantChunks(ws.rootPath, snapshot.files, query, {
      workspaceId: ws.id,
      topK,
    });
    const scoped = week ? chunks.filter((c) => c.path.startsWith(`${week.replace(/\/$/, "")}/`)) : chunks;
    return formatChunksForPrompt((scoped.length > 0 ? scoped : chunks).slice(0, limit));
  } catch {
    return "";
  }
}

export async function gatherGrounding(opts: {
  workspace: Workspace;
  /** Retrieval query — typically the course · week scope label. */
  scope: string;
  /** When set, prefer this week's own materials in the primary workspace. */
  week?: string;
  /** Opt-in: other workspace ids to also pull from (access-checked per source). */
  sourceIds?: string[];
  /** The requesting account — gates every cross-workspace pull. */
  account: Account;
  /** Chunks kept from the primary workspace (defaults by week presence). */
  limit?: number;
}): Promise<string> {
  const { workspace, scope, week, sourceIds, account, limit = 10 } = opts;
  const blocks: string[] = [];

  const primary = await retrieveForWorkspace(workspace, scope, week, week ? 25 : 12, limit);
  if (primary) blocks.push(primary);

  // De-duped, self-excluded, access-checked pulls. Each contributes a smaller
  // slice than the primary so an opted-in course informs without drowning it.
  const seen = new Set<string>([workspace.id]);
  for (const id of sourceIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const source = dbGetWorkspace(id);
    if (!source || !canViewWorkspace(source, account)) continue; // silently skip inaccessible
    const block = await retrieveForWorkspace(source, scope, undefined, 8, 6);
    if (block) blocks.push(`[다른 과목 자료 — ${source.name}]\n${block}`);
  }

  return blocks.join("\n\n");
}
