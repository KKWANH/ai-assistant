/**
 * runStrategyEval — run the same retrieval case set under multiple
 * strategies and tabulate the difference. Answers questions like
 * "what does the symbol boost actually buy us?" without guessing.
 *
 * Strategies for v1:
 *   - keyword-only        keyword ranker, no symbol nudge
 *   - keyword+symbol      keyword ranker + symbol-boost (current default
 *                         keyword path when not on the semantic path)
 *   - semantic-only       semantic cosine, returns empty if no index
 *                         (skipped + flagged in the report when the
 *                         fixture has no embeddings)
 *
 * Output:
 *   data/evals/<isoTimestamp>/strategy-summary.json
 *   data/evals/<isoTimestamp>/strategy-details.json
 *   data/evals/<isoTimestamp>/strategy-report.md   side-by-side table
 *
 * Usage:
 *   npm run eval:strategy
 *   npm run eval:strategy -- --strategies=keyword-only,keyword+symbol
 *   npm run eval:strategy -- --workspaces=korean-mixed --topK=10
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { FileMeta } from "@ariadne/shared";
import { buildFileMeta } from "../workspace/metadata.js";
import {
  indexWorkspaceEmbeddings,
  retrieveWithMeta,
  type RetrieveOptions,
} from "../services/retrieval.js";
import { indexWorkspaceSymbols } from "../services/symbolIndex.js";
import { openDb } from "../db/index.js";
import { loadRetrievalCases, fixturesRoot, type RetrievalCase } from "./cases.js";
import { evaluateCase, aggregate, type CaseMetrics, type AggregateMetrics } from "./metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type StrategyId = "keyword-only" | "keyword+symbol" | "semantic-only" | "hybrid";

const DEFAULT_STRATEGIES: StrategyId[] = [
  "keyword-only",
  "keyword+symbol",
  "semantic-only",
  "hybrid",
];

interface CliArgs {
  workspaces?: string[];
  strategies: StrategyId[];
  topK: number;
  outDir: string;
  /** Boot a scratch SQLite + populate symbol + embedding indexes for
   *  each fixture before running. Required for `keyword+symbol` to
   *  actually use the boost, and for `semantic-only` to have anything
   *  to search. Off by default — keeps the runner fast for keyword
   *  comparisons and skips the embedding provider requirement. */
  useDb: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let workspaces: string[] | undefined;
  let strategies: StrategyId[] = DEFAULT_STRATEGIES.slice();
  let topK = 10;
  let useDb = false;
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
    } else if (arg.startsWith("--strategies=")) {
      strategies = arg
        .slice("--strategies=".length)
        .split(",")
        .map((s) => s.trim() as StrategyId)
        .filter((s) => DEFAULT_STRATEGIES.includes(s));
    } else if (arg.startsWith("--topK=")) {
      topK = parseInt(arg.slice("--topK=".length), 10) || topK;
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    } else if (arg === "--use-db") {
      useDb = true;
    }
  }

  return { workspaces, strategies, topK, outDir, useDb };
}

async function scanFixture(fixtureRoot: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  const promises: Promise<void>[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".ariadne" || entry.name === ".git" || entry.name === "node_modules") continue;
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(fixtureRoot, abs).split(path.sep).join("/");
        promises.push(
          buildFileMeta(abs, rel)
            .then((m) => { out.push(m); })
            .catch(() => { /* skip */ }),
        );
      }
    }
  }
  walk(fixtureRoot);
  await Promise.all(promises);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

interface StrategyResult {
  strategy: StrategyId;
  rows: CaseMetrics[];
  agg: AggregateMetrics;
  /** Cases where the strategy returned 0 chunks for non-empty queries —
   *  surfaces "semantic-only with no index" cleanly. */
  emptyResultCount: number;
}

interface FixtureEntry {
  root: string;
  files: FileMeta[];
  /** Synthetic workspace id used when --use-db is set; the symbol +
   *  embedding indexes live under this id. Null when running without
   *  DB (keyword path doesn't need it). */
  workspaceId: string | null;
}

