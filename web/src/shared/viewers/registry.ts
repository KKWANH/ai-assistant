import { ChartViewer } from "./chartViewer";
import { JsonViewer } from "./jsonViewer";
import { MarkdownViewer } from "./markdownViewer";
import { ReportViewer } from "./reportViewer";
import { TableViewer } from "./tableViewer";

export const VIEWER_REGISTRY = {
  tableViewer: TableViewer,
  markdownViewer: MarkdownViewer,
  jsonTree: JsonViewer,
  jsonViewer: JsonViewer,
  chart: ChartViewer,
  chartViewer: ChartViewer,
  reportViewer: ReportViewer,
  textViewer: MarkdownViewer,
  codeEditor: JsonViewer,
} as const;

export type ViewerId = keyof typeof VIEWER_REGISTRY;

export function isViewerId(value?: string): value is ViewerId {
  return Boolean(value && value in VIEWER_REGISTRY);
}

export function resolveViewerId(value?: string): ViewerId {
  return isViewerId(value) ? value : "textViewer";
}
