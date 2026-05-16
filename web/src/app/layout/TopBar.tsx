import { useState } from "react";
import type { ReactNode } from "react";
import { copyForAccount } from "../../shared/copy/copy";
import type { AccountSummary } from "../../entities/workspace/types";

type RuntimeState = {
  cloudflare_url?: string;
  status?: string;
};

type ActivePath = {
  projectPath?: string;
  sessionSlug?: string;
};

type ChatState = {
  project?: {
    title?: string;
    hidden?: boolean;
  };
  session?: {
    title?: string;
  };
};

export type TopBarProps = {
  children?: ReactNode;
  runtime?: RuntimeState | null;
  account?: AccountSummary | null;
  activePath?: ActivePath | null;
  chat?: ChatState | null;
  contextOpen?: boolean;
  onToggleContext?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
};

function isPowerMode(account?: AccountSummary | null) {
  return (account?.profile?.ui_mode || (account?.admin ? "power" : "easy")) === "power";
}

export function TopBar({
  children,
  runtime,
  account,
  activePath,
  chat,
  contextOpen = false,
  onToggleContext,
  sidebarOpen = true,
  onToggleSidebar,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const url = runtime?.cloudflare_url || "";
  const power = isPowerMode(account);
  const operator = power && Boolean(account?.admin);
  const copy = copyForAccount(account);
  const context = activePath?.sessionSlug
    ? chat?.project?.hidden
      ? "General chat"
      : `${chat?.project?.title || "Project"} / ${chat?.session?.title || activePath.sessionSlug}`
    : "Private AI Cockpit";

  if (children) return <>{children}</>;

  return (
    <header className="topbar">
      <button
        className="sidebar-toggle"
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-pressed={sidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>
      <a className="brand" href="/">
        <span className="brand-mark" /> {copy.productName}
      </a>
      <span className="local-badge">{copy.topbar.localFirst}</span>
      <span className="top-context">{context}</span>
      <span
        className={`mode-chip ${power ? "power" : "easy"}`}
        title={`${copy.topbar.modeLabel}: ${power ? "Power" : "Easy"}`}
        aria-label={`${copy.topbar.modeLabel}: ${power ? "Power" : "Easy"}`}
      >
        <span />
        <b>{power ? "Power" : "Easy"}</b>
      </span>
      <button
        className={`context-toggle icon-only ${contextOpen ? "active" : ""}`}
        type="button"
        onClick={onToggleContext}
        aria-label={contextOpen ? copy.topbar.contextOpen : copy.topbar.contextClosed}
        aria-pressed={contextOpen}
      >
        <span />
        <i />
      </button>
      <button
        className={`runtime-pill ${power ? "" : "dot-only"}`}
        type="button"
        onClick={() => operator && setOpen(!open)}
        aria-label={operator ? `Runtime ${runtime?.status || "local"}` : "Connected"}
        aria-expanded={open}
      >
        <span className="status-lamp" />
        {power ? runtime?.status || "local" : ""}
      </button>
      {operator && open && (
        <div className="runtime-popover">
          <strong>Runtime</strong>
          <p>{runtime?.status || "local"}</p>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          ) : (
            <span>No public tunnel URL.</span>
          )}
          <code>aiws-cloudflare status</code>
        </div>
      )}
    </header>
  );
}
