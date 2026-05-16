import React, { useEffect, useMemo, useState } from "react";

export function ConnectionsTab({ activePath, connections, fetchJson, onConnections }) {
  const [sourceProject, setSourceProject] = useState("");
  const [resourceTypes, setResourceTypes] = useState([]);
  const [mode, setMode] = useState("read");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sources = useMemo(() => connections?.visibleSources || [], [connections?.visibleSources]);
  const selectedSource = sources.find((item) => item.projectId === sourceProject);
  const exportsList = connections?.exports || [];
  const incoming = connections?.incomingLinks || [];
  const outgoing = connections?.outgoingLinks || [];
  const connected = connections?.connectedResources || [];
  const resolved = connections?.resolvedImports || [];
  const availableTypes = selectedSource?.exports || [];

  useEffect(() => {
    if (!sourceProject && sources[0]) setSourceProject(sources[0].projectId);
  }, [sourceProject, sources]);

  function toggleType(type) {
    setResourceTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  async function submit(action, extra = {}) {
    setBusy(action);
    setError("");
    try {
      const body = new URLSearchParams({ action, ...extra });
      if (action === "request") {
        body.set("source_project", sourceProject);
        body.set("resource_types", resourceTypes.join(","));
        body.set("mode", mode);
      }
      const payload = await fetchJson(`/api/project-connections/${activePath.projectPath}`, { method: "POST", body });
      onConnections?.(payload.connections);
    } catch (err) {
      setError(err.message || "Connection request failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="dashboard-card connections-tab">
      <div className="section-row">
        <div>
          <p className="eyebrow">Project Connections</p>
          <h2>Explicit resource links</h2>
        </div>
        <span className="soft-pill">{connected.length} connected resources</span>
      </div>
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

function LinkList({ title, empty, links, busy, onAction, actionLabel }) {
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
