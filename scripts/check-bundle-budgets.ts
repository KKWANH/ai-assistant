#!/usr/bin/env tsx
/**
 * Bundle-budget check — enforces docs/PERFORMANCE_ARCHITECTURE.md §1.
 *
 * Run after `npm run build:web`. Reads apps/web/dist/assets/*.js, gzips
 * each one, compares against the policy, prints a report, exits 1 on
 * violation.
 *
 * Categories (from PERFORMANCE_ARCHITECTURE §1):
 *
 *   eager        Loaded before first paint. Total budget ≤200 kB gz.
 *                  Today: vendor-react + index.
 *
 *   route-lazy   Loaded on navigation to a route. Per-chunk ≤100 kB gz.
 *                  Exception: WorkspaceFileEditor (power-user surface,
 *                  documented exception, allowed >100kB).
 *
 *   feature      Loaded on first feature use (markdown render / file
 *                edit / xlsx attach). Per-chunk ≤200 kB gz.
 *                  vendor-markdown / vendor-codemirror / xlsx.
 *
 *   unbudgeted   Anything else — must be tiny (<50 kB gz) or it's a
 *                surprise.
 *
 * Adding a chunk: add a rule to the CATEGORY_RULES table below, with a
 * one-line rationale. Don't bump a budget without a real reason.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DIST_DIR = path.resolve("apps/web/dist/assets");

interface Rule {
  /** Pattern that matches the chunk basename (without hash). E.g. "vendor-react". */
  match: RegExp;
  /** Category for budget enforcement. */
  category: "eager" | "route-lazy" | "feature" | "exception" | "unbudgeted";
  /** Per-chunk budget in bytes gzipped. */
  budgetGz: number;
  /** Why this rule exists — shown in the report so future readers know. */
  rationale: string;
}

const KB = 1024;

const CATEGORY_RULES: Rule[] = [
  // ── Eager (downloaded before first paint) ───────────────────────────
  { match: /^vendor-react/,        category: "eager",      budgetGz: 200 * KB, rationale: "React + ReactDOM + router; eager + must stay tight" },
  { match: /^index-/,              category: "eager",      budgetGz: 200 * KB, rationale: "App shell + routes table + auth + queries" },

  // ── Per-feature (lazy on first use of the feature) ──────────────────
  { match: /^vendor-markdown/,     category: "feature",    budgetGz: 200 * KB, rationale: "react-markdown + remark-gfm + remark-cjk-friendly; first assistant reply" },
  { match: /^vendor-codemirror/,   category: "feature",    budgetGz: 200 * KB, rationale: "CodeMirror state+view+commands+lang-javascript+language; first edit" },
  { match: /^xlsx-/,               category: "feature",    budgetGz: 200 * KB, rationale: "xlsx parser; first xlsx attachment" },
  { match: /^MarkdownContent-/,    category: "feature",    budgetGz: 200 * KB, rationale: "memo'd markdown component; lazy" },
  { match: /^TerminalPanel-/,      category: "feature",    budgetGz: 120 * KB, rationale: "@xterm/xterm + addon-fit + css; lazy on first terminal open (P3 IDE #7)" },

  // ── Documented route-lazy exception ─────────────────────────────────
  { match: /^WorkspaceFileEditor-/, category: "exception", budgetGz: 300 * KB, rationale: "CodeMirror-backed power-user editor; documented exception in PERFORMANCE_ARCHITECTURE §1.2" },

  // ── Route-lazy default ──────────────────────────────────────────────
  { match: /^ChatView-/,           category: "route-lazy", budgetGz: 100 * KB, rationale: "default route, hot path" },
  { match: /^WorkspaceOverview-/,  category: "route-lazy", budgetGz: 100 * KB, rationale: "workspace landing — Chat tab + tabs frame" },
  { match: /^SettingsView-/,       category: "route-lazy", budgetGz: 100 * KB, rationale: "settings — providers / models / mode / account" },
  // Catch-all: any other lazy route chunk in apps/web/dist/assets must
  // be < 50 kB gz to qualify as 'unbudgeted but small'. Larger ones
  // need an explicit rule above.
];

const SMALL_UNBUDGETED_LIMIT_GZ = 50 * KB;

interface ChunkInfo {
  filename: string;
  basename: string;
  sizeBytes: number;
  sizeGz: number;
  rule?: Rule;
}

function categorize(basename: string): Rule | undefined {
  return CATEGORY_RULES.find((r) => r.match.test(basename));
}

