/**
 * runRagEval — generation harness.
 *
 *   for each generation case:
 *     - retrieve chunks via the strategy harness's --use-db machinery
 *       (semantic + symbol + BM25 mirror all populated)
 *     - generate an answer (mock by default, live with --live)
 *     - score: faithfulness, context P+R, expectedClaims hit,
 *       forbiddenClaim leak rate, abstention correctness
 *     - emit per-case rows + aggregate + report markdown
 *
 * Usage:
 *   npm run eval:rag              # mock answers, deterministic
 *   npm run eval:rag -- --live    # real provider from settings
 *   npm run eval:rag -- --use-db --strategy=hybrid
 *
 * The mock generator is deliberately simple — pick the best chunk by
 * score, lift sentences containing query tokens, stitch them. For
 * abstention cases it returns "I don't have enough context …". This
 * gives the harness deterministic baselines AND validates that the
 * scoring rules themselves are right (mock answers MUST pass
 * faithfulness because they're literally pulled from the chunks).
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
  type RetrievedChunk,
} from "../services/retrieval.js";
import { indexWorkspaceSymbols } from "../services/symbolIndex.js";
import { openDb } from "../db/index.js";
import { fixturesRoot, loadGenerationCases, type GenerationCase } from "./cases.js";
import {
  aggregateGeneration,
  evaluateGenerationCase,
  type GenCaseMetrics,
} from "./genMetrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Strategy = NonNullable<RetrieveOptions["forceStrategy"]>;

interface CliArgs {
  workspaces?: string[];
  strategy: Strategy;
  topK: number;
  outDir: string;
  live: boolean;
  useDb: boolean;
  /** Generation concurrency. N=1 = serial (default, safe on Ollama).
   *  N>1 = parallel — only useful against a batched backend (vLLM,
   *  hosted providers). Ollama serialises internally so N>1 can be
   *  *slower* there. */
  concurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  let workspaces: string[] | undefined;
  let strategy: Strategy = "auto";
  let topK = 6;
  let live = false;
  let useDb = false;
  let concurrency = 1;
  let outDir = path.join(
    __dirname,
    "..", "..", "..", "..",
    "data",
    "evals",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  for (const arg of argv) {
    if (arg.startsWith("--workspaces=")) {
      workspaces = arg.slice("--workspaces=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--strategy=")) {
      strategy = arg.slice("--strategy=".length).trim() as Strategy;
    } else if (arg.startsWith("--topK=")) {
      topK = parseInt(arg.slice("--topK=".length), 10) || topK;
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = Math.max(1, parseInt(arg.slice("--concurrency=".length), 10) || 1);
    } else if (arg === "--live") {
      live = true;
    } else if (arg === "--use-db") {
      useDb = true;
    }
  }
  return { workspaces, strategy, topK, outDir, live, useDb, concurrency };
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
            .catch(() => {}),
        );
      }
    }
  }
  walk(fixtureRoot);
  await Promise.all(promises);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Deterministic mock answer generator. Three modes:
 *
 *   1. Case marked as `expectedAbstention: true` → return an explicit
 *      abstention sentence. No claim leakage; abstentionCorrect=true.
 *   2. Context is empty → also abstain. The harness should NOT have
 *      asked for an answer in this state.
 *   3. Otherwise → pull the top chunk's sentence(s) that contain a
 *      query token, return them as the answer. By construction these
 *      sentences exist in the context, so faithfulness=1.
 *
 * The generated answer is *the right answer* the LLM would have given
 * if it perfectly grounded itself. That makes mock-mode a regression
 * check on the scorer + retrieval, not on the model.
 */
