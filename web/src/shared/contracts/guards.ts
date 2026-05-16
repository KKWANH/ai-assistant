import type { ProjectConnectionsPayload } from "./workbench";
import type { WorkflowAppDefinition } from "./workflow-app";
import { isViewerId } from "../viewers/registry";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isWorkflowAppDefinition(value: unknown): value is WorkflowAppDefinition {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (!Array.isArray(value.inputSchema) || !Array.isArray(value.outputSchema) || !Array.isArray(value.defaultViewerLayout)) return false;
  const outputOk = value.outputSchema.every((item) => (
    isObject(item)
    && typeof item.id === "string"
    && typeof item.path === "string"
    && typeof item.type === "string"
    && typeof item.viewer_id === "string"
    && isViewerId(item.viewer_id)
  ));
  const slotsOk = value.defaultViewerLayout.every((item) => (
    isObject(item)
    && typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.viewer_id === "string"
    && isViewerId(item.viewer_id)
  ));
  return outputOk && slotsOk;
}

export function parseWorkflowApps(value: unknown): WorkflowAppDefinition[] {
  return Array.isArray(value) ? value.filter(isWorkflowAppDefinition) : [];
}

export function parseProjectConnections(value: unknown): ProjectConnectionsPayload {
  const source = isObject(value) ? value : {};
  const exportsList = Array.isArray(source.exports) ? source.exports.filter(isObject).map((item) => ({
    projectId: String(item.projectId || source.projectId || ""),
    resourceType: String(item.resourceType || ""),
    artifactPattern: String(item.artifactPattern || ""),
    schemaVersion: String(item.schemaVersion || "1"),
    label: typeof item.label === "string" ? item.label : undefined,
  })).filter((item) => item.resourceType && item.artifactPattern) : [];
  const links = (raw: unknown) => Array.isArray(raw) ? raw.filter(isObject).map((item) => ({
    linkId: String(item.linkId || ""),
    fromProject: String(item.fromProject || ""),
    toProject: String(item.toProject || ""),
    allowedResourceTypes: stringArray(item.allowedResourceTypes),
    mode: String(item.mode || "read"),
    grantedBy: typeof item.grantedBy === "string" ? item.grantedBy : undefined,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
    status: String(item.status || "pending"),
  })).filter((item) => item.linkId && item.fromProject && item.toProject) : [];
  return {
    projectId: String(source.projectId || ""),
    exports: exportsList,
    imports: Array.isArray(source.imports) ? source.imports.filter(isObject).map((item) => ({
      sourceProjectId: String(item.sourceProjectId || ""),
      acceptedResourceType: String(item.acceptedResourceType || ""),
      localAlias: String(item.localAlias || ""),
      status: typeof item.status === "string" ? item.status : undefined,
    })).filter((item) => item.sourceProjectId && item.acceptedResourceType) : [],
    incomingLinks: links(source.incomingLinks),
    outgoingLinks: links(source.outgoingLinks),
    connectedResources: Array.isArray(source.connectedResources)
      ? source.connectedResources.filter(isObject).map((item) => ({
        projectId: String(item.projectId || ""),
        resourceType: String(item.resourceType || ""),
        artifactPattern: String(item.artifactPattern || ""),
        schemaVersion: String(item.schemaVersion || "1"),
        label: typeof item.label === "string" ? item.label : undefined,
        sourceProjectId: typeof item.sourceProjectId === "string" ? item.sourceProjectId : undefined,
        mode: typeof item.mode === "string" ? item.mode : undefined,
        linkId: typeof item.linkId === "string" ? item.linkId : undefined,
      })).filter((item) => item.resourceType)
      : [],
    resolvedImports: Array.isArray(source.resolvedImports)
      ? source.resolvedImports.filter(isObject).map((item) => ({
        sourceProjectId: String(item.sourceProjectId || ""),
        resourceType: String(item.resourceType || ""),
        localAlias: String(item.localAlias || item.resourceType || ""),
        mode: typeof item.mode === "string" ? item.mode : undefined,
        linkId: typeof item.linkId === "string" ? item.linkId : undefined,
        artifactPattern: typeof item.artifactPattern === "string" ? item.artifactPattern : undefined,
        latestArtifact: isObject(item.latestArtifact) ? {
          path: String(item.latestArtifact.path || ""),
          size: typeof item.latestArtifact.size === "number" ? item.latestArtifact.size : undefined,
          updatedAt: typeof item.latestArtifact.updatedAt === "string" ? item.latestArtifact.updatedAt : undefined,
        } : null,
      })).filter((item) => item.sourceProjectId && item.resourceType)
      : [],
    visibleSources: Array.isArray(source.visibleSources)
      ? source.visibleSources.filter(isObject).map((item) => ({
        projectId: String(item.projectId || ""),
        title: String(item.title || item.projectId || ""),
        exports: parseProjectConnections({ projectId: item.projectId, exports: item.exports }).exports,
      })).filter((item) => item.projectId)
      : [],
  };
}
