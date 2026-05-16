import React, { useEffect, useMemo, useState } from "react";
import styles from "./ProjectDashboard.module.css";
import type { ProjectConnectionsPayload, ProjectLink } from "../../shared/contracts/workbench";
import { useProjectConnections, useProjectLinkMutations } from "../../shared/hooks/useProjectConnections";

type ActiveProjectPath = { projectPath: string };
type ConnectionAction = "request" | "approve" | "revoke";
type LinkActionLabel = string | ((link: ProjectLink) => string);
type ConnectionsTabProps = {
  activePath: ActiveProjectPath;
  connections?: ProjectConnectionsPayload | null;
  fetchJson?: (url: string, init?: RequestInit) => Promise<{ connections?: ProjectConnectionsPayload }>;
  onConnections?: (connections: ProjectConnectionsPayload) => void;
};

export function ConnectionsTab({ activePath, connections, onConnections }: ConnectionsTabProps) {
  const [sourceProject, setSourceProject] = useState("");
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [mode, setMode] = useState("read");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const connectionQuery = useProjectConnections(activePath.projectPath, connections);
  const mutations = useProjectLinkMutations(activePath.projectPath, onConnections);
  const currentConnections = connectionQuery.data || connections;
  const sources = useMemo(() => currentConnections?.visibleSources || [], [currentConnections?.visibleSources]);
  const selectedSource = sources.find((item) => item.projectId === sourceProject);
  const exportsList = currentConnections?.exports || [];
  const incoming = currentConnections?.incomingLinks || [];
  const outgoing = currentConnections?.outgoingLinks || [];
  const connected = currentConnections?.connectedResources || [];
  const resolved = currentConnections?.resolvedImports || [];
  const availableTypes = selectedSource?.exports || [];

  useEffect(() => {
    if (!sourceProject && sources[0]) setSourceProject(sources[0].projectId);
  }, [sourceProject, sources]);

  function toggleType(type: string) {
    setResourceTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  async function submit(action: ConnectionAction, extra: Record<string, string> = {}) {
    setBusy(action);
    setError("");
    try {
      const body = new URLSearchParams({ action, ...extra });
      if (action === "request") {
        await mutations.request.mutateAsync({ sourceProject, resourceTypes, mode });
      } else if (action === "approve") {
        await mutations.approve.mutateAsync(body.get("link_id") || "");
      } else if (action === "revoke") {
        await mutations.revoke.mutateAsync(body.get("link_id") || "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection request failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={`${styles["dashboard-card"]} connections-tab`}>
      <div className="section-row">
        <div>
          <p className="eyebrow">Project Connections</p>
          <h2>Explicit resource links</h2>
        </div>
        <span className="soft-pill">{connected.length} connected resources</span>
      </div>
      {connectionQuery.isFetching && <p className="muted">Refreshing connections...</p>}
      <p className="muted">
        Projects do not inherit data from each other. Connect exported resources with an approved link instead of adding deeper nested projects.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="connections-grid">
        <div className="connection-panel">
          <h3>Exports from this project</h3>
          {exportsList.length === 0 ? <p className="muted">No exportable resources yet.</p> : (
            <div className="resource-list">
              {exportsList.map((item) => (
                <span key={`${item.resourceType}-${item.artifactPattern}`}>
                  <strong>{item.label || item.resourceType}</strong>
                  <small>{item.resourceType} · {item.artifactPattern} · schema v{item.schemaVersion}</small>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="connection-panel">
          <h3>Request an import</h3>
          {sources.length === 0 ? <p className="muted">No visible source projects with export metadata.</p> : (
            <>
              <label>
                Source project
                <select value={sourceProject} onChange={(event) => { setSourceProject(event.target.value); setResourceTypes([]); }}>
                  {sources.map((item) => <option key={item.projectId} value={item.projectId}>{item.title} · {item.projectId}</option>)}
                </select>
              </label>
              <div className="resource-checkboxes">
                {availableTypes.map((item) => (
                  <label key={item.resourceType}>
                    <input type="checkbox" checked={resourceTypes.includes(item.resourceType)} onChange={() => toggleType(item.resourceType)} />
                    <span>{item.label || item.resourceType}<small>{item.artifactPattern}</small></span>
                  </label>
                ))}
              </div>
              <label>
                Mode
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="read">read</option>
                  <option value="append">append</option>
                  <option value="compute">compute</option>
                </select>
              </label>
              <button type="button" onClick={() => submit("request")} disabled={busy === "request" || !sourceProject || resourceTypes.length === 0}>
                {busy === "request" ? "Requesting..." : "Request connection"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="connections-grid">
        <LinkList
          title="Incoming import links"
          empty="No source project has granted this project a resource link."
          links={incoming}
          actionLabel="Revoke"
          busy={busy}
          onAction={(link) => submit("revoke", { link_id: link.linkId })}
        />
        <LinkList
          title="Outgoing grants"
          empty="No outgoing exports have been requested or approved."
          links={outgoing}
          busy={busy}
          onAction={(link) => link.status === "pending" ? submit("approve", { link_id: link.linkId }) : submit("revoke", { link_id: link.linkId })}
          actionLabel={(link) => link.status === "pending" ? "Approve" : "Revoke"}
        />
      </div>
      <div className="connection-panel connected-resource-panel">
        <h3>Connected resources available here</h3>
        {connected.length === 0 ? <p className="muted">Approved imports will appear here and can be used by Workflow Apps without exposing unrelated project data.</p> : (
          <div className="resource-list">
            {connected.map((item) => (
              <span key={`${item.linkId}-${item.resourceType}`}>
                <strong>{item.label || item.resourceType}</strong>
                <small>{item.sourceProjectId} · {item.mode} · {item.artifactPattern}</small>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="connection-panel connected-resource-panel">
        <h3>Runtime aliases for Workflow Apps</h3>
        {resolved.length === 0 ? <p className="muted">No approved import alias is ready for execution.</p> : (
          <div className="resource-list">
            {resolved.map((item) => (
              <span key={`${item.linkId}-${item.localAlias}`}>
                <strong>{item.localAlias}</strong>
                <small>{item.sourceProjectId} · {item.resourceType} · {item.latestArtifact?.path || "no artifact yet"}</small>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LinkList({
  title,
  empty,
  links,
  busy,
  onAction,
  actionLabel,
}: {
  title: string;
  empty: string;
  links: ProjectLink[];
  busy: string;
  onAction: (link: ProjectLink) => void;
  actionLabel: LinkActionLabel;
}) {
  return (
    <div className="connection-panel">
      <h3>{title}</h3>
      {links.length === 0 ? <p className="muted">{empty}</p> : (
        <div className="link-list">
          {links.map((link) => (
            <div className="link-row" key={link.linkId}>
              <div>
                <strong>{link.fromProject} → {link.toProject}</strong>
                <small>{(link.allowedResourceTypes || []).join(", ")} · {link.mode} · {link.status}</small>
              </div>
              <button type="button" onClick={() => onAction(link)} disabled={busy === "approve" || busy === "revoke"}>
                {typeof actionLabel === "function" ? actionLabel(link) : actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
