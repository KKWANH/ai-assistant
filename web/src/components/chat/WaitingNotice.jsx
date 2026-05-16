import React from "react";

export function WaitingNotice({ label, compact = false }) {
  const details = [
    "Request accepted",
    "Preparing files and context",
    "Calling selected model",
    "Saving receipt and response",
  ];
  return (
    <div className={`waiting-notice ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="orbital-loader" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
      <small>{details.join(" · ")}</small>
    </div>
  );
}
