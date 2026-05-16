import React from "react";
import { STARTER_ACTIONS } from "../components/home/StartPane.jsx";
import { COPY } from "../shared/copy/copy";

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

export function AppsToolsCatalogPage({ navigate, copy = COPY, home, projects = [] }) {
  const text = copy.catalog || COPY.catalog;
  const runs = home?.runs || [];
  const recommendedProjects = projects.filter((project) => !project.hidden).slice(0, 4);
  return (
    <section className="center-pane action-library-page apps-tools-page">
      <div className="home-workbench">
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
                  <button type="button" onClick={() => navigate("/")}>{text.openTool}</button>
                </article>
              );
            })}
          </div>
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
                <button type="button" onClick={() => navigate("/project/investment-advisor")} disabled={app.status === "planned"}>
                  {text.connectProject}
                </button>
              </article>
            ))}
          </div>
        </CatalogSection>

        <section className="home-object-panels" aria-label={text.recentRuns}>
          <div className="dashboard-card">
            <div className="section-row">
              <div className="panel-title-stack"><p className="eyebrow">{text.recentRuns}</p><h2>{text.dataResourceTitle}</h2></div>
              <span className="soft-pill">{runs.length}</span>
            </div>
            {runs.length === 0 ? (
              <div className="empty-action-state"><p className="muted">{text.noRuns}</p><span>{text.dataResourceBody}</span></div>
            ) : (
              <div className="run-list">
                {runs.slice(0, 6).map((run) => (
                  <div className="run-row" key={run.run_id || run.id}>
                    <strong>{run.label || run.action_id}</strong>
                    <span>{run.status}</span>
                    <small>{run.created_at}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="dashboard-card">
            <div className="section-row">
              <div className="panel-title-stack"><p className="eyebrow">{text.recommendedProjects}</p><h2>{text.apps}</h2></div>
              <span className="soft-pill">{recommendedProjects.length}</span>
            </div>
            <div className="artifact-grid">
              {recommendedProjects.map((project) => (
                <button className="artifact-tile clickable-row" type="button" key={project.path} onClick={() => navigate(`/project/${project.path}`)}>
                  <strong>{project.title}</strong>
                  <span>{text.workflowApp}</span>
                  <small>{project.sessions?.length || 0} chats</small>
                </button>
              ))}
            </div>
          </div>
        </section>
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