function mockGenerate(c: GenerationCase, chunks: RetrievedChunk[]): string {
  if (c.expectedAbstention) {
    return "I don't have enough context in this workspace to answer that question confidently.";
  }
  if (chunks.length === 0) {
    return "I don't have enough context to answer; no relevant files were retrieved.";
  }
  const queryTokens = c.query
    .toLowerCase()
    .split(/[\s,.!?\\/()'"]+/u)
    .filter((t) => t.length > 1);

  // Look at the top-3 chunks combined — the mock baseline needs enough
  // surface area to include specific values (CSV cells, constant names)
  // that may not be in the very top chunk. Skim each chunk's sentences,
  // keep ones that match any query token, dedupe by trimmed text.
  const topChunks = chunks.slice(0, 3);
  const seen = new Set<string>();
  const matched: string[] = [];
  for (const ch of topChunks) {
    const sentences = ch.chunk
      .split(/(?<=[.?!。…])\s+|\n+/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of sentences) {
      const lower = s.toLowerCase();
      if (queryTokens.some((t) => lower.includes(t))) {
        if (!seen.has(s)) { seen.add(s); matched.push(s); }
      }
    }
  }
  // If no sentence matched a token, take the first 2 sentences of the
  // top chunk — retrieval already vouched for it.
  const fallback = topChunks[0]!.chunk
    .split(/(?<=[.?!。…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 2);
  const picked = matched.length > 0 ? matched.slice(0, 6) : fallback;
  // Prefix kept short so the boilerplate filter in faithfulness can
  // ignore it without affecting the real content.
  return `Based on \`${topChunks[0]!.path}\`: ${picked.join(" ")}`;
}

async function liveGenerate(
  _c: GenerationCase,
  _chunks: RetrievedChunk[],
): Promise<string> {
  // Lazy import the provider machinery so the default mock path doesn't
  // pull in provider deps. --live wires this up to the configured
  // provider via getProvider() — same model the chat path would use.
  const { getProvider } = await import("../providers/index.js");
  const { getActiveSettings } = await import("../config.js");
  const settings = getActiveSettings();
  const provider = await getProvider({ provider: settings.provider, model: settings.model });
  const ctx = _chunks
    .map((c) => `--- ${c.path} ---\n${c.chunk.trim()}`)
    .join("\n\n");
  const sys =
    "You are an answer assistant grounded ONLY in the provided workspace excerpts. " +
    "If the excerpts don't contain enough information to answer, say so explicitly. " +
    "Be concise — 1–3 sentences.";
  const prompt = `Question:\n${_c.query}\n\nWorkspace excerpts:\n${ctx}`;
  const { text } = await provider.complete({ system: sys, prompt, signal: AbortSignal.timeout(60_000) });
  return text;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = loadGenerationCases();
  const filtered = args.workspaces
    ? cases.filter((c) => args.workspaces!.includes(c.workspace))
    : cases;
  if (filtered.length === 0) {
    console.log("No cases to run.");
    process.exit(0);
  }

  // Scratch DB for retrieval — same flow the strategy harness uses.
  let scratchDb: string | null = null;
  if (args.useDb) {
    scratchDb = path.join(os.tmpdir(), `ariadne-rag-eval-${Date.now().toString()}.db`);
    fs.rmSync(scratchDb, { force: true });
    openDb(scratchDb);
    console.log(`— scratch DB: ${scratchDb}`);
  }

  // Pre-scan + (optionally) pre-index each fixture once.
  const fixturesByName = new Map<string, { root: string; files: FileMeta[]; workspaceId: string | null }>();
  const workspaceNames = Array.from(new Set(filtered.map((c) => c.workspace)));
  for (const ws of workspaceNames) {
    const root = path.join(fixturesRoot(), ws);
    if (!fs.existsSync(root)) {
      console.error(`Missing fixture workspace: ${root}`);
      process.exit(1);
    }
    const files = await scanFixture(root);
    let workspaceId: string | null = null;
    if (args.useDb) {
      workspaceId = `eval-rag:${ws}`;
      console.log(`— indexing ${ws} as ${workspaceId} (${files.length.toString()} files)`);
      const symRes = await indexWorkspaceSymbols(workspaceId, root, files);
      console.log(`    symbols: ${symRes.symbols.toString()}`);
      try {
        const embRes = await indexWorkspaceEmbeddings(workspaceId, root, files);
        console.log(
          embRes.provider == null
            ? `    embeddings: skipped (no embedding provider reachable)`
            : `    embeddings: ${embRes.indexed.toString()} chunks via ${embRes.provider}`,
        );
      } catch (err) {
        console.log(`    embeddings: failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    fixturesByName.set(ws, { root, files, workspaceId });
  }

  // Per-case work — retrieval + generation + scoring + log. Pulled out
  // so the runner can dispatch via either a serial for-of (concurrency=1,
  // safe against Ollama / unwilling backends) or a Promise.all pool
  // (concurrency>1, only beneficial against a batched backend like vLLM).
  async function runCase(c: typeof filtered[number]): Promise<GenCaseMetrics | null> {
    const fix = fixturesByName.get(c.workspace);
    if (!fix) return null;
    const retrieveOpts: RetrieveOptions = {
      topK: args.topK,
      forceStrategy: args.strategy,
      ...(fix.workspaceId ? { workspaceId: fix.workspaceId } : {}),
    };
    const result = await retrieveWithMeta(fix.root, fix.files, c.query, retrieveOpts);
    const t0 = performance.now();
    const answer = args.live
      ? await liveGenerate(c, result.chunks)
      : mockGenerate(c, result.chunks);
    const latency = performance.now() - t0;
    const generator = args.live ? "live-provider" : "mock";
    const row = evaluateGenerationCase(c, answer, result.chunks, latency, generator);
    const ok =
      row.faithfulness >= 0.85 &&
      row.forbiddenClaimLeaks.length === 0 &&
      row.abstentionCorrect &&
      row.expectedClaimsHit >= 0.5;
    const tag = ok ? "✓" : "✗";
    console.log(
      `${tag} ${c.id.padEnd(34)} faith=${(row.faithfulness * 100).toFixed(0)}% abst=${row.abstentionCorrect ? "y" : "n"} expCl=${(row.expectedClaimsHit * 100).toFixed(0)}% forbiddenLeak=${row.forbiddenClaimLeaks.length.toString()} ${row.latencyMs.toFixed(0)}ms`,
    );
    return row;
  }

  const rows: GenCaseMetrics[] = [];
  if (args.concurrency <= 1) {
    for (const c of filtered) {
      const row = await runCase(c);
      if (row) rows.push(row);
    }
  } else {
    // Bounded pool — N in-flight cases at any time. Useful against
    // continuous-batching backends (vLLM continuous batching + prefix
    // caching collapses N cases that share the system prompt into a
    // single forward pass). NOT useful against Ollama, which serialises
    // and shares no KV across requests — N>1 there is no faster, often
    // slower. Default stays at 1 so a fresh `npm run eval:rag --live`
    // doesn't surprise an Ollama user with thrash.
    console.log(`-- generation concurrency: ${args.concurrency.toString()} (requires batched backend; Ollama users should keep =1)`);
    const queue = [...filtered];
    const workers = Array.from({ length: args.concurrency }, async () => {
      while (queue.length > 0) {
        const c = queue.shift();
        if (!c) return;
        const row = await runCase(c);
        if (row) rows.push(row);
      }
    });
    await Promise.all(workers);
  }

  const agg = aggregateGeneration(rows);
  console.log("\n— Aggregate —");
  console.log(`Cases: ${agg.cases.toString()}  (abstention cases: ${agg.abstentionCases.toString()})`);
  console.log(`Faithfulness mean: ${(agg.meanFaithfulness * 100).toFixed(1)}%`);
  console.log(`Unsupported claim rate: ${(agg.unsupportedClaimRate * 100).toFixed(1)}%`);
  console.log(`Abstention precision: ${(agg.abstentionPrecision * 100).toFixed(1)}%`);
  console.log(`Expected claims hit (mean): ${(agg.meanExpectedClaimsHit * 100).toFixed(1)}%`);
  console.log(`Forbidden claim leak rate: ${(agg.forbiddenClaimLeakRate * 100).toFixed(1)}%`);
  console.log(`Context P / R: ${(agg.meanContextPrecision * 100).toFixed(1)}% / ${(agg.meanContextRecall * 100).toFixed(1)}%`);
  console.log(`Latency: mean ${agg.meanLatencyMs.toFixed(1)}ms  p95 ${agg.p95LatencyMs.toFixed(1)}ms`);

  // Reports
  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(args.outDir, "rag-summary.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      strategy: args.strategy,
      topK: args.topK,
      mode: args.live ? "live" : "mock",
      aggregate: agg,
    }, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(args.outDir, "rag-details.json"),
    JSON.stringify(rows, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(args.outDir, "rag-report.md"),
    renderRagMarkdown(rows, agg, args),
    "utf-8",
  );
  console.log(`\nReport written to: ${args.outDir}`);
}

function renderRagMarkdown(rows: GenCaseMetrics[], agg: ReturnType<typeof aggregateGeneration>, args: CliArgs): string {
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const ms = (x: number) => x.toFixed(1) + " ms";
  const lines: string[] = [];
  lines.push("# RAG Generation Eval — Report\n");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: **${args.live ? "live provider" : "mock"}** · Strategy: \`${args.strategy}\` · topK=${args.topK.toString()}`);
  lines.push("");
  lines.push("## Aggregate\n");
  lines.push(`- Cases: **${agg.cases.toString()}** (abstention cases: ${agg.abstentionCases.toString()})`);
  lines.push(`- Faithfulness (mean): **${pct(agg.meanFaithfulness)}**`);
  lines.push(`- Unsupported claim rate: **${pct(agg.unsupportedClaimRate)}**`);
  lines.push(`- Abstention precision: **${pct(agg.abstentionPrecision)}**`);
  lines.push(`- Expected claims hit (mean): **${pct(agg.meanExpectedClaimsHit)}**`);
  lines.push(`- Forbidden claim leak rate: **${pct(agg.forbiddenClaimLeakRate)}**`);
  lines.push(`- Context P / R: **${pct(agg.meanContextPrecision)} / ${pct(agg.meanContextRecall)}**`);
  lines.push(`- Latency: mean ${ms(agg.meanLatencyMs)} · p50 ${ms(agg.p50LatencyMs)} · p95 ${ms(agg.p95LatencyMs)}`);
  lines.push("");
  lines.push("## Per-case\n");
  lines.push("| Case | Faith | Abst | ExpClaim | Forbidden | CtxP | CtxR | Latency |");
  lines.push("|------|-------|------|----------|-----------|------|------|---------|");
  for (const r of rows) {
    lines.push(
      `| \`${r.caseId}\` | ${pct(r.faithfulness)} | ${r.abstentionCorrect ? "✓" : "✗"} | ${pct(r.expectedClaimsHit)} | ${r.forbiddenClaimLeaks.length === 0 ? "—" : r.forbiddenClaimLeaks.join(", ")} | ${pct(r.contextPrecision)} | ${pct(r.contextRecall)} | ${ms(r.latencyMs)} |`,
    );
  }
  lines.push("");
  // Failures only
  const failures = rows.filter(
    (r) => r.faithfulness < 0.85 || r.forbiddenClaimLeaks.length > 0 || !r.abstentionCorrect || r.expectedClaimsHit < 0.5,
  );
  if (failures.length > 0) {
    lines.push("## Failures (faith < 85% OR leak OR wrong abstention OR <50% expected)\n");
    for (const r of failures) {
      lines.push(`### \`${r.caseId}\`\n`);
      lines.push(`Query: \`${r.query}\``);
      lines.push(`Faithfulness: ${pct(r.faithfulness)} · Expected claims hit: ${pct(r.expectedClaimsHit)} · Forbidden leaks: ${r.forbiddenClaimLeaks.join(", ") || "(none)"}`);
      lines.push(`\nAnswer:\n> ${r.answer.slice(0, 400).replace(/\n/g, "\n> ")}\n`);
      if (r.unsupportedSentences.length > 0) {
        lines.push(`Unsupported sentences:`);
        for (const s of r.unsupportedSentences) lines.push(`- ${s.slice(0, 200)}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
