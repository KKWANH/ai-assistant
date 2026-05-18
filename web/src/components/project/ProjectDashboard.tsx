import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { actionStatus, ProjectWorkflowAppsPanel } from "../actions/ActionPanels";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { ConnectionsTab } from "./ConnectionsTab";
import styles from "./ProjectDashboard.module.css";
import { COPY } from "../../shared/copy/copy";
import { ACTION_KINDS, AGENT_STEP_KINDS, PANEL_TYPES, normalizeActionDefinition, normalizePanelDefinition } from "../../workbenchContracts";
import { ViewerPane } from "../../features/workflow/components/ViewerPane";
import { ChatDock } from "../../features/workflow/components/ChatDock";
import { fetchJson } from "../../lib/api";
import { queryKeys } from "../../shared/api/client";
import type { ProjectSummary } from "../../entities/project/types";
import type { ActivePath, ArtifactPayload, ProjectConfigState, RunDetail } from "../../shared/contracts/runtime";
import type { ArtifactRecord, ProjectConnectionsPayload, RunRecord } from "../../shared/contracts/workbench";
import type { WorkflowActionDefinition } from "../../shared/contracts/workflow-app";

const localClass = (name: string) => styles[name] || name;
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).map((name) => localClass(String(name))).join(" ");

type CopyShape = typeof COPY;
type DashboardAction = WorkflowActionDefinition & Record<string, unknown>;
type PanelItem = Record<string, unknown>;
type CommandEntry = [string, Record<string, unknown>];
type ArtifactWithRun = ArtifactRecord & { run: RunRecord; exists?: boolean; size?: number };
type ProjectRecord = Record<string, unknown> & { security?: { local_only?: boolean }; notes?: string };
type ConfigRecord = Record<string, unknown> & {
  name?: string;
  description?: string;
  commands?: Record<string, Record<string, unknown>>;
  panels?: unknown[];
  context?: Record<string, unknown>;
};

type ProjectDashboardProps = {
  activePath: ActivePath;
  projectConfig: ProjectConfigState;
  project?: ProjectSummary;
  power: boolean;
  activeAppId?: string;
  onProjectConfig?: React.Dispatch<React.SetStateAction<ProjectConfigState>>;
  navigate?: (path: string) => void;
  copy?: CopyShape;
};

