/**
 * Cases YAML loader. Light schema validation — anything missing means
 * skip with a console warning, not a hard crash, so adding a new case
 * shape doesn't break the runner on first load.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

export interface MustHit {
  path: string;
  contains?: string;
}

export interface RetrievalCase {
  id: string;
  workspace: string;
  query: string;
  mustHit?: MustHit[];
  shouldNotHit?: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve to apps/server/src/eval/cases/retrieval.yaml regardless of cwd. */
export function defaultRetrievalCasesPath(): string {
  return path.join(__dirname, "cases", "retrieval.yaml");
}

export function defaultSafetyCasesPath(): string {
  return path.join(__dirname, "cases", "safety.yaml");
}

/** Path to the fixtures root — used by the runner to point at a workspace. */
export function fixturesRoot(): string {
  return path.join(__dirname, "fixtures");
}

function loadCasesFile(filePath: string): RetrievalCase[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.parse(raw) as { cases?: unknown };
  const cases = parsed.cases;
  if (!Array.isArray(cases)) {
    throw new Error(`Cases file ${filePath} has no top-level "cases" array`);
  }
  const out: RetrievalCase[] = [];
  for (const raw of cases) {
    const c = raw as Partial<RetrievalCase>;
    if (!c.id || !c.workspace || !c.query) {
      console.warn(`[eval] skipping case missing id/workspace/query: ${JSON.stringify(raw)}`);
      continue;
    }
    out.push({
      id: c.id,
      workspace: c.workspace,
      query: c.query,
      mustHit: c.mustHit ?? [],
      shouldNotHit: c.shouldNotHit ?? [],
    });
  }
  return out;
}

/** Default loader: retrieval.yaml + safety.yaml merged. The harness
 *  treats safety cases identically — they're just `shouldNotHit`
 *  assertions surfaced in the same metrics. */
export function loadRetrievalCases(): RetrievalCase[] {
  return [
    ...loadCasesFile(defaultRetrievalCasesPath()),
    ...loadCasesFile(defaultSafetyCasesPath()),
  ];
}

/** Load just one cases file — used by callers that want to target only
 *  the retrieval set or only the safety set. */
export function loadRetrievalCasesFromFile(filePath: string): RetrievalCase[] {
  return loadCasesFile(filePath);
}

// ── Generation cases (runRagEval) ────────────────────────────────────────

export interface GenerationCase {
  id: string;
  workspace: string;
  query: string;
  requiredContext: string[];
  expectedClaims: string[];
  forbiddenClaims: string[];
  /** True when the correct answer is "I don't know" — context is
   *  intentionally absent / off-topic. */
  expectedAbstention: boolean;
}

export function defaultGenerationCasesPath(): string {
  return path.join(__dirname, "cases", "rag-answer.yaml");
}

export function loadGenerationCases(
  filePath: string = defaultGenerationCasesPath(),
): GenerationCase[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.parse(raw) as { cases?: unknown };
  const cases = parsed.cases;
  if (!Array.isArray(cases)) {
    throw new Error(`Generation cases file ${filePath} has no top-level "cases" array`);
  }
  const out: GenerationCase[] = [];
  for (const raw of cases) {
    const c = raw as Partial<GenerationCase>;
    if (!c.id || !c.workspace || !c.query) {
      console.warn(`[eval] skipping generation case missing id/workspace/query: ${JSON.stringify(raw)}`);
      continue;
    }
    out.push({
      id: c.id,
      workspace: c.workspace,
      query: c.query,
      requiredContext: c.requiredContext ?? [],
      expectedClaims: c.expectedClaims ?? [],
      forbiddenClaims: c.forbiddenClaims ?? [],
      expectedAbstention: c.expectedAbstention === true,
    });
  }
  return out;
}
