/**
 * Gates — soft (informational) thresholds for retrieval eval.
 *
 * Reads `gates.yaml` next to this file, compares each `*Min` / `*Max`
 * against the aggregate metrics from the runner, returns a list of
 * verdicts. The caller decides what to do with FAILs (exit code,
 * report bullet, etc.).
 *
 * v1 = soft gates. Future work: a `--strict` mode that exits 1 on any
 * FAIL — useful in CI once the bar has stabilised.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import type { AggregateMetrics } from "./metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RetrievalGates {
  hitAt6Min?: number;
  mrrMin?: number;
  contextPrecisionMin?: number;
  p95LatencyMsMax?: number;
  distractorLeakRateMax?: number;
}

export interface GatesFile {
  retrieval?: RetrievalGates;
}

export interface GateVerdict {
  name: string;
  pass: boolean;
  /** Human-readable comparison string for the report. */
  detail: string;
}

export function defaultGatesPath(): string {
  return path.join(__dirname, "gates.yaml");
}

export function loadGates(filePath: string = defaultGatesPath()): GatesFile {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  return yaml.parse(raw) as GatesFile;
}

/**
 * Evaluate the retrieval gates against an aggregate. Missing gate
 * values are skipped (no PASS or FAIL row). PASS / FAIL is purely
 * informational — the caller chooses whether to exit non-zero.
 */
export function evaluateRetrievalGates(
  agg: AggregateMetrics,
  gates: RetrievalGates,
): GateVerdict[] {
  const out: GateVerdict[] = [];
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const ms = (x: number) => x.toFixed(1) + " ms";

  if (gates.hitAt6Min != null) {
    const pass = agg.hits.at6 >= gates.hitAt6Min;
    out.push({
      name: "Hit@6 ≥ " + pct(gates.hitAt6Min),
      pass,
      detail: `${pct(agg.hits.at6)} vs ${pct(gates.hitAt6Min)}`,
    });
  }
  if (gates.mrrMin != null) {
    const pass = agg.mrr >= gates.mrrMin;
    out.push({
      name: "MRR ≥ " + gates.mrrMin.toFixed(3),
      pass,
      detail: `${agg.mrr.toFixed(3)} vs ${gates.mrrMin.toFixed(3)}`,
    });
  }
  if (gates.contextPrecisionMin != null) {
    const pass = agg.meanContextPrecisionAt6 >= gates.contextPrecisionMin;
    out.push({
      name: "Context P@6 ≥ " + pct(gates.contextPrecisionMin),
      pass,
      detail: `${pct(agg.meanContextPrecisionAt6)} vs ${pct(gates.contextPrecisionMin)}`,
    });
  }
  if (gates.p95LatencyMsMax != null) {
    const pass = agg.p95LatencyMs <= gates.p95LatencyMsMax;
    out.push({
      name: "p95 latency ≤ " + ms(gates.p95LatencyMsMax),
      pass,
      detail: `${ms(agg.p95LatencyMs)} vs ${ms(gates.p95LatencyMsMax)}`,
    });
  }
  if (gates.distractorLeakRateMax != null) {
    const pass = agg.distractorLeakRate <= gates.distractorLeakRateMax;
    out.push({
      name: "Distractor leak ≤ " + pct(gates.distractorLeakRateMax),
      pass,
      detail: `${pct(agg.distractorLeakRate)} vs ${pct(gates.distractorLeakRateMax)}`,
    });
  }
  return out;
}

export function summariseVerdicts(verdicts: GateVerdict[]): { pass: number; fail: number; total: number } {
  let pass = 0;
  for (const v of verdicts) if (v.pass) pass++;
  return { pass, fail: verdicts.length - pass, total: verdicts.length };
}
