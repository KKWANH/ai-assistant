import React, { useState } from "react";
import { STARTER_ACTIONS, ToolRunPanel } from "../components/home/StartPane";
import { COPY } from "../shared/copy/copy";
import { fetchJson } from "../lib/api";
import type { HomeAction, HomePayload } from "../shared/contracts/runtime";
import type { ArtifactRecord, RunRecord } from "../shared/contracts/workbench";

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

export function AppsToolsCatalogPage({ navigate, copy = COPY, home, onHome }: {
  navigate: (path: string) => void;
  copy?: typeof COPY;
  home?: HomePayload | null;
  onHome?: (home: HomePayload) => void;
}) {
  const text = copy.catalog || COPY.catalog;
  const textLookup = text as Record<string, string | undefined>;
  const runs = home?.runs || [];
  const catalogTools = catalogItems(home?.actions, "chat_tool", STARTER_ACTIONS);
  const catalogApps = catalogItems(home?.actions, "workflow_app", WORKFLOW_APPS);
  const [toolPanelAction, setToolPanelAction] = useState<HomeAction | null>(null);
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  async function runTool(action: HomeAction, options: { files?: File[]; content?: string } = {}) {
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
      const payload = await fetchJson<{ home: HomePayload; run: RunRecord & { artifacts?: ArtifactRecord[] } }>(`/api/home-actions/${action.id}/run`, { method: "POST", body: form });
      onHome?.(payload.home);
      const firstArtifact = payload.run?.artifacts?.[0];
      if (firstArtifact?.path) {
        const chatPayload = await fetchJson<{ project_path: string; session: { slug: string } }>("/api/home-artifact/ask", {
          method: "POST",
          body: new URLSearchParams({ path: firstArtifact.path }),
        });
        navigate(`/chat/${chatPayload.project_path}/${chatPayload.session.slug}`);
      }
      setToolPanelAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "도구 실행 실패.");
    } finally {
      setRunning("");
    }
  }

  async function openWorkflowApp(app: HomeAction) {
    if (app.id !== "investment_rebalancer") return;
    try {
      const payload = await fetchJson<{ project?: { path?: string } }>("/api/projects/import-template", {
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
            {catalogTools.map((tool) => {
              const localized = (copy.starterActions as Record<string, Partial<HomeAction>> | undefined)?.[tool.id] ? { ...tool, ...(copy.starterActions as Record<string, Partial<HomeAction>>)[tool.id] } : tool;
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
            {catalogApps.map((app) => (
              <article className={`starter-card catalog-card ${app.status === "planned" ? "is-disabled" : ""}`} key={app.id}>
                <div className="starter-card-head">
                  <span className="starter-category">{text.workflowApp}</span>
                  <span className={`status-badge ${app.status}`}>{app.status}</span>
                </div>
                <h3>{textLookup[String(app.titleKey)] || app.title || app.label}</h3>
                <p>{textLookup[String(app.bodyKey)] || app.description}</p>
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
                <div className="run-row" key={run.run_id || run.action_id || `${run.created_at}-${run.status}`}>
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

function catalogItems(actions: HomeAction[] = [], resourceType: string, fallback: HomeAction[] = []): HomeAction[] {
  const source = Array.isArray(actions) && actions.length
    ? actions.filter((item) => (item.resource_type || item.tool_type) === resourceType)
    : fallback;
  return source.map((item) => {
    const base = (fallback.find((fallbackItem) => fallbackItem.id === item.id) || {}) as HomeAction;
    return {
      ...base,
      ...item,
      label: item.label || item.title || base.label || base.title,
      title: item.title || item.label || base.title || base.label,
      input: Array.isArray(item.inputs) ? item.inputs.join(" · ") : item.input || base.input || item.inputs,
      output: Array.isArray(item.expected_output_artifacts) ? item.expected_output_artifacts.join(" · ") : item.output || base.output,
      viewer: item.workflow_app?.defaultViewerLayout?.[0]?.viewer_id || base.viewer || "Viewer",
      wantsFile: Array.isArray(item.inputs) && item.inputs.some((value) => String(value).startsWith(".")),
    };
  });
}

function CatalogSection({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
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
