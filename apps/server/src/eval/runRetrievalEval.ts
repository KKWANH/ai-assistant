/**
 * runRetrievalEval — read every case in `cases/retrieval.yaml`, run it
 * through `retrieveWithMeta` against the matching fixture workspace,
 * compute per-case + aggregate metrics, write a timestamped report
 * under `data/evals/`.
 *
 * Usage:
 *   npm run eval:retrieval
 *   npm run eval:retrieval -- --workspaces=code-small,korean-mixed
 *   npm run eval:retrieval -- --topK=10
 *
 * No server / no DB needed — works against the in-memory keyword path
 * (semantic path requires a workspaceId tied to chunk_embeddings, which
 * the fixtures don't populate; semantic eval comes in a later batch
 * with a `--use-db` mode that boots openDb against a scratch path).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { FileMeta } from "@ariadne/shared";
import { buildFileMeta } from "../workspace/metadata.js";
import { retrieveWithMeta } from "../services/retrieval.js";
import { loadRetrievalCases, fixturesRoot, type RetrievalCase } from "./cases.js";
import { evaluateCase, aggregate, type CaseMetrics } from "./metrics.js";
import { writeReports } from "./reporters/index.js";
import { loadGates, evaluateRetrievalGates, summariseVerdicts } from "./gates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  workspaces?: string[];
  topK: number;
  outDir: string;
  /** When set, after the aggregate prints, also evaluate gates.yaml
   *  thresholds and print PASS / FAIL per metric. Exit code is still
   *  0 (soft gates) — flip to `--strict` once the bar is stable. */
  ci: boolean;
  /** When set with `--ci`, exit 1 if any gate FAILs. */
  strict: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let workspaces: string[] | undefined;
  let topK = 10;
  let ci = false;
  let strict = false;
  let outDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "data",
    "evals",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );

  for (const arg of argv) {
    if (arg.startsWith("--workspaces=")) {
      workspaces = arg.slice("--workspaces=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--topK=")) {
      topK = parseInt(arg.slice("--topK=".length), 10) || topK;
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    } else if (arg === "--ci") {
      ci = true;
    } else if (arg === "--strict") {
      strict = true;
    }
  }

  return { workspaces, topK, outDir, ci, strict };
}

/** Walk a fixture folder and build a FileMeta[] using the production
 *  buildFileMeta — same shape the real scanner produces, minus the
 *  .ariadne writes. */
async function scanFixture(fixtureRoot: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".ariadne" || entry.name === ".git" || entry.name === "node_modules") continue;
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(fixtureRoot, abs).split(path.sep).join("/");
        // Don't await inside Array.forEach — defer with a promise list.
        // The `.then` body uses a block so the array.push return value
        // (the new length, a number) doesn't leak into Promise<number>.
        promises.push(
          buildFileMeta(abs, rel)
            .then((m) => { out.push(m); })
            .catch(() => { /* unreadable file — silently skip */ }),
        );
      }
    }
  }
  const promises: Promise<void>[] = [];
  walk(fixtureRoot);
  await Promise.all(promises);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = loadRetrievalCases();
  const filteredCases = args.workspaces
    ? cases.filter((c) => args.workspaces!.includes(c.workspace))
    : cases;

  if (filteredCases.length === 0) {
    console.log("No cases to run.");
    process.exit(0);
  }

  // Pre-scan each fixture exactly once — every case for that workspace
  // reuses the same FileMeta[] (the keyword path has no per-call state).
  const fixturesByName = new Map<string, { root: string; files: FileMeta[] }>();
  const workspaceNames = Array.from(new Set(filteredCases.map((c) => c.workspace)));
  for (const ws of workspaceNames) {
    const root = path.join(fixturesRoot(), ws);
    if (!fs.existsSync(root)) {
      console.error(`Missing fixture workspace: ${root}`);
      process.exit(1);
    }
    const files = await scanFixture(root);
    fixturesByName.set(ws, { root, files });
  }

  const rows: CaseMetrics[] = [];
  for (const c of filteredCases) {
    const fix = fixturesByName.get(c.workspace);
    if (!fix) continue;
    const row = await runOne(c, fix.root, fix.files, args.topK);
    rows.push(row);
    const pass = row.hitAt6 && row.distractorLeaks.length === 0;
    const tag = pass ? "✓" : "✗";
    const distractorNote = row.distractorLeaks.length > 0 ? ` LEAK[${row.distractorLeaks.join(",")}]` : "";
    console.log(
      `${tag} ${c.id.padEnd(34)} hit@6=${row.hitAt6 ? "y" : "n"} rr=${row.reciprocalRank.toFixed(2)} p@6=${(row.precisionAt6 * 100).toFixed(0)}% ${row.latencyMs.toFixed(1)}ms ${row.strategy}${distractorNote}`,
    );
  }

  const agg = aggregate(rows);
  console.log("\n— Aggregate —");
  console.log(`Cases: ${agg.cases.toString()}`);
  console.log(`Hit@1: ${(agg.hits.at1 * 100).toFixed(1)}%  Hit@3: ${(agg.hits.at3 * 100).toFixed(1)}%  Hit@6: ${(agg.hits.at6 * 100).toFixed(1)}%`);
  console.log(`MRR: ${agg.mrr.toFixed(3)}`);
  console.log(`Context P@6: ${(agg.meanContextPrecisionAt6 * 100).toFixed(1)}%  R@6: ${(agg.meanContextRecallAt6 * 100).toFixed(1)}%`);
  console.log(`Distractor leak rate: ${(agg.distractorLeakRate * 100).toFixed(1)}%`);
  console.log(`Latency: mean ${agg.meanLatencyMs.toFixed(1)} ms  p50 ${agg.p50LatencyMs.toFixed(1)} ms  p95 ${agg.p95LatencyMs.toFixed(1)} ms`);
  console.log("Strategies:", agg.byStrategy);

  writeReports(args.outDir, {
    agg,
    rows,
    context: {
      topK: args.topK,
      mode: "keyword-only (no DB)",
      casesPath: "apps/server/src/eval/cases/retrieval.yaml",
    },
  });
  console.log(`\nReport written to: ${args.outDir}`);

  if (args.ci) {
    const gates = loadGates();
    const verdicts = evaluateRetrievalGates(agg, gates.retrieval ?? {});
    const summary = summariseVerdicts(verdicts);
    console.log("\n— CI gates —");
    for (const v of verdicts) {
      console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name.padEnd(36)} (${v.detail})`);
    }
    console.log(`  ${summary.pass.toString()}/${summary.total.toString()} gates pass`);
    if (args.strict && summary.fail > 0) {
      console.error(`\n--strict: ${summary.fail.toString()} gate(s) failed, exiting 1`);
      process.exit(1);
    }
  }
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