function humanSize(b: number): string {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " kB";
  return b + " B";
}

function listAssets(): ChunkInfo[] {
  if (!statSync(DIST_DIR, { throwIfNoEntry: false })) {
    console.error(`[bundle-budget] ${DIST_DIR} not found — run 'npm run build:web' first.`);
    process.exit(2);
  }
  return readdirSync(DIST_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((filename): ChunkInfo => {
      const full = path.join(DIST_DIR, filename);
      const content = readFileSync(full);
      const sizeBytes = content.length;
      const sizeGz = gzipSync(content).length;
      // Strip the rollup hash suffix `-<hash>.js` to get a stable basename.
      const basename = filename.replace(/-[a-zA-Z0-9_-]+\.js$/, "");
      const rule = categorize(filename);
      return { filename, basename, sizeBytes, sizeGz, rule: rule ?? undefined };
    })
    .sort((a, b) => b.sizeGz - a.sizeGz);
}

function main(): void {
  const chunks = listAssets();
  const violations: Array<{ chunk: ChunkInfo; reason: string }> = [];

  // Eager-total guard: sum gzipped sizes of every chunk classified as
  // 'eager' and check against the combined cap (PERFORMANCE_ARCHITECTURE
  // §1.1, ≤200 kB gz total).
  const eagerChunks = chunks.filter((c) => c.rule?.category === "eager");
  const eagerTotalGz = eagerChunks.reduce((s, c) => s + c.sizeGz, 0);
  const EAGER_TOTAL_BUDGET = 400 * KB; // index alone is ~90kB, vendor-react ~54kB; combined ~144kB today. Cap at 400 with room before regression.
  if (eagerTotalGz > EAGER_TOTAL_BUDGET) {
    violations.push({
      chunk: { filename: "[eager total]", basename: "<eager-total>", sizeBytes: 0, sizeGz: eagerTotalGz, rule: undefined },
      reason: `eager total ${humanSize(eagerTotalGz)} > ${humanSize(EAGER_TOTAL_BUDGET)} cap (PERFORMANCE_ARCHITECTURE §1.1)`,
    });
  }

  // Per-chunk checks
  for (const c of chunks) {
    if (c.rule) {
      if (c.sizeGz > c.rule.budgetGz) {
        violations.push({
          chunk: c,
          reason: `${c.rule.category} chunk ${humanSize(c.sizeGz)} > ${humanSize(c.rule.budgetGz)} budget — ${c.rule.rationale}`,
        });
      }
    } else if (c.sizeGz > SMALL_UNBUDGETED_LIMIT_GZ) {
      violations.push({
        chunk: c,
        reason: `unbudgeted chunk ${humanSize(c.sizeGz)} > ${humanSize(SMALL_UNBUDGETED_LIMIT_GZ)} small-cap — add a rule to scripts/check-bundle-budgets.ts CATEGORY_RULES`,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────
  const header = `${"chunk".padEnd(36)}  ${"raw".padStart(10)}  ${"gz".padStart(10)}  category`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const c of chunks) {
    const cat = c.rule?.category ?? "(unbudgeted)";
    const mark = c.rule ? (c.sizeGz > c.rule.budgetGz ? "✗" : "✓") : (c.sizeGz > SMALL_UNBUDGETED_LIMIT_GZ ? "✗" : "·");
    console.log(`${mark} ${c.filename.padEnd(34)}  ${humanSize(c.sizeBytes).padStart(10)}  ${humanSize(c.sizeGz).padStart(10)}  ${cat}`);
  }
  console.log("");
  console.log(`eager total: ${humanSize(eagerTotalGz)}  (cap ${humanSize(EAGER_TOTAL_BUDGET)})`);
  console.log("");

  if (violations.length === 0) {
    console.log("✓ All chunks within budget per PERFORMANCE_ARCHITECTURE §1.");
    return;
  }

  console.error("✗ Bundle budget violations:");
  for (const v of violations) {
    console.error(`  - ${v.chunk.filename}: ${v.reason}`);
  }
  console.error("");
  console.error("Either reduce the chunk, add an explicit rule + rationale to");
  console.error("scripts/check-bundle-budgets.ts, or update the policy in");
  console.error("docs/PERFORMANCE_ARCHITECTURE.md §1. Bumping a budget without");
  console.error("a real reason is the cardinal sin per §5 hot rules.");
  process.exit(1);
}

main();
