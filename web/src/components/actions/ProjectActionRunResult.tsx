import React from "react";
import type { ArtifactRecord } from "../../shared/contracts/workbench";
import {
  resultDescription,
  resultTitle,
  type ActionRunRecord,
} from "./projectActionRuntime";

export function ProjectActionRunResult({
  result,
  compact = false,
  currentSession = false,
  power = false,
  onOpenArtifact,
}: {
  result: ActionRunRecord;
  compact?: boolean;
  currentSession?: boolean;
  power?: boolean;
  onOpenArtifact?: (artifact: ArtifactRecord) => void;
}) {
  if (compact) {
    return (
      <div className="run-result compact-result">
        <strong>{result.status === "completed" ? "Run completed" : "Run failed"}</strong>
        <p className="muted">{currentSession ? "Result attached to the current chat." : "This result will be available as project context for the next response."}</p>
        {power && <code>{result.run_dir}</code>}
        {result.stdout && <pre>{result.stdout.slice(0, 1200)}</pre>}
        {result.stderr && <pre className="error-text">{result.stderr.slice(0, 1200)}</pre>}
      </div>
    );
  }

  return (
    <div className={`run-result ${result.status === "completed" ? "" : "failed"}`}>
      <strong>{resultTitle(result)}</strong>
      <p className="muted">{resultDescription(result)}</p>
      <code>{result.run_dir}</code>
      {(result.artifacts || []).length > 0 && (
        <div className="artifact-list">
          <strong>Artifacts</strong>
          {(result.artifacts || []).map((item: ArtifactRecord) => (
            <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)} disabled={!item.exists}>
              {item.path} · {item.exists ? `${item.size} bytes` : "not found"}
            </button>
          ))}
        </div>
      )}
      {result.stdout && <pre>{result.stdout.slice(0, 2400)}</pre>}
      {result.stderr && <pre className="error-text">{result.stderr.slice(0, 2400)}</pre>}
      <ResultActions result={result} onOpenArtifact={onOpenArtifact} />
    </div>
  );
}

function ResultActions({ result, onOpenArtifact }: { result: ActionRunRecord; onOpenArtifact?: (artifact: ArtifactRecord) => void }) {
  if (result.status !== "completed") return null;
  const artifacts = (result.artifacts || []).filter((item: ArtifactRecord) => item.exists);
  if (result.kind === "prompt_recipe") {
    return (
      <div className="next-actions">
        <button type="button" onClick={() => navigator.clipboard?.writeText(result.stdout || "")}>Copy prompt</button>
      </div>
    );
  }
  if (artifacts.length > 0) {
    return (
      <div className="next-actions">
        {artifacts.slice(0, 3).map((item) => (
          <button type="button" key={item.path} onClick={() => onOpenArtifact?.(item)}>
            Open file: {item.path.split("/").pop()}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
