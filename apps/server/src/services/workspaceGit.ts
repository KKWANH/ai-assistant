/**
 * Workspace git history — auto-versions each run's artifacts.
 *
 * Every workspace has its own `.ariadne/` folder; we initialise it as
 * an isolated git repo (separate from the workspace's main repo if any)
 * and commit a snapshot every time a run finishes. The user can then
 * see how briefs / evidence / artifacts evolved over time, diff between
 * runs, and recover an old version of a brief that a re-run replaced.
 *
 * Uses the host's `git` via child_process — no new dependency. If `git`
 * isn't installed the whole subsystem becomes a quiet no-op (logged
 * once at startup, never blocks a run).
 *
 * Scope intentionally tiny in v1:
 *   - one repo per workspace, rooted at `<workspaceRoot>/.ariadne/`
 *   - auto-commit on run completion, message = "run: <runId> (<status>)"
 *   - `dbGitLog(workspaceRoot, limit)` returns recent commits for the UI
 *   - no branches, no remotes, no force-push, no GC tuning
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "../logger.js";

const GIT_TIMEOUT_MS = 10_000;
let gitAvailable: boolean | null = null;

async function runGit(
  cwd: string,
  args: string[],
  opts: { ignoreFailure?: boolean } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      // Don't let a user's global hooks block us — runs would hang.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), GIT_TIMEOUT_MS);
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      if (!ok && !opts.ignoreFailure) {
        logger.debug({ cwd, args, stderr: stderr.slice(0, 200), code }, "git command failed");
      }
      resolve({ ok, stdout, stderr, code: code ?? -1 });
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", stderr: "git not available", code: -1 });
    });
  });
}

/** Check the host actually has git. Cached for the process lifetime. */
async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  const res = await runGit(process.cwd(), ["--version"], { ignoreFailure: true });
  gitAvailable = res.ok;
  if (!gitAvailable) {
    logger.info("git not available — workspace history feature disabled");
  }
  return gitAvailable;
}

function ariadneDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".ariadne");
}

/**
 * Initialise `.ariadne/` as its own git repo if it isn't one yet. Safe to
 * call repeatedly (e.g. on every run). No-op when git isn't installed.
 */
export async function ensureWorkspaceRepo(workspaceRoot: string): Promise<void> {
  if (!(await isGitAvailable())) return;
  const dir = ariadneDir(workspaceRoot);
  if (!fs.existsSync(dir)) return;     // .ariadne not yet created — caller should ensureAriadneFolder first.
  if (fs.existsSync(path.join(dir, ".git"))) return; // already a repo.

  // The dot-prefix is important — without it, a `git init` inside the
  // workspace root might attach to the parent project's repo. We pass
  // the absolute path explicitly.
  const init = await runGit(dir, ["init", "--initial-branch=main", "--quiet"]);
  if (!init.ok) {
    logger.warn({ dir, stderr: init.stderr.slice(0, 200) }, "git init failed");
    return;
  }
  // Local identity — keeps `git commit` working without depending on a
  // global config. Doesn't push anywhere.
  await runGit(dir, ["config", "user.email", "ariadne@local"]);
  await runGit(dir, ["config", "user.name", "Ariadne"]);
}

/**
 * Stage everything in `.ariadne/` and commit. Returns the new SHA or
 * null if there was nothing to commit (clean working tree).
 */
export async function commitWorkspaceHistory(
  workspaceRoot: string,
  message: string,
): Promise<string | null> {
  if (!(await isGitAvailable())) return null;
  const dir = ariadneDir(workspaceRoot);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    // First-time path — initialise before the first commit attempt.
    await ensureWorkspaceRepo(workspaceRoot);
    if (!fs.existsSync(path.join(dir, ".git"))) return null;
  }

  // `git add -A` over the .ariadne/ folder itself. We don't add the
  // workspace data files — those stay on the user's own VCS if they
  // have one. This repo strictly versions Ariadne's own output.
  const add = await runGit(dir, ["add", "-A"]);
  if (!add.ok) {
    logger.warn({ dir, stderr: add.stderr.slice(0, 200) }, "git add failed");
    return null;
  }
  // Skip the commit when nothing changed — keeps the log clean. We
  // detect this with --cached --quiet (exit 1 == changes staged).
  const diffCheck = await runGit(dir, ["diff", "--cached", "--quiet"], { ignoreFailure: true });
  if (diffCheck.code === 0) return null;

  const commit = await runGit(dir, [
    "commit", "-m", message,
    "--no-verify",   // don't trigger user-side hooks
    "--quiet",
  ]);
  if (!commit.ok) {
    logger.warn({ dir, stderr: commit.stderr.slice(0, 200) }, "git commit failed");
    return null;
  }
  const sha = await runGit(dir, ["rev-parse", "HEAD"]);
  return sha.ok ? sha.stdout.trim() : null;
}

export interface WorkspaceCommit {
  sha: string;
  shortSha: string;
  message: string;
  timestamp: string;
  filesChanged: number;
}

/**
 * List recent commits in the workspace's `.ariadne/` history. Limit is
 * capped at 200; this is for a UI list, not a forensic export.
 */