export function ProjectDashboard({ activePath, projectConfig, project, power, activeAppId, onProjectConfig, navigate, copy = COPY }: ProjectDashboardProps) {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [artifact, setArtifact] = useState<ArtifactPayload | null>(null);
  const [modalError, setModalError] = useState("");
  const [activeTab, setActiveTab] = useState(() => activeAppId ? "apps" : new URLSearchParams(window.location.search).get("tab") || "chats");
  const investmentDashboardRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const [connections, setConnections] = useState<ProjectConnectionsPayload | null>(projectConfig?.connections || null);
  const projectRecord = (projectConfig?.project || project || {}) as ProjectRecord;
  const [localOnly, setLocalOnly] = useState(Boolean(projectRecord?.security?.local_only));
  const config = (projectConfig?.config || {}) as ConfigRecord;
  const runs = projectConfig?.runs || [];
  const commands = Object.entries(config.commands || {}) as CommandEntry[];
  const actions = commands.map(([name, command]) => normalizeActionDefinition(name, command) as DashboardAction);
  const panels = ((config.panels || []) as unknown[]).map((panel: unknown) => normalizePanelDefinition((panel && typeof panel === "object" ? panel : {}) as Record<string, unknown>) as PanelItem);
  const context = (config.context || {}) as Record<string, unknown>;
  const artifacts = runs.flatMap((run) => (run.artifacts || []).map((item) => ({ ...item, run }))) as ArtifactWithRun[];
  const chatInsights = useMemo(() => summarizeProjectChats(project), [project]);
  const isInvestmentAdvisor = /investment advisor|investment rebalancer|portfolio/i.test(`${config.name || ""} ${config.description || ""}`);
  const text = copy.projectDashboard || COPY.projectDashboard;
  const securityMutation = useMutation({
    mutationFn: async (nextLocalOnly: boolean) => {
      const body = new URLSearchParams();
      body.set("local_only", nextLocalOnly ? "1" : "0");
      return fetchJson<{ project: Record<string, unknown> }>(`/api/project-config/${activePath.projectPath}/security`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    },
    onSuccess: (payload) => {
      const nextProject = (payload.project || {}) as ProjectRecord;
      setLocalOnly(Boolean(nextProject.security?.local_only));
      onProjectConfig?.((current: ProjectConfigState) => ({ ...(current || {}), project: payload.project } as NonNullable<ProjectConfigState>));
      if (activePath.projectPath) void queryClient.invalidateQueries({ queryKey: queryKeys.projectConfig(activePath.projectPath) });
    },
    onError: (err) => setModalError(err instanceof Error ? err.message : String(err)),
  });

  function focusInvestmentDashboard() {
    setActiveTab("apps");
    window.setTimeout(() => investmentDashboardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  }

  useEffect(() => {
    setConnections(projectConfig?.connections || null);
  }, [projectConfig?.connections]);

  useEffect(() => {
    const record = (projectConfig?.project || project || {}) as ProjectRecord;
    setLocalOnly(Boolean(record.security?.local_only));
  }, [projectConfig?.project, project]);

  useEffect(() => {
    if (activeTab === "runs") setActiveTab("artifacts");
  }, [activeTab]);

  useEffect(() => {
    if (activeAppId) setActiveTab("apps");
  }, [activeAppId]);

  async function openRun(run: RunRecord) {
    setModalError("");
    try {
      const payload = await fetchJson<RunDetail>(`/api/project-run?project=${encodeURIComponent(activePath.projectPath || "")}&run_id=${encodeURIComponent(run.run_id)}`);
      setRunDetail(payload);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openArtifact(item: ArtifactRecord) {
    setModalError("");
    try {
      const payload = await fetchJson<{ artifact: ArtifactPayload }>(`/api/project-artifact?project=${encodeURIComponent(activePath.projectPath || "")}&path=${encodeURIComponent(item.path)}`);
      setArtifact(payload.artifact);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className={cx("project-dashboard")}>
      <div className={cx("project-dashboard-hero")}>
        <p className="eyebrow">{text.eyebrow}</p>
        <h1>{config.name || project?.title || activePath.projectPath}</h1>
        <p>{config.description || projectRecord.notes || COPY.tagline}</p>
      </div>

      <section className={cx("dashboard-card", "workbench-operating-model")}>
        <div>
          <p className="eyebrow">{text.operatingEyebrow}</p>
          <h2>{text.operatingTitle}</h2>
          <p className="muted">{text.operatingBody}</p>
        </div>
        <div className={cx("operating-steps")} aria-label="AIWS operating loop">
          {text.operatingSteps.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <div className={cx("project-tabbar")} role="tablist" aria-label="Project dashboard sections">
        {!activeAppId && [
          ["overview", "Overview"],
          ["chats", "Chats"],
          ["files", "Files"],
          ["apps", "Workflow Apps"],
          ["artifacts", "Artifacts"],
          ["connections", "Linked Resources"],
          ["settings", "Settings"],
        ].map(([id, label]) => (
          <button key={id} type="button" className={activeTab === id ? cx("active") : ""} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
        {activeAppId && (
          <button type="button" className={cx("active")} onClick={() => navigate?.(`/project/${activePath.projectPath}`)}>
            Workflow App · {activeAppId}
          </button>
        )}
      </div>

      {activeTab === "connections" && (
        <ConnectionsTab
          activePath={activePath}
          connections={connections}
          fetchJson={fetchJson}
          onConnections={(next: ProjectConnectionsPayload) => {
            setConnections(next);
            onProjectConfig?.((current: ProjectConfigState) => ({ ...(current || {}), connections: next } as NonNullable<ProjectConfigState>));
          }}
        />
      )}

      {activeTab === "overview" && <div className={cx("dashboard-grid")}>
        <ManifestSummaryCard config={config} context={context} panels={panels} actions={actions} runs={runs} copy={copy} />
        {isInvestmentAdvisor ? <InvestmentAdvisorCard activePath={activePath} actions={actions} runs={runs} artifacts={artifacts} copy={copy} dashboardRef={investmentDashboardRef} /> : <AgentPlanFoundationCard copy={copy} />}
      </div>}

      {activeTab === "chats" && <section className={cx("dashboard-card", "project-chat-overview")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">{text.memoryEyebrow}</p>
            <h2>{text.chatHistory}</h2>
          </div>
          <span className="soft-pill">{project?.sessions?.length || 0} {text.chats}</span>
        </div>
        <p className={cx("project-chat-summary")}>{chatInsights.summary}</p>
        {chatInsights.topics.length > 0 && (
          <div className={cx("topic-strip")}>
            {chatInsights.topics.map((topic) => <span key={topic}>{topic}</span>)}
          </div>
        )}
        {(project?.sessions?.length || 0) > 0 ? (
          <div className={cx("project-chat-list")}>
            {(project?.sessions || []).map((session) => (
              <button
                type="button"
                key={session.slug}
                className={cx("project-chat-row")}
                onClick={() => navigate?.(`/chat/${project?.path || activePath.projectPath}/${session.slug}`)}
              >
                <span>{session.title || session.slug}</span>
                <small>{session.created_at?.slice(0, 10) || "date unknown"}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{text.noChats}</p>
        )}
      </section>}

      {activeTab === "files" && <section className={cx("dashboard-card")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">Project files</p>
            <h2>Context include / exclude</h2>
          </div>
          <span className="soft-pill">aiws.yaml</span>
        </div>
        <div className={cx("dashboard-grid", "file-policy-grid")}>
          <FilePolicyList title="Included" items={toStringList(context.include)} empty="No include patterns yet." />
          <FilePolicyList title="Excluded" items={toStringList(context.exclude)} empty="No exclude patterns yet." />
        </div>
      </section>}

      {activeTab === "apps" && isInvestmentAdvisor && (
        <InvestmentAdvisorCard
          activePath={activePath}
          actions={actions}
          runs={runs}
          artifacts={artifacts}
          copy={copy}
          dashboardRef={investmentDashboardRef}
        />
      )}

      {activeTab === "apps" && <section className={cx("dashboard-card", "dashboard-actions")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">{text.actionsEyebrow}</p>
            <h2>{text.projectActions}</h2>
          </div>
          {power && <span className="soft-pill">aiws.yaml</span>}
        </div>
        <ProjectWorkflowAppsPanel
          activePath={activePath}
          projectConfig={projectConfig}
          onProjectConfig={onProjectConfig}
          power={power}
          fetchJson={fetchJson}
          onOpenArtifact={openArtifact}
          onRunComplete={isInvestmentAdvisor ? focusInvestmentDashboard : undefined}
          activeAppId={activeAppId}
          navigate={navigate}
        />
      </section>}

      {activeTab === "overview" && <div className={cx("dashboard-grid")}>
        <RegistryPreviewCard title={text.panelRegistry} items={PANEL_TYPES} active={panels.map((panel: PanelItem) => String(panel.type || ""))} />
        <RegistryPreviewCard title={text.actionKinds} items={ACTION_KINDS} active={actions.map((action) => action.kind)} />
      </div>}

      {activeTab === "overview" && <section className={cx("dashboard-card")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">{COPY.project.recipeStatus}</p>
            <h2>{text.recipesTitle}</h2>
          </div>
          <span className="soft-pill">{commands.length}</span>
        </div>
        {commands.length === 0 ? (
          <p className="muted">{text.noRecipes}</p>
        ) : (
          <div className={cx("recipe-status-grid")}>
            {commands.map(([name, command]) => (
              <div className={cx("recipe-status-row")} key={name}>
                <span className={`status-badge ${actionStatus(command).toLowerCase()}`}>{actionStatus(command)}</span>
                <strong>{String(command.label || name)}</strong>
                <small>{String(command.description || name)}</small>
              </div>
            ))}
          </div>
        )}
      </section>}

      {activeTab === "overview" && <section className={cx("dashboard-card", "dashboard-architecture", "passive-card")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">{text.architectureEyebrow}</p>
            <h2>{text.architectureTitle}</h2>
          </div>
          <span className="soft-pill">{text.architecturePreview}</span>
        </div>
        <p className="muted">{text.architectureBody}</p>
        <ArchitectureDiagram />
      </section>}

      {activeTab === "artifacts" && <section className={cx("dashboard-card")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">{COPY.project.artifacts}</p>
            <h2>{text.generatedOutputs}</h2>
          </div>
          <span className="soft-pill">{artifacts.length} artifacts · {runs.length} runs</span>
        </div>
        {runs.length > 0 && (
          <div className={cx("run-list", "artifact-run-strip")}>
            {runs.slice(0, 4).map((run) => (
              <button className={cx("run-row", "clickable-row")} type="button" key={run.run_id || `${run.command}-${run.created_at}`} onClick={() => openRun(run)}>
                <strong>{run.label || run.command}</strong>
                <span>{run.status}</span>
                <small>{run.created_at}</small>
              </button>
            ))}
          </div>
        )}
        {artifacts.length === 0 ? (
          <p className="muted">{text.noArtifacts}</p>
        ) : (
          <div className={cx("artifact-grid")}>
            {artifacts.slice(0, 8).map((artifact) => (
              <button className={cx("artifact-tile", "clickable-row")} type="button" key={`${artifact.run.run_id}-${artifact.path}`} onClick={() => openArtifact(artifact)}>
                <strong>{artifact.path}</strong>
                <span>{artifact.exists ? `${artifact.size} bytes` : "not found"}</span>
                <small>{artifact.run.label || artifact.run.command}</small>
              </button>
            ))}
          </div>
        )}
      </section>}

      {activeTab === "settings" && <section className={cx("dashboard-card")}>
        <div className="section-row">
          <div>
            <p className="eyebrow">Project security</p>
            <h2>Local-only lock</h2>
          </div>
          <span className={`status-badge ${localOnly ? "ready" : "planned"}`}>{localOnly ? "Cloud blocked" : "Cloud allowed with confirmation"}</span>
        </div>
        <p className="muted">When enabled, this project cannot call cloud model providers even if a user confirms remote execution.</p>
        <button type="button" className="primary-action" disabled={securityMutation.isPending} onClick={() => {
          setModalError("");
          securityMutation.mutate(!localOnly);
        }}>
          {securityMutation.isPending ? "Saving..." : localOnly ? "Allow cloud after confirmation" : "Lock this project to local only"}
        </button>
      </section>}

      {modalError && (
        <div className="viewer-modal" role="dialog" aria-modal="true">
          <div className="viewer-card">
            <button type="button" className="viewer-close" onClick={() => setModalError("")}>{text.close}</button>
            <h2>{text.couldNotOpen}</h2>
            <p className="error-text">{modalError}</p>
          </div>
        </div>
      )}
      {runDetail && <RunDetailModal detail={runDetail} power={power} activePath={activePath} onClose={() => setRunDetail(null)} onOpenArtifact={openArtifact} />}
      {artifact && <ArtifactViewer artifact={artifact} activePath={activePath} onClose={() => setArtifact(null)} />}
    </div>
  );
}

function InvestmentAdvisorCard({ activePath, actions, runs, artifacts, dashboardRef, copy = COPY }: {
  activePath: ActivePath;
  actions: DashboardAction[];
  runs: RunRecord[];
  artifacts: ArtifactWithRun[];
  dashboardRef?: React.RefObject<HTMLElement | null>;
  copy?: CopyShape;
}) {
  const text = copy.projectDashboard || COPY.projectDashboard;
  const latestMarketRun = runs.find((run) => run.command === "market_research" || run.action_id === "market_research");
  const hasReport = artifacts.some((artifact) => String(artifact.path || "").endsWith("advisor-report.md"));
  const growthChart = artifacts.find((artifact) => String(artifact.path || "").endsWith("portfolio-growth-chart.json"));
  const monthlyTable = artifacts.find((artifact) => String(artifact.path || "").endsWith("monthly-performance.csv"));
  return (
    <section ref={dashboardRef} className={cx("dashboard-card", "investment-advisor-card")}>
      <div className="section-row">
        <div>
          <p className="eyebrow">{text.customApp}</p>
          <h2>{text.investmentTitle}</h2>
        </div>
        <span className="soft-pill">{text.educationOnly}</span>
      </div>
      <p className="muted">{text.investmentBody}</p>
      <div className={cx("advisor-autoload-note")}>
        <strong>기본 입력 자동 사용</strong>
        <span>files/portfolio.example.csv · files/target_allocation.example.yaml</span>
        <small>실제 파일로 바꾸려면 프로젝트 files/ 안의 샘플 파일만 교체하면 됨.</small>
      </div>
      <div className={cx("advisor-flow")}>
        {text.investmentFlow.map((item) => <span key={item}>{item}</span>)}
      </div>
      <div className={cx("advisor-metrics")}>
        <MetricTile label={text.advisorActions} value={actions.length} />
        <MetricTile label={text.marketSnapshot} value={latestMarketRun ? latestMarketRun.status : text.notRun} />
        <MetricTile label={text.report} value={hasReport ? text.ready : text.pending} />
      </div>
      <div className={cx("advisor-viewer-grid")}>
        <div>
          <strong>월별 총자산</strong>
          {growthChart ? <ViewerPane artifact={{ ...growthChart, viewer_id: "chartViewer", type: "chart" }} /> : <p className="muted">rebalance_plan 실행 후 그래프 표시됨.</p>}
        </div>
        <div>
          <strong>수익률/벤치마크 차이</strong>
          {monthlyTable ? <ViewerPane artifact={{ ...monthlyTable, viewer_id: "tableViewer", type: "csv" }} /> : <p className="muted">monthly-performance.csv 생성 대기.</p>}
        </div>
      </div>
      <div className={cx("trusted-viewer-frame")}>
        <div className="section-row">
          <strong>Trusted dashboard iframe</strong>
          <span className="soft-pill">manifest/build/reload ready</span>
        </div>
        <iframe
          title="Investment rebalancing dashboard"
          sandbox="allow-scripts"
          src={`/project-viewers/${activePath.projectPath}/frame/investment-rebalance-dashboard`}
        />
      </div>
      <details className={cx("advisor-tips")}>
        <summary>{text.customTips}</summary>
        <ul>
          {text.customTipItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>
    </section>
  );
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function FilePolicyList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className={cx("dashboard-card", "passive-card")}>
      <div className="section-row">
        <strong>{title}</strong>
        <span className="soft-pill">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className={cx("manifest-list")}>
          {items.map((item) => <li key={item}><code>{item}</code></li>)}
        </ul>
      )}
    </div>
  );
}

function ManifestSummaryCard({ config, context, panels, actions, runs, copy = COPY }: {
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  panels: PanelItem[];
  actions: DashboardAction[];
  runs: RunRecord[];
  copy?: CopyShape;
}) {
  const text = copy.projectDashboard || COPY.projectDashboard;
  const include = Array.isArray(context.include) ? context.include : [];
  const exclude = Array.isArray(context.exclude) ? context.exclude : [];
  const views = Array.isArray(config.views) ? config.views : [];
  return (
    <section className={cx("dashboard-card", "manifest-summary-card")}>
      <div className="section-row">
        <div>
          <p className="eyebrow">{text.manifestEyebrow}</p>
          <h2>{text.manifestTitle}</h2>
        </div>
        <span className="soft-pill">{config.name ? text.loaded : text.templateReady}</span>
      </div>
      <div className={cx("manifest-summary-grid")}>
        <MetricTile label={text.actions} value={actions.length} />
        <MetricTile label={text.panels} value={panels.length} />
        <MetricTile label={text.views} value={views.length} />
        <MetricTile label={text.runs} value={runs.length} />
      </div>
      <div className={cx("manifest-section")}>
        <strong>{text.contextInclude}</strong>
        <p>{include.length ? include.slice(0, 4).join(", ") : text.noInclude}</p>
      </div>
      <div className={cx("manifest-section", "security")}>
        <strong>{text.securityExclusions}</strong>
        <p>{exclude.length ? exclude.slice(0, 4).join(", ") : text.defaultExclusions}</p>
      </div>
      <pre className={cx("manifest-code")}>{sampleManifest(config, panels, actions)}</pre>
    </section>
  );
}

function AgentPlanFoundationCard({ copy = COPY }: { copy?: CopyShape }) {
  const text = copy.projectDashboard || COPY.projectDashboard;
  const steps: Array<[string, string, boolean]> = [
    ["read_file", text.agentStepRead, false],
    ["llm", text.agentStepPlan, false],
    ["search", text.agentStepSearch, true],
    ["python", text.agentStepPython, true],
    ["report", text.agentStepReport, false],
  ];
  return (
    <section className={cx("dashboard-card", "agent-plan-card")}>
      <div className="section-row">
        <div>
          <p className="eyebrow">{text.agentEyebrow}</p>
          <h2>{text.agentTitle}</h2>
        </div>
        <span className="soft-pill">{text.experimental}</span>
      </div>
      <p className="muted">{text.agentBody}</p>
      <div className={cx("agent-step-list")}>
        {steps.map(([kind, title, approval], index) => (
          <div key={title} className={approval ? cx("needs-approval") : ""}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
            <small>{AGENT_STEP_KINDS.includes(kind) ? kind : "llm"}{approval ? ` · ${text.approvalRequired}` : ""}</small>
          </div>
        ))}
      </div>
      <p className="warning-text">{text.agentWarning}</p>
    </section>
  );
}

function RegistryPreviewCard({ title, items, active }: { title: string; items: string[] | Set<string>; active?: string[] }) {
  const activeSet = new Set(active || []);
  return (
    <section className={cx("dashboard-card", "registry-preview-card")}>
      <div className="section-row">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>{title}</h2>
        </div>
        <span className="soft-pill">{activeSet.size} active</span>
      </div>
      <div className={cx("registry-chip-grid")}>
        {Array.from(items).map((item) => <span key={item} className={activeSet.has(item) ? cx("active") : ""}>{item}</span>)}
      </div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className={cx("metric-tile")}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function sampleManifest(config: Record<string, unknown>, panels: PanelItem[], actions: DashboardAction[]) {
  const firstAction = actions[0] || { id: "summarize_file", kind: "prompt_recipe", label: "Summarize File" };
  const firstPanel = panels[0] || { id: "files", type: "fileExplorer", title: "Files" };
  return [
    `name: ${config.name || "Project Workbench"}`,
    "views:",
    "  - id: desk",
    "    panels:",
    `      - id: ${firstPanel.id}`,
    `        type: ${firstPanel.type}`,
    `        title: ${firstPanel.title}`,
    "commands:",
    `  ${firstAction.id}:`,
    `    kind: ${firstAction.kind}`,
    `    label: ${firstAction.label}`,
  ].join("\n");
}

function summarizeProjectChats(project?: ProjectSummary) {
  const sessions = project?.sessions || [];
  if (sessions.length === 0) {
    return {
      summary: "No chat history yet. Start a project chat and the workbench will summarize what this project is becoming.",
      topics: [],
    };
  }
  const titles = sessions.map((session) => cleanSessionTitle(session.title || session.slug || "")).filter(Boolean);
  const topics = extractTopics(titles);
  const latest = sessions
    .map((session) => session.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const representative = titles.find((title) => title.length >= 4) || project?.title || "this project";
  const topicText = topics.length > 0
    ? `Main themes appear to be ${topics.slice(0, 4).join(", ")}.`
    : `Representative chat: "${representative}".`;
  return {
    summary: `${sessions.length} chat${sessions.length === 1 ? "" : "s"} connected. ${topicText}${latest ? ` Last update ${latest.slice(0, 10)}.` : ""}`,
    topics,
  };
}

function cleanSessionTitle(value: string) {
  return String(value || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b\d{1,4}[./:-]\d{1,2}(?:[./:-]\d{1,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b(Kwanho Kim|Chungja Byun|Assistant|User)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopics(titles: string[]) {
  const stop = new Set([
    "new", "chat", "test", "title", "project", "pdf", "file", "user", "assistant",
    "kwanho", "kim", "chungja", "byun", "이거", "저거", "그건", "오늘", "내일", "파일", "대화",
    "프로젝트", "작업실", "테스트", "오전", "오후",
  ]);
  const counts = new Map();
  for (const title of titles) {
    for (const token of String(title).toLowerCase().match(/[a-z0-9가-힣]{2,}/g) || []) {
      if (/^\d+$/.test(token)) continue;
      if (/^\d{4}$/.test(token)) continue;
      if (/^\d{2,}$/.test(token)) continue;
      if (stop.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function RunDetailModal({ detail, power, activePath, onClose, onOpenArtifact }: {
  detail: RunDetail;
  power: boolean;
  activePath: ActivePath;
  onClose: () => void;
  onOpenArtifact: (artifact: ArtifactRecord) => void | Promise<void>;
}) {
  const run = (detail.run || {}) as RunRecord & { label?: string; command?: string; kind?: string; artifacts?: Array<ArtifactRecord & { exists?: boolean; size?: number }> };
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Run Detail</p>
        <h2>{run.label || run.command || "Run record"}</h2>
        <div className="run-meta-grid">
          <span>Status: {run.status}</span>
          <span>Kind: {run.kind}</span>
          <span>{run.created_at}</span>
        </div>
        {(run.artifacts?.length || 0) > 0 && (
          <div className="artifact-list">
            <strong>Artifacts</strong>
            {(run.artifacts || []).map((item) => (
              <button type="button" key={item.path} onClick={() => onOpenArtifact(item)}>
                {item.path} · {item.exists ? `${item.size} bytes` : "not found"}
              </button>
            ))}
          </div>
        )}
        {power && (
          <>
            <h3>stdout</h3>
            <pre>{detail.stdout || "(empty)"}</pre>
            <h3>stderr</h3>
            <pre className={detail.stderr ? "error-text" : ""}>{detail.stderr || "(empty)"}</pre>
            <h3>result.json</h3>
            <pre>{JSON.stringify(detail.result || {}, null, 2)}</pre>
          </>
        )}
        <ChatDock
          projectPath={activePath?.projectPath}
          context={{ kind: "run", label: run.label || run.command || "Run", runId: run.run_id }}
          power={power}
        />
      </div>
    </div>
  );
}

function ArtifactViewer({ artifact, activePath, onClose }: { artifact: ArtifactPayload; activePath: ActivePath; onClose: () => void }) {
  return (
    <div className="viewer-modal" role="dialog" aria-modal="true">
      <div className="viewer-card wide">
        <button type="button" className="viewer-close" onClick={onClose}>Close</button>
        <p className="eyebrow">Artifact Viewer</p>
        <h2>{artifact.path}</h2>
        <span className="soft-pill">{artifact.kind} · {artifact.size} bytes</span>
        <ViewerPane artifact={artifact} />
        <ChatDock
          projectPath={activePath?.projectPath}
          context={{ kind: "artifact", label: artifact.path, path: artifact.path }}
        />
      </div>
    </div>
  );
}
