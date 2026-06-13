/**
 * repoGit — read + commit the workspace's OWN git repo (at its rootPath), as
 * opposed to workspaceGit.ts which versions Ariadne's `.ariadne/` output. Powers
 * the in-app Git panel (P3 IDE): status, per-file diff, and selective commit.
 *
 * Safety posture:
 *   - No-op (isRepo:false) when git is missing or rootPath isn't a repo. We
 *     never `git init` the user's folder — that's their call.
 *   - Read + local commit only. No remotes: no push / pull / fetch.
 *   - Every client-supplied path is validated to stay inside the repo before
 *     it reaches git (defence in depth on top of git's own work-tree guard).
 */
import path from "node:path";
import fs from "node:fs";
import { runGit, isGitAvailable } from "./workspaceGit.js";

export type GitFileKind =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "conflicted";

export interface GitFileStatus {
  path: string;
  kind: GitFileKind;
  /** Has staged (index) changes. */
  staged: boolean;
  /** Has unstaged (working-tree) changes. */
  unstaged: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

function isRepo(rootPath: string): boolean {
  return fs.existsSync(path.join(rootPath, ".git"));
}

/** Resolve a repo-relative path through symlinks and confirm it still lands
 *  inside the repo root. Guards `git diff --no-index`, which (unlike git's
 *  tracked-diff paths) will happily follow a symlinked subdir out of the repo. */
function resolvesInsideRepo(rootPath: string, relPath: string): boolean {
  try {
    const real = fs.realpathSync(path.join(rootPath, relPath));
    const realRoot = fs.realpathSync(rootPath);
    return real === realRoot || real.startsWith(realRoot + path.sep);
  } catch {
    return false; // missing / unresolvable → don't read it
  }
}

/** A relative path that stays inside the repo — no absolute, no `..` escape,
 *  never flag-shaped (the `--` separators already neutralize flags; this is
 *  defence in depth). */
function isSafeRelPath(p: string): boolean {
  if (!p || path.isAbsolute(p)) return false;
  if (p.trimStart().startsWith("-")) return false;
  return !p.split(/[\\/]/).includes("..");
}

function classify(x: string, y: string): GitFileKind {
  if (x === "?" && y === "?") return "untracked";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflicted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

export async function gitStatus(rootPath: string): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
  if (!(await isGitAvailable()) || !isRepo(rootPath)) return empty;

  // `-z` → NUL-separated records with UNquoted paths (the default --porcelain
  // C-quotes paths with spaces/unicode, which then don't round-trip to git/diff).
  const res = await runGit(rootPath, ["status", "--porcelain", "-z", "--branch"], { ignoreFailure: true });
  if (!res.ok) return { ...empty, isRepo: true };

  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileStatus[] = [];

  const parts = res.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith("## ")) {
      // "## main...origin/main [ahead 1, behind 2]" | "## main" | "## HEAD (no branch)"
      const info = rec.slice(3);
      const head = info.split("...")[0]?.split(" ")[0] ?? null;
      branch = head && head !== "HEAD" ? head : null;
      const am = info.match(/ahead (\d+)/);
      const bm = info.match(/behind (\d+)/);
      if (am?.[1]) ahead = parseInt(am[1], 10);
      if (bm?.[1]) behind = parseInt(bm[1], 10);
      continue;
    }
    // "XY <path>"; a rename/copy record is followed by a separate NUL field
    // holding the OLD path — consume it, we report the new path in the record.
    const x = rec[0] ?? " ";
    const y = rec[1] ?? " ";
    const p = rec.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") i++;
    files.push({
      path: p,
      kind: classify(x, y),
      staged: x !== " " && x !== "?",
      unstaged: y !== " ",
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { isRepo: true, branch, ahead, behind, files };
}

const DIFF_CAP = 80_000;

/** Unified diff for one path. `staged` → index vs HEAD; else working tree vs
 *  HEAD. Untracked files are shown as an all-additions diff vs /dev/null. */
export async function gitDiff(
  rootPath: string,
  filePath: string,
  staged: boolean,
): Promise<string | null> {
  if (!(await isGitAvailable()) || !isRepo(rootPath)) return null;
  if (!isSafeRelPath(filePath)) return null;

  const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
  const res = await runGit(rootPath, args, { ignoreFailure: true });
  let out = res.stdout;
  // Untracked / nothing-tracked → synthesize an add-diff against /dev/null.
  // Only after confirming the file really sits inside the repo (see
  // resolvesInsideRepo) — `--no-index` would otherwise follow a symlinked
  // subdir and leak a file from outside the workspace.
  if (!out.trim() && resolvesInsideRepo(rootPath, filePath)) {
    const ni = await runGit(rootPath, ["diff", "--no-index", "--", "/dev/null", filePath], {
      ignoreFailure: true,
    });
    out = ni.stdout;
  }
  if (!out) return "";
  return out.length > DIFF_CAP ? out.slice(0, DIFF_CAP) + "\n[…truncated]" : out;
}

export interface CommitResult {
  ok: boolean;
  sha?: string;
  error?: string;
}

/** Stage the given paths and commit. Refuses an empty message or empty path
 *  set. Uses the repo's own identity (the user's git config). */
export async function gitCommit(
  rootPath: string,
  message: string,
  paths: string[],
): Promise<CommitResult> {
  if (!(await isGitAvailable()) || !isRepo(rootPath)) return { ok: false, error: "Not a git repository" };
  if (!message.trim()) return { ok: false, error: "Commit message is required" };
  const safe = paths.filter(isSafeRelPath);
  if (safe.length === 0) return { ok: false, error: "Select at least one valid file to commit" };

  // Stage exactly the selected paths (-A on the pathspec captures deletes too).
  // The `--` guards against any path that looks like a flag.
  const add = await runGit(rootPath, ["add", "-A", "--", ...safe], { ignoreFailure: true });
  if (!add.ok) return { ok: false, error: add.stderr.trim() || "git add failed" };

  // Scope the commit to exactly the selected paths (a pathspec commit), so a
  // file someone staged outside the panel isn't swept into this commit.
  const commit = await runGit(rootPath, ["commit", "-m", message, "--", ...safe], { ignoreFailure: true });
  if (!commit.ok) {
    const err = (commit.stderr || commit.stdout).trim();
    return { ok: false, error: err || "git commit failed" };
  }
  const sha = await runGit(rootPath, ["rev-parse", "HEAD"], { ignoreFailure: true });
  return { ok: true, sha: sha.ok ? sha.stdout.trim() : undefined };
}
