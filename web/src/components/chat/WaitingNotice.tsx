import React from "react";

export function WaitingNotice({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`waiting-notice ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="orbital-loader" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  );
}
