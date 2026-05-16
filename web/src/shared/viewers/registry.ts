import { ChartViewer, validateChartArtifact } from "./chartViewer";
import { CodeEditorViewer } from "./codeEditorViewer";
import { JsonViewer } from "./jsonViewer";
import { MarkdownViewer } from "./markdownViewer";
import { ReportViewer } from "./reportViewer";
import { TableViewer } from "./tableViewer";
import type { ViewerArtifact, ViewerPlugin } from "../contracts/viewer";
export type { ViewerArtifact, ViewerPlugin } from "../contracts/viewer";

function extension(path = "") {
  return path.includes(".") ? `.${path.split(".").pop()?.toLowerCase()}` : "";
}

export function viewerAccepts(plugin: Pick<ViewerPlugin, "accepts">, artifact: ViewerArtifact) {
  const ext = extension(artifact.path || "");
  const type = artifact.type || "";
  const mime = artifact.mime || "";
  const mimeTypes = plugin.accepts.mimeTypes || plugin.accepts.mime || [];
  return Boolean(
    (ext && plugin.accepts.extensions?.includes(ext))
      || (type && plugin.accepts.artifactTypes?.includes(type))
      || (mime && mimeTypes.includes(mime)),
  );
}

const tableViewerPlugin: ViewerPlugin = {
  id: "tableViewer",
  label: "Table",
  accepts: { extensions: [".csv", ".tsv"], artifactTypes: ["csv", "table"], mimeTypes: ["text/csv", "text/tab-separated-values"] },
  render: TableViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => viewerAccepts(tableViewerPlugin, artifact),
};

const markdownViewerPlugin: ViewerPlugin = {
  id: "markdownViewer",
  label: "Markdown",
  accepts: { extensions: [".md", ".markdown"], artifactTypes: ["md", "markdown"], mimeTypes: ["text/markdown"] },
  render: MarkdownViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => viewerAccepts(markdownViewerPlugin, artifact) || typeof artifact.content === "string",
};

const jsonViewerPlugin: ViewerPlugin = {
  id: "jsonViewer",
  label: "JSON",
  accepts: { extensions: [".json"], artifactTypes: ["json"], mimeTypes: ["application/json"] },
  render: JsonViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => viewerAccepts(jsonViewerPlugin, artifact),
};

const chartViewerPlugin: ViewerPlugin = {
  id: "chartViewer",
  label: "Chart",
  accepts: { extensions: [".json"], artifactTypes: ["chart"] },
  render: ChartViewer,
  validateArtifact: validateChartArtifact,
};

const reportViewerPlugin: ViewerPlugin = {
  id: "reportViewer",
  label: "Report",
  accepts: { extensions: [".md", ".markdown"], artifactTypes: ["report", "markdown"], mimeTypes: ["text/markdown"] },
  render: ReportViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => viewerAccepts(reportViewerPlugin, artifact) || typeof artifact.content === "string",
};

const textViewerPlugin: ViewerPlugin = {
  id: "textViewer",
  label: "Text",
  accepts: { extensions: [".txt", ".log"], artifactTypes: ["text", "log"], mimeTypes: ["text/plain"] },
  render: MarkdownViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => typeof artifact.content === "string",
};

const codeEditorPlugin: ViewerPlugin = {
  id: "codeEditor",
  label: "Code",
  accepts: { extensions: [".py", ".js", ".ts", ".tsx", ".css", ".html", ".sh", ".yaml", ".yml"], artifactTypes: ["code", "yaml"] },
  render: CodeEditorViewer,
  validateArtifact: (artifact): artifact is ViewerArtifact => viewerAccepts(codeEditorPlugin, artifact) || typeof artifact.content === "string",
};

export const VIEWER_REGISTRY: Record<string, ViewerPlugin> = {
  tableViewer: tableViewerPlugin,
  markdownViewer: markdownViewerPlugin,
  jsonTree: jsonViewerPlugin,
  jsonViewer: jsonViewerPlugin,
  chart: chartViewerPlugin,
  chartViewer: chartViewerPlugin,
  reportViewer: reportViewerPlugin,
  textViewer: textViewerPlugin,
  codeEditor: codeEditorPlugin,
};

export const VIEWER_IDS = Object.keys(VIEWER_REGISTRY);

/*
 * Projects may choose only these allowlisted viewer ids. Workspace files never
 * become executable browser modules.
 */
export function resolveViewerPlugin(value?: string, artifact?: ViewerArtifact): ViewerPlugin {
  const plugin = value && isViewerId(value) ? VIEWER_REGISTRY[value] : undefined;
  if (plugin && (!artifact || plugin.validateArtifact(artifact))) return plugin;
  if (artifact) {
    const matching = Object.values(VIEWER_REGISTRY).find((candidate) => candidate.validateArtifact(artifact));
    if (matching) return matching;
  }
  return VIEWER_REGISTRY.textViewer;
}

export type ViewerId = keyof typeof VIEWER_REGISTRY;

export function isViewerId(value?: string): value is ViewerId {
  return Boolean(value && value in VIEWER_REGISTRY);
}

export function resolveViewerId(value?: string): ViewerId {
  return isViewerId(value) ? value : "textViewer";
}