export async function listWorkspaceHistory(
  workspaceRoot: string,
  limit = 50,
): Promise<WorkspaceCommit[]> {
  if (!(await isGitAvailable())) return [];
  const dir = ariadneDir(workspaceRoot);
  if (!fs.existsSync(path.join(dir, ".git"))) return [];

  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  // Tab-separated to make parsing trivial; the commit message is on
  // the last column so embedded delimiters don't break the parser.
  const log = await runGit(
    dir,
    [
      "log",
      `-n${safeLimit.toString()}`,
      "--pretty=format:%H%x09%h%x09%aI%x09%s",
    ],
    { ignoreFailure: true },
  );
  if (!log.ok || !log.stdout.trim()) return [];

  const commits: WorkspaceCommit[] = [];
  for (const line of log.stdout.split("\n")) {
    const [sha, shortSha, timestamp, ...rest] = line.split("\t");
    if (!sha || !shortSha || !timestamp) continue;
    const message = rest.join("\t");
    // File-count per commit — one extra `git show --stat` per commit
    // would be slow on long lists; pull diffshortstat lazily by passing
    // a separate command in a single batch.
    commits.push({ sha, shortSha, message, timestamp, filesChanged: 0 });
  }

  // Filled in lazily — one batched `git log --shortstat` call:
  const stat = await runGit(
    dir,
    [
      "log",
      `-n${safeLimit.toString()}`,
      "--pretty=format:%H",
      "--shortstat",
    ],
    { ignoreFailure: true },
  );
  if (stat.ok) {
    const lines = stat.stdout.split("\n");
    const fileCounts = new Map<string, number>();
    let pendingSha: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^[a-f0-9]{40}$/.test(trimmed)) {
        pendingSha = trimmed;
        continue;
      }
      // " 3 files changed, 12 insertions(+), 4 deletions(-)"
      const m = trimmed.match(/^(\d+)\s+files? changed/);
      if (m && pendingSha && m[1]) {
        fileCounts.set(pendingSha, parseInt(m[1], 10));
        pendingSha = null;
      }
    }
    for (const c of commits) {
      c.filesChanged = fileCounts.get(c.sha) ?? 0;
    }
  }

  return commits;
}

export interface CommitFileChange {
  path: string;
  /** create / modify / replace / delete — same shape as the staged
   *  manifest so the UI can render both with one component. */
  action: "create" | "modify" | "replace" | "delete";
  /** File body at parent commit; null for newly-created files. */
  before: string | null;
  /** File body at this commit; null for deletions. */
  after: string | null;
  /** Best-effort unified diff string for the file. UI ignores it; we
   *  keep it on the wire for future LLM-readable exports. */
  diff: string;
}

export interface CommitDetail {
  sha: string;
  shortSha: string;
  message: string;
  timestamp: string;
  files: CommitFileChange[];
}

const FILE_BODY_CAP = 32_000;

/**
 * Read a file's body at a given revision. Returns null when the file
 * doesn't exist at that revision (root commit's parent, or a delete).
 */
async function showFileAtRev(
  dir: string,
  rev: string,
  filePath: string,
): Promise<string | null> {
  const res = await runGit(dir, ["show", `${rev}:${filePath}`], { ignoreFailure: true });
  if (!res.ok) return null;
  return res.stdout.length > FILE_BODY_CAP
    ? res.stdout.slice(0, FILE_BODY_CAP) + "\n[…truncated]"
    : res.stdout;
}

/**
 * Detailed view of one commit: changed paths + each file's body at
 * the parent commit and at this commit. Front-end reuses the same
 * side-by-side renderer it draws staged manifests with.
 */
export async function getCommitDetail(
  workspaceRoot: string,
  sha: string,
): Promise<CommitDetail | null> {
  if (!(await isGitAvailable())) return null;
  const dir = ariadneDir(workspaceRoot);
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  // Refuse anything that's not a hex sha so we never pass user input
  // to git as a rev (route also validates — defence in depth).
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) return null;

  const head = await runGit(
    dir,
    ["show", "--no-patch", "--pretty=format:%H%x09%h%x09%aI%x09%s", sha],
    { ignoreFailure: true },
  );
  if (!head.ok || !head.stdout.trim()) return null;
  const [fullSha, shortSha, timestamp, ...rest] = head.stdout.trim().split("\t");
  if (!fullSha || !shortSha || !timestamp) return null;
  const message = rest.join("\t");

  // Is there a parent? Root commit has none.
  const parent = await runGit(dir, ["rev-parse", `${sha}^`], { ignoreFailure: true });
  const hasParent = parent.ok && parent.stdout.trim().length > 0;
  const parentRev = hasParent ? parent.stdout.trim() : null;

  // Changed-file list with status letters.
  const nsCmd = hasParent
    ? ["diff", "--name-status", `${parentRev!}..${sha}`]
    : ["show", "--no-patch", "--name-status", "--pretty=format:", sha];
  const ns = await runGit(dir, nsCmd, { ignoreFailure: true });
  if (!ns.ok) return { sha: fullSha, shortSha, message, timestamp, files: [] };

  const files: CommitFileChange[] = [];
  for (const line of ns.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const status = parts[0] ?? "";
    const filePath = parts[parts.length - 1];
    if (!filePath) continue;

    let action: CommitFileChange["action"];
    if (status.startsWith("A")) action = "create";
    else if (status.startsWith("D")) action = "delete";
    else if (status.startsWith("R")) action = "modify";
    else action = "modify"; // M, T, anything else → treat as modify

    const before = parentRev && action !== "create"
      ? await showFileAtRev(dir, parentRev, filePath)
      : null;
    const after = action !== "delete"
      ? await showFileAtRev(dir, sha, filePath)
      : null;

    const diff = await runGit(
      dir,
      ["show", "--format=", "--unified=3", sha, "--", filePath],
      { ignoreFailure: true },
    );
    files.push({
      path: filePath,
      action,
      before,
      after,
      diff: diff.ok
        ? (diff.stdout.length > 8_000 ? diff.stdout.slice(0, 8_000) + "\n[…truncated]" : diff.stdout)
        : "",
    });
  }

  return { sha: fullSha, shortSha, message, timestamp, files };
}
