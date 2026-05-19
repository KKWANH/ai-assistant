import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArtifactCard, ProjectCard, RunCard, StatPill, type NavigateTo } from "../components/work-objects/WorkObjectCards";
import { fetchJson } from "../lib/api";
import type { ProjectSummary } from "../entities/project/types";
import type { WorkspaceSummary } from "../entities/workspace/types";
import type { ArtifactRecord, RunRecord } from "../shared/contracts/workbench";
import type { ArtifactPayload, HomePayload, RunDetail } from "../shared/contracts/runtime";
import styles from "./WorkObjectPages.module.css";

type WorkObjectPagesProps = {
  view: "projects" | "runs" | "artifacts";
  workspace: WorkspaceSummary | null;
  home?: HomePayload | null;
  navigate: NavigateTo;
};

type RunWithProject = RunRecord & { projectTitle?: string; projectPath?: string };
type ArtifactWithProject = ArtifactRecord & { projectTitle?: string; projectPath?: string; run?: RunRecord };
type ObjectPageResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  statuses?: string[];
  types?: string[];
};

export function WorkObjectPages({ view, workspace, home, navigate }: WorkObjectPagesProps) {
  const projects = workspace?.projects || [];
  const fallbackRuns = collectRuns(home, projects);
  const fallbackArtifacts = collectArtifacts(fallbackRuns);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [visibleCount, setVisibleCount] = useState(24);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [artifact, setArtifact] = useState<ArtifactPayload | null>(null);
  const [error, setError] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const runsQuery = useQuery({
    queryKey: ["work-objects", "runs", normalizedQuery, statusFilter, sortKey, sortOrder, visibleCount],
    queryFn: () => fetchJson<ObjectPageResponse<RunWithProject>>(
      `/api/runs?${new URLSearchParams({
        q: query.trim(),
        status: statusFilter,
        sort: sortKey,
        order: sortOrder,
        limit: String(visibleCount),
        offset: "0",
      })}`
    ),
    enabled: view === "runs",
  });
  const artifactsQuery = useQuery({
    queryKey: ["work-objects", "artifacts", normalizedQuery, typeFilter, sortKey, sortOrder, visibleCount],
    queryFn: () => fetchJson<ObjectPageResponse<ArtifactWithProject>>(
      `/api/artifacts?${new URLSearchParams({
        q: query.trim(),
        type: typeFilter,
        sort: sortKey,
        order: sortOrder,
        limit: String(visibleCount),
        offset: "0",
      })}`
    ),
    enabled: view === "artifacts",
  });
  const filteredProjects = projects.filter((project) => matchText(normalizedQuery, [project.title, project.path, project.owner_display]));
  const localFilteredRuns = fallbackRuns.filter((run) =>
    (statusFilter === "all" || String(run.status || "").toLowerCase() === statusFilter)
    && matchText(normalizedQuery, [run.label, run.action_label, run.command, run.action_id, run.projectTitle, run.projectPath, run.status])
  );
  const localFilteredArtifacts = fallbackArtifacts.filter((item) =>
    (typeFilter === "all" || String(item.viewer_type || item.type || "").toLowerCase().includes(typeFilter))
    && matchText(normalizedQuery, [item.path, item.viewer_type, item.type, item.projectTitle, item.projectPath, item.run?.label, item.run?.command])
  );
  const projectPage = filteredProjects.slice(0, visibleCount);
  const runPage = (runsQuery.data?.items || localFilteredRuns).slice(0, visibleCount);
  const artifactPage = (artifactsQuery.data?.items || localFilteredArtifacts).slice(0, visibleCount);
  const runTotal = runsQuery.data?.total ?? localFilteredRuns.length;
  const artifactTotal = artifactsQuery.data?.total ?? localFilteredArtifacts.length;
  const runs = runsQuery.data?.items || fallbackRuns;
  const artifacts = artifactsQuery.data?.items || fallbackArtifacts;
  const statusOptions = runsQuery.data?.statuses?.length
    ? runsQuery.data.statuses
    : uniqueValues(fallbackRuns.map((run) => String(run.status || "").toLowerCase()).filter(Boolean));
  const typeOptions = artifactsQuery.data?.types?.length
    ? artifactsQuery.data.types
    : uniqueValues(fallbackArtifacts.map((item) => String(item.viewer_type || item.type || "").toLowerCase()).filter(Boolean));

  async function openRun(run: RunWithProject) {
    setError("");
    try {
      if (run.projectPath) {
        const payload = await fetchJson<RunDetail>(`/api/project-run?project=${encodeURIComponent(run.projectPath)}&run_id=${encodeURIComponent(run.run_id)}`);
        setRunDetail(payload);
        return;
      }
      setRunDetail({ run, result: { run }, stdout: "", stderr: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openArtifact(item: ArtifactWithProject) {
    setError("");
    try {
      if (item.projectPath) {
        const payload = await fetchJson<{ artifact: ArtifactPayload }>(`/api/project-artifact?project=${encodeURIComponent(item.projectPath)}&path=${encodeURIComponent(item.path)}`);
        setArtifact(payload.artifact);
        return;
      }
      const payload = await fetchJson<{ artifact: ArtifactPayload }>(`/api/home-artifact?path=${encodeURIComponent(item.path)}`);
      setArtifact(payload.artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const pageTitle = view === "projects" ? "Projects" : view === "runs" ? "Runs" : "Artifacts";
  const pageBody = view === "projects"
    ? "Local workspaces with files, sessions, Workflow Apps, runs, and outputs."
    : view === "runs"
      ? "Traceable execution records across model calls, tools, and Workflow Apps."
      : "Durable outputs with provenance back to chats, runs, and projects.";

  return (
    <section className={`center-pane ${styles.page}`}>
      <div className={styles.browser}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">Workbench objects</p>
            <h1>{pageTitle}</h1>
            <p>{pageBody}</p>
          </div>
          <div className={styles.statRow}>
            <StatPill label="projects" value={projects.length} />
            <StatPill label="runs" value={runs.length} />
            <StatPill label="artifacts" value={artifacts.length} />
          </div>
        </header>

        <div className={styles.toolbar} role="search">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(24);
            }}
            placeholder={`Search ${pageTitle.toLowerCase()}...`}
            aria-label={`Search ${pageTitle}`}
          />
          {view === "runs" && (
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setVisibleCount(24); }} aria-label="Run status filter">
              <option value="all">All statuses</option>
              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          )}
          {view === "artifacts" && (
            <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setVisibleCount(24); }} aria-label="Artifact type filter">
              <option value="all">All types</option>
              {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          )}
          {view !== "projects" && (
            <>
              <select value={sortKey} onChange={(event) => { setSortKey(event.target.value); setVisibleCount(24); }} aria-label="Sort work objects">
                <option value="created_at">Newest</option>
                <option value={view === "runs" ? "label" : "name"}>{view === "runs" ? "Label" : "Name"}</option>
                <option value="project">Project</option>
                <option value={view === "runs" ? "status" : "type"}>{view === "runs" ? "Status" : "Type"}</option>
                {view === "runs" && <option value="artifacts">Artifact count</option>}
                {view === "artifacts" && <option value="size">Size</option>}
              </select>
              <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value === "asc" ? "asc" : "desc"); setVisibleCount(24); }} aria-label="Sort direction">
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </>
          )}
        </div>
        {((view === "runs" && runsQuery.isFetching) || (view === "artifacts" && artifactsQuery.isFetching)) && (
          <p className="muted">Loading work objects from the server...</p>
        )}
        {((view === "runs" && runsQuery.error) || (view === "artifacts" && artifactsQuery.error)) && (
          <p className="system-note">
            {(runsQuery.error || artifactsQuery.error) instanceof Error
              ? (runsQuery.error || artifactsQuery.error)?.message
              : "Could not load server objects. Showing cached workspace data."}
          </p>
        )}

        {view === "projects" && (
          <ObjectSection title="Project workbenches" empty="No projects yet. Create a project to bind files, runs, and outputs.">
            {projectPage.map((project) => <ProjectCard key={project.path} project={project} onOpen={navigate} />)}
          </ObjectSection>
        )}

        {view === "runs" && (
          <ObjectSection title="Execution history" empty="No runs yet. Run a Workflow App or create an artifact.">
            {runPage.map((run) => <RunCard key={`${run.projectPath || "home"}-${run.run_id}`} run={run} onOpen={openRun} />)}
          </ObjectSection>
        )}

        {view === "artifacts" && (
          <ObjectSection title="Saved outputs" empty="No artifacts yet. Answers, tools, and Workflow Apps can create durable outputs.">
            {artifactPage.map((item) => <ArtifactCard key={`${item.projectPath || "home"}-${item.path}`} artifact={item} onOpen={openArtifact} />)}
          </ObjectSection>
        )}

        {visibleCount < (view === "projects" ? filteredProjects.length : view === "runs" ? runTotal : artifactTotal) && (
          <button type="button" className={styles.loadMore} onClick={() => setVisibleCount((value) => value + 24)}>
            Load more
          </button>
        )}
      </div>
      {error && <div className="system-note">{error}</div>}
      {runDetail && (
        <div className="viewer-modal" role="dialog" aria-modal="true">
          <div className="viewer-card wide">
            <button type="button" className="viewer-close" onClick={() => setRunDetail(null)}>Close</button>
            <p className="eyebrow">Run detail</p>
            <h2>{runDetail.run?.label || runDetail.run?.command || runDetail.run?.action_id || "Run"}</h2>
            <pre>{JSON.stringify(runDetail.run || runDetail.result || {}, null, 2)}</pre>
          </div>
        </div>
      )}
      {artifact && (
        <div className="viewer-modal" role="dialog" aria-modal="true">
          <div className="viewer-card wide">
            <button type="button" className="viewer-close" onClick={() => setArtifact(null)}>Close</button>
            <p className="eyebrow">Artifact</p>
            <h2>{artifact.path}</h2>
            <pre>{artifact.content || JSON.stringify(artifact, null, 2)}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

function matchText(query: string, values: Array<unknown>) {
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values)).slice(0, 24);
}

function ObjectSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] | React.ReactNode }) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children;
  const count = Array.isArray(list) ? list.length : list ? 1 : 0;
  return (
    <section className={styles.section}>
      <div className={styles.sectionRow}>
        <h2>{title}</h2>
        <span className="soft-pill">{count}</span>
      </div>
      {count ? <div className={styles.grid}>{list}</div> : <p className="muted">{empty}</p>}
    </section>
  );
}

function collectRuns(home: HomePayload | null | undefined, projects: ProjectSummary[]): RunWithProject[] {
  const homeRuns = (home?.runs || []).map((run) => ({ ...run, projectTitle: "Home", projectPath: "" }));
  const projectRuns = projects.flatMap((project) =>
    ((project as ProjectSummary & { runs?: RunRecord[] }).runs || []).map((run) => ({
      ...run,
      projectTitle: project.title || project.path,
      projectPath: project.path,
    }))
  );
  return [...homeRuns, ...projectRuns]
    .filter((run) => run.run_id || run.created_at)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function collectArtifacts(runs: RunWithProject[]): ArtifactWithProject[] {
  return runs.flatMap((run) =>
    (run.artifacts || []).map((artifact) => ({
      ...artifact,
      projectTitle: run.projectTitle,
      projectPath: run.projectPath,
      run,
    }))
  );
}
