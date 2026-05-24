/**
 * Report writers for the eval harness. Two formats:
 *  - JSON: machine-readable, full per-case detail. Consumed by CI gates
 *    and any future dashboard.
 *  - Markdown: human-readable, summary table + flagged failures.
 *
 * Both go under `data/evals/<isoTimestamp>/`. The timestamp lets old
 * runs stay around for diffing without overwriting.
 */
import fs from "node:fs";
import path from "node:path";
import type { CaseMetrics, AggregateMetrics } from "../metrics.js";

export interface ReportInput {
  agg: AggregateMetrics;
  rows: CaseMetrics[];
  /** Free-form context (e.g. embedding provider, run mode). */
  context?: Record<string, unknown>;
}

export function writeReports(outDir: string, input: ReportInput): void {
  fs.mkdirSync(outDir, { recursive: true });

  const summaryPath = path.join(outDir, "retrieval-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        context: input.context ?? {},
        aggregate: input.agg,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const detailsPath = path.join(outDir, "retrieval-details.json");
  fs.writeFileSync(detailsPath, JSON.stringify(input.rows, null, 2), "utf-8");

  const mdPath = path.join(outDir, "report.md");
  fs.writeFileSync(mdPath, renderMarkdown(input), "utf-8");
}

function renderMarkdown(input: ReportInput): string {
  const a = input.agg;
  const ctx = input.context ?? {};
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const ms = (x: number) => x.toFixed(1) + " ms";

  const lines: string[] = [];
  lines.push("# Retrieval Eval — Report\n");
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  if (Object.keys(ctx).length > 0) {
    lines.push("## Context\n");
    for (const [k, v] of Object.entries(ctx)) {
      lines.push(`- **${k}**: \`${JSON.stringify(v)}\``);
    }
    lines.push("");
  }

  lines.push("## Aggregate\n");
  lines.push(`- Cases: **${a.cases.toString()}**`);
  lines.push(`- Hit@1: **${pct(a.hits.at1)}**`);
  lines.push(`- Hit@3: **${pct(a.hits.at3)}**`);
  lines.push(`- Hit@6: **${pct(a.hits.at6)}**`);
  lines.push(`- MRR: **${a.mrr.toFixed(3)}**`);
  lines.push(`- Context Precision@6: **${pct(a.meanContextPrecisionAt6)}**`);
  lines.push(`- Context Recall@6: **${pct(a.meanContextRecallAt6)}**`);
  lines.push(`- Distractor leak rate: **${pct(a.distractorLeakRate)}**`);
  lines.push(`- Latency: mean ${ms(a.meanLatencyMs)} · p50 ${ms(a.p50LatencyMs)} · p95 ${ms(a.p95LatencyMs)}`);
  lines.push("");

  lines.push("## Strategy mix\n");
  for (const [name, count] of Object.entries(a.byStrategy)) {
    lines.push(`- ${name}: ${count.toString()}`);
  }
  lines.push("");

  // Failure list — anything that missed Hit@6 OR leaked a distractor.
  const failures = input.rows.filter((r) => !r.hitAt6 || r.distractorLeaks.length > 0);
  if (failures.length > 0) {
    lines.push("## Failures (no Hit@6 OR distractor leak)\n");
    lines.push("| Case | Workspace | Strategy | Hit@6 | RR | Distractor leaks |");
    lines.push("|------|-----------|----------|-------|----|------------------|");
    for (const r of failures) {
      lines.push(
        `| \`${r.caseId}\` | ${r.workspace} | ${r.strategy} | ${r.hitAt6 ? "✓" : "✗"} | ${r.reciprocalRank.toFixed(2)} | ${r.distractorLeaks.join(", ") || "—"} |`,
      );
    }
    lines.push("");
  }

  // Full per-case table at the end.
  lines.push("## All cases\n");
  lines.push("| Case | Hit@1 | Hit@3 | Hit@6 | RR | P@6 | R@6 | Latency | Strategy |");
  lines.push("|------|-------|-------|-------|----|-----|-----|---------|----------|");
  for (const r of input.rows) {
    lines.push(
      `| \`${r.caseId}\` | ${r.hitAt1 ? "✓" : "·"} | ${r.hitAt3 ? "✓" : "·"} | ${r.hitAt6 ? "✓" : "·"} | ${r.reciprocalRank.toFixed(2)} | ${pct(r.precisionAt6)} | ${pct(r.recallAt6)} | ${ms(r.latencyMs)} | ${r.strategy} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