async function runStrategy(
  strategy: StrategyId,
  cases: RetrievalCase[],
  fixturesByName: Map<string, FixtureEntry>,
  topK: number,
): Promise<StrategyResult> {
  const rows: CaseMetrics[] = [];
  let emptyResultCount = 0;
  for (const c of cases) {
    const fix = fixturesByName.get(c.workspace);
    if (!fix) continue;
    // workspaceId is required for symbol lookup (keyword+symbol) and
    // for semantic retrieval — pass it through when --use-db has set
    // it up. Without it, the retriever emits an honest warning instead
    // of degrading silently.
    const opts: RetrieveOptions = {
      topK,
      forceStrategy: strategy,
      ...(fix.workspaceId ? { workspaceId: fix.workspaceId } : {}),
    };
    const t0 = performance.now();
    const result = await retrieveWithMeta(fix.root, fix.files, c.query, opts);
    const latency = performance.now() - t0;
    if (result.chunks.length === 0) emptyResultCount++;
    rows.push(evaluateCase(c, result.chunks, latency, result.strategy));
  }
  return { strategy, rows, agg: aggregate(rows), emptyResultCount };
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

  // Boot a scratch SQLite when --use-db is set. Has to happen BEFORE
  // any indexer call — both indexers use `getDb()` internally. The DB
  // file lives in tmpdir; subsequent runs blow away the file so each
  // session starts clean (no leakage from a previous strategies run).
  let scratchDb: string | null = null;
  if (args.useDb) {
    scratchDb = path.join(os.tmpdir(), `ariadne-eval-${Date.now().toString()}.db`);
    fs.rmSync(scratchDb, { force: true });
    openDb(scratchDb);
    console.log(`— scratch DB: ${scratchDb}`);
  }

  // Pre-scan each fixture once and reuse across strategies — every
  // strategy gets the same FileMeta[] so the comparison is fair.
  // When --use-db is on we ALSO index symbols + embeddings for each
  // fixture under a synthetic workspaceId, so keyword+symbol and
  // semantic-only have real data to query.
  const fixturesByName = new Map<string, FixtureEntry>();
  const workspaceNames = Array.from(new Set(filteredCases.map((c) => c.workspace)));
  for (const ws of workspaceNames) {
    const root = path.join(fixturesRoot(), ws);
    if (!fs.existsSync(root)) {
      console.error(`Missing fixture workspace: ${root}`);
      process.exit(1);
    }
    const files = await scanFixture(root);
    let workspaceId: string | null = null;
    if (args.useDb) {
      workspaceId = `eval:${ws}`;
      console.log(`— indexing ${ws} as ${workspaceId} (${files.length.toString()} files)`);
      const symRes = await indexWorkspaceSymbols(workspaceId, root, files);
      console.log(`    symbols: ${symRes.symbols.toString()}`);
      try {
        const embRes = await indexWorkspaceEmbeddings(workspaceId, root, files);
        if (embRes.provider == null) {
          console.log(`    embeddings: skipped (no embedding provider reachable)`);
        } else {
          console.log(`    embeddings: ${embRes.indexed.toString()} chunks via ${embRes.provider}`);
        }
      } catch (err) {
        console.log(`    embeddings: failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    fixturesByName.set(ws, { root, files, workspaceId });
  }

  const byStrategy: StrategyResult[] = [];
  for (const s of args.strategies) {
    console.log(`\n— running ${s} —`);
    const r = await runStrategy(s, filteredCases, fixturesByName, args.topK);
    byStrategy.push(r);
    printStrategySummary(r);
  }

  console.log("\n— Strategy comparison —");
  printComparisonTable(byStrategy);
  printRegressionList(byStrategy);

  // Write reports.
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(args.outDir, "strategy-summary.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        topK: args.topK,
        casesPath: "apps/server/src/eval/cases/retrieval.yaml",
        strategies: byStrategy.map((s) => ({
          strategy: s.strategy,
          aggregate: s.agg,
          emptyResultCount: s.emptyResultCount,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(args.outDir, "strategy-details.json"),
    JSON.stringify(
      byStrategy.map((s) => ({ strategy: s.strategy, rows: s.rows })),
      null,
      2,
    ),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(args.outDir, "strategy-report.md"),
    renderMarkdown(byStrategy, args.topK),
    "utf-8",
  );
  console.log(`\nReport written to: ${args.outDir}`);
}

function printStrategySummary(r: StrategyResult): void {
  const a = r.agg;
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  console.log(
    `  ${r.strategy.padEnd(16)} Hit@1=${pct(a.hits.at1)} Hit@3=${pct(a.hits.at3)} Hit@6=${pct(a.hits.at6)} ` +
      `MRR=${a.mrr.toFixed(3)} P@6=${pct(a.meanContextPrecisionAt6)} R@6=${pct(a.meanContextRecallAt6)} ` +
      `p95=${a.p95LatencyMs.toFixed(1)}ms emptyResults=${r.emptyResultCount.toString()}`,
  );
}

function printComparisonTable(strategies: StrategyResult[]): void {
  const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + "%";
  const ms = (x: number) => x.toFixed(1).padStart(5) + "ms";
  const head = `| ${"strategy".padEnd(16)} | Hit@1   | Hit@3   | Hit@6   | MRR   | P@6     | R@6     | p95     | empty |`;
  const sep = `|${"-".repeat(18)}|---------|---------|---------|-------|---------|---------|---------|-------|`;
  console.log(head);
  console.log(sep);
  for (const s of strategies) {
    const a = s.agg;
    console.log(
      `| ${s.strategy.padEnd(16)} | ${pct(a.hits.at1)} | ${pct(a.hits.at3)} | ${pct(a.hits.at6)} | ${a.mrr.toFixed(3)} | ${pct(a.meanContextPrecisionAt6)} | ${pct(a.meanContextRecallAt6)} | ${ms(a.p95LatencyMs)} | ${s.emptyResultCount.toString().padStart(5)} |`,
    );
  }
}

/**
 * Per-case regression list — for each case, mark which strategies hit
 * @6 vs missed. Highlights "this case is a strategy-specific win"
 * scenarios that the aggregate table averages out.
 */
function printRegressionList(strategies: StrategyResult[]): void {
  if (strategies.length < 2) return;
  console.log("\n— Per-case strategy delta (Hit@6 + RR) —");
  const baseline = strategies[0]!;
  for (let i = 0; i < baseline.rows.length; i++) {
    const caseId = baseline.rows[i]!.caseId;
    const cells = strategies.map((s) => {
      const r = s.rows[i];
      if (!r) return "—";
      const tag = r.hitAt6 ? "✓" : "✗";
      return `${tag}${r.reciprocalRank.toFixed(2)}`;
    });
    console.log(`  ${caseId.padEnd(34)} ${cells.map((c, i) => strategies[i]!.strategy.slice(0, 8).padEnd(8) + "=" + c.padEnd(6)).join(" ")}`);
  }
}

function renderMarkdown(strategies: StrategyResult[], topK: number): string {
  const lines: string[] = [];
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const ms = (x: number) => x.toFixed(1) + " ms";
  lines.push("# Strategy Comparison — Report\n");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`topK: ${topK.toString()}`);
  lines.push(`Cases: ${strategies[0]?.rows.length.toString() ?? "0"}`);
  lines.push("");

  lines.push("## Aggregate\n");
  lines.push("| strategy | Hit@1 | Hit@3 | Hit@6 | MRR | P@6 | R@6 | p95 latency | empty |");
  lines.push("|----------|-------|-------|-------|-----|-----|-----|-------------|-------|");
  for (const s of strategies) {
    const a = s.agg;
    lines.push(
      `| **${s.strategy}** | ${pct(a.hits.at1)} | ${pct(a.hits.at3)} | ${pct(a.hits.at6)} | ${a.mrr.toFixed(3)} | ${pct(a.meanContextPrecisionAt6)} | ${pct(a.meanContextRecallAt6)} | ${ms(a.p95LatencyMs)} | ${s.emptyResultCount.toString()} |`,
    );
  }
  lines.push("");

  if (strategies.length >= 2) {
    lines.push("## Per-case Hit@6 + RR by strategy\n");
    const headers = ["case", ...strategies.map((s) => s.strategy)];
    lines.push("| " + headers.join(" | ") + " |");
    lines.push("|" + headers.map(() => "---").join("|") + "|");
    const baseline = strategies[0]!;
    for (let i = 0; i < baseline.rows.length; i++) {
      const caseId = baseline.rows[i]!.caseId;
      const cells = strategies.map((s) => {
        const r = s.rows[i];
        if (!r) return "—";
        return `${r.hitAt6 ? "✓" : "✗"} ${r.reciprocalRank.toFixed(2)}`;
      });
      lines.push(`| \`${caseId}\` | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
