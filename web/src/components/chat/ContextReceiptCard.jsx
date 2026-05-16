import React from "react";

export function ContextReceiptCard({ receipt, compact = false }) {
  if (!receipt) return null;
  const used = Array.isArray(receipt.used_files) ? receipt.used_files : [];
  const unused = Array.isArray(receipt.unused_files) ? receipt.unused_files : [];
  const excluded = Array.isArray(receipt.excluded) ? receipt.excluded : [];
  const chunks = Array.isArray(receipt.included_chunks) ? receipt.included_chunks : [];
  const privacy = receipt.privacy || {};
  const analysis = receipt.analysis || {};
  const csv = Array.isArray(analysis.csv) ? analysis.csv : [];
  const artifacts = Array.isArray(analysis.artifacts) ? analysis.artifacts : [];
  const mode = receipt.privacy_mode === "local" ? "local" : receipt.privacy_mode === "network" ? "local + network" : "cloud";
  const cost = `${receipt.estimated_cost ?? 0} ${receipt.currency || "USD"}`;
  const fileLabel = `${used.length} file${used.length === 1 ? "" : "s"}`;

  return (
    <details className={`context-receipt ${compact ? "compact" : ""}`}>
      <summary>
        <span>Context receipt · {mode} · {fileLabel} · {cost}</span>
      </summary>
      <div className="receipt-grid">
        <span><strong>Model</strong><small>{receipt.provider} {receipt.model}</small></span>
        <span><strong>Cost</strong><small>{receipt.estimated_cost ?? 0} {receipt.currency || "USD"}</small></span>
        <span><strong>Tokens</strong><small>{receipt.input_tokens || 0} in · {receipt.output_tokens || 0} out</small></span>
        <span><strong>Network</strong><small>{privacy.network_used ? "Allowed/used" : "Off"}</small></span>
        <span><strong>Used files</strong><small>{used.length ? used.map((item) => item.filename).join(", ") : "None"}</small></span>
        <span><strong>Not used</strong><small>{unused.length ? unused.map((item) => item.filename).join(", ") : "None"}</small></span>
        <span><strong>Cloud files</strong><small>{privacy.files_sent_to_cloud?.length ? privacy.files_sent_to_cloud.join(", ") : "None"}</small></span>
      </div>
      {chunks.length > 0 && (
        <div className="receipt-chunks">
          {chunks.slice(0, 4).map((chunk) => (
            <span key={chunk.chunk_id || `${chunk.path}-${chunk.token_count}`}>
              <strong>{chunk.filename || chunk.path}</strong>
              <small>{chunk.reason} · {chunk.token_count} tokens · {chunk.privacy}</small>
            </span>
          ))}
        </div>
      )}
      {csv.length > 0 && (
        <div className="receipt-chunks">
          {csv.map((item, index) => (
            <span key={`${item.parser || "csv"}-${index}`}>
              <strong>CSV parser: {item.parser || "python-csv"}</strong>
              <small>{item.rows || 0} rows · {item.columns || 0} columns · {item.missing_cells || 0} missing cells · profile sent: {analysis.computed_profile_sent_to_model ? "yes" : "no"} · raw CSV sent: {analysis.raw_text_sent_to_model ? "yes" : "no"}</small>
            </span>
          ))}
          {artifacts.length > 0 && (
            <span>
              <strong>Artifacts</strong>
              <small>{artifacts.map((item) => item.filename || item.path).join(", ")}</small>
            </span>
          )}
        </div>
      )}
      {excluded.length > 0 && <p className="muted">{excluded.length} file/path exclusions were active.</p>}
    </details>
  );
}
