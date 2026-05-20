import crypto from "node:crypto";
import type { Claim, ClaimStatus, EvidencePack, RunDiff } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import type { FocusedFile } from "../gasp/filter.js";

interface RawClaim {
  text?: string;
  status?: string;
  sources?: Array<{ path?: string; locator?: string; excerpt?: string }>;
  reason?: string;
  missingEvidence?: string;
  suggestedSourceType?: string;
  conservativeRewrite?: string;
}

const VALID_STATUSES = new Set<ClaimStatus>(["supported", "partially_supported", "inferred", "unsupported"]);

function normaliseStatus(s: unknown): ClaimStatus {
  if (typeof s === "string" && VALID_STATUSES.has(s as ClaimStatus)) {
    return s as ClaimStatus;
  }
  return "inferred";
}

/** Extract claims from the brief and map them to sources using the provider. */
export async function extractAndMapClaims(
  runId: string,
  brief: string,
  focusedFiles: FocusedFile[],
  provider: AiProvider
): Promise<Claim[]> {
  const sourceContext = focusedFiles
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const system = `You are an evidence analyst for the Ariadne workspace tool.
Extract all important claims from the brief and map each to its source files.
Assign each claim one of: supported, partially_supported, inferred, unsupported.
For unsupported/weak claims, add: reason, missingEvidence, suggestedSourceType, conservativeRewrite.
Return ONLY a JSON object: { "claims": [ { "text", "status", "sources": [{"path","locator","excerpt"}], "reason"?, "missingEvidence"?, "suggestedSourceType"?, "conservativeRewrite"? } ] }`;

  const prompt = `Brief:
${brief}

Source files:
${sourceContext}`;

  const { text } = await provider.complete({ system, prompt, json: true });

  try {
    const raw = extractJson(text);
    const parsed = JSON.parse(raw) as { claims?: RawClaim[] };
    const claims = parsed.claims;
    if (!Array.isArray(claims)) return [];

    return claims.map((c) => {
      const claim: Claim = {
        id: crypto.randomUUID(),
        runId,
        text: c.text ?? "",
        status: normaliseStatus(c.status),
        sources: (c.sources ?? []).map((s) => ({
          path: s.path ?? "",
          locator: s.locator ?? "",
          excerpt: s.excerpt ?? "",
        })),
        reason: c.reason,
        missingEvidence: c.missingEvidence,
        suggestedSourceType: c.suggestedSourceType,
        conservativeRewrite: c.conservativeRewrite,
      };
      return claim;
    });
  } catch {
    return [];
  }
}

/** Render the unsupported-claims markdown artifact. */
export function renderUnsupportedClaims(claims: Claim[]): string {
  const unsupported = claims.filter(
    (c) => c.status === "unsupported" || c.status === "partially_supported"
  );

  if (unsupported.length === 0) {
    return "# Unsupported Claims\n\nNo unsupported claims were identified in this run.\n";
  }

  const lines = ["# Unsupported Claims\n"];

  for (const c of unsupported) {
    lines.push(`## ${c.status === "unsupported" ? "Unsupported" : "Partially Supported"} Claim\n`);
    lines.push(`**Claim:** ${c.text}\n`);
    if (c.reason) lines.push(`**Reason:** ${c.reason}\n`);
    if (c.missingEvidence) lines.push(`**Missing evidence:** ${c.missingEvidence}\n`);
    if (c.suggestedSourceType) lines.push(`**Suggested source type:** ${c.suggestedSourceType}\n`);
    if (c.conservativeRewrite) lines.push(`**Suggested rewrite:** ${c.conservativeRewrite}\n`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Build an EvidencePack from claims. */
export function buildEvidencePack(runId: string, claims: Claim[]): EvidencePack {
  return { runId, claims };
}

// ---------------------------------------------------------------------------
// Re-run diff
// ---------------------------------------------------------------------------

/** Generate a diff summary between the current run and a previous one. */
export async function computeRunDiff(
  runId: string,
  previousRunId: string,
  currentClaims: Claim[],
  previousClaims: Claim[],
  currentFiles: string[],
  previousFiles: string[],
  provider: AiProvider
): Promise<RunDiff> {
  const prevFileSet = new Set(previousFiles);
  const currFileSet = new Set(currentFiles);

  const newFiles = currentFiles.filter((f) => !prevFileSet.has(f));
  const removedFiles = previousFiles.filter((f) => !currFileSet.has(f));
  // Modified files: in both sets (file hash change is not tracked at this level)
  const modifiedFiles: string[] = [];

  const prevTexts = new Set(previousClaims.map((c) => c.text));
  const currTexts = new Set(currentClaims.map((c) => c.text));

  const newClaims = currentClaims.filter((c) => !prevTexts.has(c.text)).map((c) => c.text);
  const removedClaims = previousClaims.filter((c) => !currTexts.has(c.text)).map((c) => c.text);

  const prevUnsupported = new Set(
    previousClaims.filter((c) => c.status === "unsupported").map((c) => c.text)
  );
  const currUnsupported = new Set(
    currentClaims.filter((c) => c.status === "unsupported").map((c) => c.text)
  );

  const newUnsupported = [...currUnsupported].filter((t) => !prevUnsupported.has(t));
  const resolvedUnsupported = [...prevUnsupported].filter((t) => !currUnsupported.has(t));

  // Ask the provider for a narrative summary
  const system = `You are a diff analyst for Ariadne. Summarise what changed between two runs in 2-3 sentences.
Return ONLY a JSON object: { "changedConclusions": string[], "summary": string }`;

  const prompt = `New files: ${JSON.stringify(newFiles)}
Removed files: ${JSON.stringify(removedFiles)}
New claims: ${JSON.stringify(newClaims)}
Removed claims: ${JSON.stringify(removedClaims)}
New unsupported: ${JSON.stringify(newUnsupported)}
Resolved unsupported: ${JSON.stringify(resolvedUnsupported)}`;

  let changedConclusions: string[] = [];
  let summary = "No significant changes detected between runs.";

  try {
    const { text } = await provider.complete({ system, prompt, json: true });
    const raw = extractJson(text);
    const parsed = JSON.parse(raw) as { changedConclusions?: string[]; summary?: string };
    changedConclusions = parsed.changedConclusions ?? [];
    summary = parsed.summary ?? summary;
  } catch {
    // fallback summary
  }

  return {
    runId,
    previousRunId,
    newFiles,
    removedFiles,
    modifiedFiles,
    newClaims,
    removedClaims,
    changedConclusions,
    newUnsupported,
    resolvedUnsupported,
    summary,
  };
}

/** Render diff as a markdown artifact. */
export function renderDiff(diff: RunDiff): string {
  const lines = ["# Diff from Previous Run\n"];

  if (diff.newFiles.length > 0) {
    lines.push("## New Files Considered");
    diff.newFiles.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  if (diff.removedFiles.length > 0) {
    lines.push("## Removed Files");
    diff.removedFiles.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  if (diff.changedConclusions.length > 0) {
    lines.push("## Changed Conclusions");
    diff.changedConclusions.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (diff.newClaims.length > 0) {
    lines.push("## New Claims");
    diff.newClaims.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (diff.removedClaims.length > 0) {
    lines.push("## Removed Claims");
    diff.removedClaims.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (diff.newUnsupported.length > 0) {
    lines.push("## New Unsupported Claims");
    diff.newUnsupported.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (diff.resolvedUnsupported.length > 0) {
    lines.push("## Resolved Unsupported Claims");
    diff.resolvedUnsupported.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(diff.summary);

  return lines.join("\n");
}
