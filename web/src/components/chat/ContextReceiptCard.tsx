import React, { useState } from "react";
import type { ContextReceipt } from "../../shared/contracts/workbench";

type ReceiptFile = { filename?: string; path?: string };
type ReceiptChunk = {
  source_id?: string;
  chunk_id?: string;
  path?: string;
  filename?: string;
  reason?: string;
  token_count?: number;
  privacy?: string;
  matched_terms?: string[];
  rerank_score?: number;
  vector_score?: number;
  text_preview?: string;
  linked_alias?: string;
  linked_project?: string;
  resource_type?: string;
};
type ReceiptCsv = {
  parser?: string;
  rows?: number;
  columns?: number;
  missing_cells?: number;
};
type ReceiptArtifact = { filename?: string; path?: string };
type ReceiptAnalysis = {
  csv?: ReceiptCsv[];
  artifacts?: ReceiptArtifact[];
  computed_profile_sent_to_model?: boolean;
  raw_text_sent_to_model?: boolean;
};
type ReceiptPrivacy = {
  network_used?: boolean;
  files_sent_to_cloud?: string[];
};
type ContextReceiptCardProps = {
  receipt?: (Omit<ContextReceipt, "included_chunks"> & {
    used_files?: ReceiptFile[];
    unused_files?: ReceiptFile[];
    excluded?: string[];
    included_chunks?: ReceiptChunk[];
    analysis?: ReceiptAnalysis;
    privacy?: ReceiptPrivacy;
    currency?: string;
  }) | null;
  compact?: boolean;
};

export function ContextReceiptCard({ receipt, compact = false }: ContextReceiptCardProps) {
  const [selectedChunk, setSelectedChunk] = useState<ReceiptChunk | null>(null);
  const [pinnedChunks, setPinnedChunks] = useState<ReceiptChunk[]>([]);
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
  const isPinned = (chunk: ReceiptChunk) => pinnedChunks.some((item) => chunkKey(item) === chunkKey(chunk));
  const togglePinned = (chunk: ReceiptChunk) => {
    setPinnedChunks((current) => {
      if (current.some((item) => chunkKey(item) === chunkKey(chunk))) {
        return current.filter((item) => chunkKey(item) !== chunkKey(chunk));
      }
      return [...current, chunk].slice(-4);
    });
  };

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
            <div className="receipt-source-row" key={chunkKey(chunk)}>
              <button
                type="button"
                className="receipt-source-button"
                onClick={() => setSelectedChunk(chunk)}
              >
                <strong>{chunk.source_id ? `[${chunk.source_id}] ` : ""}{chunk.filename || chunk.path}</strong>
                <small>
                  {chunk.reason || "retrieved"} · {chunk.token_count} tokens · {chunk.privacy}
                  {chunk.linked_alias ? ` · linked:${chunk.linked_alias}` : ""}
                  {typeof chunk.rerank_score === "number" ? ` · score ${chunk.rerank_score}` : ""}
                  {chunk.matched_terms?.length ? ` · ${chunk.matched_terms.join(", ")}` : ""}
                </small>
              </button>
              <button type="button" className={`receipt-pin-button ${isPinned(chunk) ? "active" : ""}`} onClick={() => togglePinned(chunk)}>
                {isPinned(chunk) ? "Pinned" : "Pin"}
              </button>
            </div>
          ))}
        </div>
      )}
      {selectedChunk && (
        <div className="source-drawer-backdrop" role="presentation" onClick={() => setSelectedChunk(null)}>
          <aside className="source-drawer" aria-label="Source preview" onClick={(event) => event.stopPropagation()}>
            <div className="source-drawer-header">
              <span>Source</span>
              <div>
                <button type="button" onClick={() => togglePinned(selectedChunk)}>{isPinned(selectedChunk) ? "Unpin" : "Pin"}</button>
                <button type="button" onClick={() => setSelectedChunk(null)}>Close</button>
              </div>
            </div>
            <h3>{selectedChunk.source_id ? `[${selectedChunk.source_id}] ` : ""}{selectedChunk.filename || selectedChunk.path}</h3>
            <dl>
              <div><dt>Path</dt><dd>{selectedChunk.path || "unknown"}</dd></div>
              {selectedChunk.linked_alias && <div><dt>Linked alias</dt><dd>{selectedChunk.linked_alias}</dd></div>}
              {selectedChunk.linked_project && <div><dt>Source project</dt><dd>{selectedChunk.linked_project}</dd></div>}
              {selectedChunk.resource_type && <div><dt>Resource</dt><dd>{selectedChunk.resource_type}</dd></div>}
              {typeof selectedChunk.rerank_score === "number" && <div><dt>Score</dt><dd>{selectedChunk.rerank_score}</dd></div>}
              {selectedChunk.matched_terms?.length && <div><dt>Matched</dt><dd>{selectedChunk.matched_terms.join(", ")}</dd></div>}
            </dl>
            <pre>{selectedChunk.text_preview || "No preview stored."}</pre>
            {pinnedChunks.length > 0 && (
              <section className="source-drawer-pins" aria-label="Pinned source comparison">
                <div className="source-drawer-section-title">
                  <strong>Pinned sources</strong>
                  <button type="button" onClick={() => setPinnedChunks([])}>Clear</button>
                </div>
                <div className="source-compare-grid">
                  {pinnedChunks.map((chunk) => (
                    <article key={chunkKey(chunk)}>
                      <div>
                        <strong>{chunk.source_id ? `[${chunk.source_id}] ` : ""}{chunk.filename || chunk.path}</strong>
                        <button type="button" onClick={() => setSelectedChunk(chunk)}>Open</button>
                      </div>
                      <small>
                        {chunk.linked_alias ? `linked:${chunk.linked_alias} · ` : ""}
                        {typeof chunk.rerank_score === "number" ? `score ${chunk.rerank_score}` : chunk.reason || "source"}
                      </small>
                      <pre>{chunk.text_preview || "No preview stored."}</pre>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </aside>
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

function chunkKey(chunk: ReceiptChunk): string {
  return chunk.chunk_id || `${chunk.source_id || ""}:${chunk.path || chunk.filename || ""}:${chunk.token_count || ""}`;
}
