import React, { useState } from "react";
import { STARTER_ACTIONS, ToolRunPanel } from "../components/home/StartPane.jsx";
import { COPY } from "../shared/copy/copy";
import { fetchJson } from "../lib/api.js";

const WORKFLOW_APPS = [
  {
    id: "investment_rebalancer",
    titleKey: "investmentTitle",
    bodyKey: "investmentBody",
    input: "portfolio CSV · target allocation · ETF/stock interests",
    output: "rebalance deltas · research report · CSV/Markdown artifacts",
    viewer: "Investment dashboard",
    status: "ready",
  },
  {
    id: "fitness_planner",
    titleKey: "fitnessTitle",
    bodyKey: "fitnessBody",
    input: "goals · food log · exercise log",
    output: "weekly plan · progress report · structured notes",
    viewer: "Planner dashboard",
    status: "planned",
  },
];

export function AppsToolsCatalogPage({ navigate, copy = COPY, home, onHome }) {
  const text = copy.catalog || COPY.catalog;
  const runs = home?.runs || [];
  const [toolPanelAction, setToolPanelAction] = useState(null);
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  async function runTool(action, options = {}) {
    if (running) return;
    const files = Array.from(options.files || []);
    if (action.wantsFile && files.length === 0) {
      setError(copy.home?.attachRequired || "파일 필요.");
      return;
    }
    setRunning(action.id);
    setError("");
    try {
      const form = new FormData();
      form.set("content", String(options.content || action.prompt || action.label || ""));
      form.set("provider", "ollama");
      form.set("model", "qwen3:8b");
      files.forEach((file) => form.append("attachment", file));
      const payload = await fetchJson(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact?.path) {
        const chatPayload = await fetchJson("/api/home-artifact/ask", {
          method: "POST",
          body: new URLSearchParams({ path: firstArtifact.path }),
        });
        navigate(`/chat/${chatPayload.project_path}/${chatPayload.session.slug}`);
      }
      setToolPanelAction(null);
    } catch (err) {
      setError(err.message || "도구 실행 실패.");
    } finally {
      setRunning("");
    }
  }

  async function openWorkflowApp(app) {
    if (app.id !== "investment_rebalancer") return;
    try {
      const payload = await fetchJson("/api/projects/import-template", {
        method: "POST",
        body: new URLSearchParams({ template: "investment-advisor" }),
      });
      navigate(`/project/${payload.project?.path || "investment-advisor"}?tab=apps`);
    } catch {
      navigate("/project/investment-advisor?tab=apps");
    }
  }
  return (
    <section className="center-pane action-library-page apps-tools-page">
      <div className="home-workbench catalog-workbench">
        <div className="home-hero">
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <p>{text.body}</p>
        </div>

        <CatalogSection title={text.tools} body={text.toolsBody}>
          <div className="starter-grid">
            {STARTER_ACTIONS.map((tool) => {
              const localized = copy.starterActions?.[tool.id] ? { ...tool, ...copy.starterActions[tool.id] } : tool;
              return (
                <article className="starter-card catalog-card" key={tool.id}>
                  <div className="starter-card-head">
                    <span className="starter-category">{localized.category}</span>
                    <span className="status-badge ready">{text.oneOffTool}</span>
                  </div>
                  <h3>{localized.label}</h3>
                  <p>{localized.description}</p>
                  <div className="starter-meta">
                    <span>{text.input}: {tool.inputs}</span>
                    <span>{text.output}: {tool.output}</span>
                    <span>{text.viewer}: {tool.viewer || text.answerViewer}</span>
                  </div>
                  <button type="button" onClick={() => setToolPanelAction(localized)}>{text.openTool}</button>
                </article>
              );
            })}
          </div>
          <ToolRunPanel action={toolPanelAction} running={running} onClose={() => setToolPanelAction(null)} onRun={runTool} copy={copy} />
          {error && <div className="system-note">{error}</div>}
        </CatalogSection>

        <CatalogSection title={text.apps} body={text.appsBody}>
          <div className="starter-grid">
            {WORKFLOW_APPS.map((app) => (
              <article className={`starter-card catalog-card ${app.status === "planned" ? "is-disabled" : ""}`} key={app.id}>
                <div className="starter-card-head">
                  <span className="starter-category">{text.workflowApp}</span>
                  <span className={`status-badge ${app.status}`}>{app.status}</span>
                </div>
                <h3>{text[app.titleKey]}</h3>
                <p>{text[app.bodyKey]}</p>
                <div className="starter-meta">
                  <span>{text.input}: {app.input}</span>
                  <span>{text.output}: {app.output}</span>
                  <span>{text.viewer}: {app.viewer}</span>
                </div>
                <button type="button" onClick={() => openWorkflowApp(app)} disabled={app.status === "planned"}>
                  {text.connectProject}
                </button>
              </article>
            ))}
          </div>
        </CatalogSection>

        {runs.length > 0 && (
          <CatalogSection title={text.recentRuns} body={text.dataResourceBody}>
            <div className="run-list compact-catalog-runs">
              {runs.slice(0, 4).map((run) => (
                <div className="run-row" key={run.run_id || run.id}>
                  <strong>{run.label || run.action_id}</strong>
                  <span>{run.status}</span>
                  <small>{run.created_at}</small>
                </div>
              ))}
            </div>
          </CatalogSection>
        )}
      </div>
    </section>
  );
}

function CatalogSection({ title, body, children }) {
  return (
    <section className="starter-actions catalog-section">
      <div className="section-row">
        <div className="panel-title-stack">
          <p className="eyebrow">{title}</p>
          <h2>{title}</h2>
          <p className="muted">{body}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
