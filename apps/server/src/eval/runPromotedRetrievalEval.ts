/**
 * runPromotedRetrievalEval — read every user-promoted retrieval case
 * (the ones users created by clicking 👎 on a chat reply or search
 * result) and run it against the *real* workspace folder that originated
 * it. Reports use the same metrics as the fixture-based runner.
 *
 * Layout it reads:
 *   apps/server/src/eval/cases/user-promoted/
 *     <workspaceId>/
 *       workspace.yaml          { workspaceId, workspaceName, workspaceRoot }
 *       <ts>-<hash>.yaml        single retrieval case
 *
 * The workspaceRoot is captured at promotion time. If the user moves the
 * folder after promoting, that workspace is skipped with a warning — the
 * cases stay on disk and become runnable again if the path is restored.
 *
 * Usage:
 *   npm run eval:retrieval:promoted
 *   npm run eval:retrieval:promoted -- --workspaces=<id1>,<id2>
 *   npm run eval:retrieval:promoted -- --topK=10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { FileMeta } from "@ariadne/shared";
import { buildFileMeta } from "../workspace/metadata.js";
import { retrieveWithMeta } from "../services/retrieval.js";
import {
  listPromotedWorkspaceIds,
  loadPromotedCases,
  readPromotedWorkspaceMeta,
  type RetrievalCase,
} from "./cases.js";
import { evaluateCase, aggregate, type CaseMetrics } from "./metrics.js";
import { writeReports } from "./reporters/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  workspaces?: string[];
  topK: number;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  let workspaces: string[] | undefined;
  let topK = 10;
  let outDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "data",
    "evals",
    "promoted-" + new Date().toISOString().replace(/[:.]/g, "-"),
  );
  for (const arg of argv) {
    if (arg.startsWith("--workspaces=")) {
      workspaces = arg.slice("--workspaces=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--topK=")) {
      topK = parseInt(arg.slice("--topK=".length), 10) || topK;
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    }
  }
  return { workspaces, topK, outDir };
}

/** Walk a real workspace root and build FileMeta[]. Mirrors the fixture
 *  walker — same simple excludes. The production scanner has stricter
 *  filters (sensitive patterns, size cap); for promoted cases we accept
 *  the looser path because the case was created against the production
 *  search results, so reproducing those exclusions adds noise without
 *  changing the harness signal materially. */
async function scanWorkspace(root: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  const promises: Promise<void>[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === ".ariadne" ||
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === ".next" ||
          entry.name === "dist" ||
          entry.name === "build"
        ) {
          continue;
        }
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        promises.push(
          buildFileMeta(abs, rel)
            .then((m) => {
              out.push(m);
            })
            .catch(() => {
              /* unreadable file — skip */
            }),
        );
      }
    }
  }
  walk(root);
  await Promise.all(promises);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function runOne(
  c: RetrievalCase,
  root: string,
  files: FileMeta[],
  topK: number,
): Promise<CaseMetrics> {
  const t0 = performance.now();
  const result = await retrieveWithMeta(root, files, c.query, { topK });
  const latency = performance.now() - t0;
  return evaluateCase(c, result.chunks, latency, result.strategy);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allWorkspaceIds = listPromotedWorkspaceIds();
  if (allWorkspaceIds.length === 0) {
    console.log(
      "No promoted cases yet. Click 👎 on a chat reply or search result to create one.",
    );
    process.exit(0);
  }
  const workspaceIds = args.workspaces
    ? allWorkspaceIds.filter((w) => args.workspaces!.includes(w))
    : allWorkspaceIds;

  const rows: CaseMetrics[] = [];
  let totalCases = 0;
  let skippedWorkspaces = 0;

  for (const wsId of workspaceIds) {
    const meta = readPromotedWorkspaceMeta(wsId);
    if (!meta) {
      console.warn(`⚠  ${wsId}: workspace.yaml missing or invalid, skipping`);
      skippedWorkspaces += 1;
      continue;
    }
    if (!fs.existsSync(meta.workspaceRoot)) {
      console.warn(
        `⚠  ${meta.workspaceName} (${wsId}): root ${meta.workspaceRoot} no longer exists, skipping`,
      );
      skippedWorkspaces += 1;
      continue;
    }
    const cases = loadPromotedCases(wsId);
    if (cases.length === 0) continue;
    totalCases += cases.length;

    console.log(`\n— ${meta.workspaceName} (${cases.length.toString()} cases) —`);
    const files = await scanWorkspace(meta.workspaceRoot);

    for (const c of cases) {
      const row = await runOne(c, meta.workspaceRoot, files, args.topK);
      rows.push(row);
      const pass = row.hitAt6 && row.distractorLeaks.length === 0;
      const tag = pass ? "✓" : "✗";
      const leak = row.distractorLeaks.length > 0 ? ` LEAK[${row.distractorLeaks.join(",")}]` : "";
      console.log(
        `${tag} ${c.id.padEnd(48)} hit@6=${row.hitAt6 ? "y" : "n"} rr=${row.reciprocalRank.toFixed(2)} ${row.latencyMs.toFixed(1)}ms ${row.strategy}${leak}`,
      );
    }
  }

  if (rows.length === 0) {
    console.log(
      `\nNo runnable promoted cases (skipped ${skippedWorkspaces.toString()} workspace${skippedWorkspaces === 1 ? "" : "s"}).`,
    );
    process.exit(0);
  }

  const agg = aggregate(rows);
  console.log("\n— Aggregate (promoted cases) —");
  console.log(`Cases: ${agg.cases.toString()}  (across ${(workspaceIds.length - skippedWorkspaces).toString()} workspace${(workspaceIds.length - skippedWorkspaces) === 1 ? "" : "s"})`);
  console.log(`Hit@1: ${(agg.hits.at1 * 100).toFixed(1)}%  Hit@3: ${(agg.hits.at3 * 100).toFixed(1)}%  Hit@6: ${(agg.hits.at6 * 100).toFixed(1)}%`);
  console.log(`MRR: ${agg.mrr.toFixed(3)}  nDCG@6: ${agg.meanNdcgAt6.toFixed(3)}`);
  console.log(`Distractor leak rate: ${(agg.distractorLeakRate * 100).toFixed(1)}%`);
  console.log(`Latency: mean ${agg.meanLatencyMs.toFixed(1)} ms  p50 ${agg.p50LatencyMs.toFixed(1)} ms  p95 ${agg.p95LatencyMs.toFixed(1)} ms`);

  writeReports(args.outDir, {
    agg,
    rows,
    context: {
      topK: args.topK,
      mode: "promoted (real workspace roots)",
      casesPath: "apps/server/src/eval/cases/user-promoted/",
      indexedCoverage: 1, // we walk the whole root; no separate eligibility filter here
      totalFiles: totalCases,
      totalCandidates: totalCases,
    },
  });
  console.log(`\nReport written to: ${args.outDir}`);

  // Non-zero exit if anything failed — the whole point of promoted cases
  // is to catch regressions, so a failure here is a real signal.
  const failures = rows.filter((r) => !r.hitAt6 || r.distractorLeaks.length > 0).length;
  if (failures > 0) {
    console.error(
      `\n✗ ${failures.toString()} promoted case${failures === 1 ? "" : "s"} failed.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
