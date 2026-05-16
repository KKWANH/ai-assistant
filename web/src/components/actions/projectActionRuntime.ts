import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { ActivePath } from "../../app/router/parseRoute";
import type { WorkflowAppDefinition } from "../../entities/workflow-app/types";
import { queryKeys, type ProjectConfigPayload } from "../../shared/api/client";
import type { ChatState } from "../../shared/contracts/runtime";
import type { ArtifactRecord, ChatMessage, RunRecord } from "../../shared/contracts/workbench";

type JsonMap = Record<string, unknown>;
export type FetchJson = <T = JsonMap>(path: string, options?: RequestInit) => Promise<T>;
export type AutomationProject = { slug: string; title: string; kind: string; latest_run?: { status?: string; created_at?: string } };
export type CommandDefinition = JsonMap & {
  workflow_app?: WorkflowAppDefinition;
  workflow_app_id?: string;
  outputs?: string[];
  inputs?: unknown[];
  input?: unknown[];
  command?: string;
  label?: string;
  description?: string;
  category?: string;
  kind?: string;
  permission?: string;
  permissions?: Record<string, string | boolean>;
};
export type PreviewRecord = JsonMap & {
  label?: string;
  kind?: string;
  permission?: string;
  cwd?: string;
  command_line?: string;
  script?: string;
  prompt?: string;
  description?: string;
  requires_confirmation?: boolean;
  expected_input_files?: string[];
  expected_output_files?: string[];
};
type ProjectActionPreviewPayload = { preview: PreviewRecord };
type ProjectActionRunPayload = {
  config: ProjectConfigPayload["config"];
  run: ActionRunRecord;
  message?: ChatMessage;
};
export type ActionRunRecord = RunRecord & JsonMap & { run_dir?: string; stdout?: string; stderr?: string; artifacts?: ArtifactRecord[] };
type KindKey = "prompt_recipe" | "shell" | "python" | "file_index" | "codex_prompt" | "openclaw_status";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Request failed.");
}

export function useProjectActionRuntime({
  activePath,
  fetchJson,
  onProjectConfig,
  onChat,
  onRunComplete,
}: {
  activePath: ActivePath;
  fetchJson: FetchJson;
  onProjectConfig?: Dispatch<SetStateAction<ProjectConfigPayload | null>>;
  onChat?: (next: (current: ChatState | null) => ChatState) => void;
  onRunComplete?: (run: ActionRunRecord) => void;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [result, setResult] = useState<ActionRunRecord | null>(null);
  const [error, setError] = useState("");

  const importTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!activePath.projectPath) return null;
      return fetchJson<{ config: ProjectConfigPayload["config"] }>(`/api/project-config/${activePath.projectPath}/import`, {
        method: "POST",
        body: new URLSearchParams({ template: "investment-advisor" }),
      });
    },
    onSuccess: (payload) => {
      if (!payload || !activePath.projectPath) return;
      onProjectConfig?.({ config: payload.config, runs: [] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectConfig(activePath.projectPath) });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const previewMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!activePath.projectPath) return null;
      return fetchJson<ProjectActionPreviewPayload>(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
    },
    onSuccess: (payload) => {
      if (payload) setPreview(payload.preview);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const runMutation = useMutation({
    mutationFn: async ({ name, options }: { name: string; options: { label?: string; command?: CommandDefinition; sessionSlug?: string; attachMessageToChat?: boolean } }) => {
      if (!activePath.projectPath) return null;
      const previewPayload = await fetchJson<ProjectActionPreviewPayload>(`/api/project-actions/${activePath.projectPath}/${name}/preview`, {
        method: "POST",
        body: new URLSearchParams(),
      });
      const confirmRun = !previewPayload.preview.requires_confirmation || globalThis.confirm(`Run ${options.command?.label || options.label || name}?`);
      if (!confirmRun) return null;
      const body = new URLSearchParams({ confirm: previewPayload.preview.requires_confirmation ? "1" : "0" });
      if (options.sessionSlug) body.set("session_slug", options.sessionSlug);
      const payload = await fetchJson<ProjectActionRunPayload>(`/api/project-actions/${activePath.projectPath}/${name}/run`, {
        method: "POST",
        body,
      });
      return { payload, options };
    },
    onSuccess: (resultPayload) => {
      if (!resultPayload || !activePath.projectPath) return;
      const { payload, options } = resultPayload;
      setResult(payload.run);
      onProjectConfig?.((current) => ({ ...(current || {}), config: payload.config, runs: [payload.run, ...((current?.runs || []).slice(0, 9))] }));
      if (options.attachMessageToChat && payload.message) {
        const nextMessage = payload.message;
        onChat?.((current) => ({
          ...(current || {}),
          messages: [...(current?.messages || []), nextMessage],
          task_suggestions: [],
        }));
      }
      onRunComplete?.(payload.run);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectConfig(activePath.projectPath) });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  async function importTemplate() {
    if (!activePath.projectPath) return;
    setError("");
    await importTemplateMutation.mutateAsync().catch(() => undefined);
  }

  async function previewCommand(name: string) {
    if (!activePath.projectPath) return;
    setError("");
    setPreview(null);
    setResult(null);
    await previewMutation.mutateAsync(name).catch(() => undefined);
  }

  async function runCommand(name: string, options: { label?: string; command?: CommandDefinition; sessionSlug?: string; attachMessageToChat?: boolean } = {}) {
    if (!activePath.projectPath) return;
    setError("");
    setResult(null);
    await runMutation.mutateAsync({ name, options }).catch(() => undefined);
  }

  return {
    error,
    preview,
    result,
    running: runMutation.isPending ? runMutation.variables?.name || "" : "",
    importTemplate,
    previewCommand,
    runCommand,
  };
}

export function workflowAppForCommand(name: string, command: CommandDefinition = {}): WorkflowAppDefinition {
  if (command.workflow_app) return command.workflow_app;
  const outputs = Array.isArray(command.outputs) ? command.outputs : [];
  return {
    id: command.workflow_app_id || name,
    title: command.label || name,
    description: command.description || "A Workflow App that uses files, context, and command definitions.",
    category: command.category || "Project",
    inputSchema: (Array.isArray(command.inputs) ? command.inputs : Array.isArray(command.input) ? command.input : []).map((item) => ({
      id: String(item).replace(/[^a-z0-9]+/gi, "_"),
      label: String(item),
      type: "file",
      required: false,
    })),
    outputSchema: outputs.map((path: string) => ({
      id: String(path).replace(/[^a-z0-9]+/gi, "_"),
      path: String(path),
      type: String(path).endsWith(".csv") ? "csv" : String(path).endsWith(".json") ? "json" : String(path).endsWith(".md") ? "markdown" : "text",
      viewer_id: String(path).endsWith(".csv") ? "tableViewer" : String(path).endsWith(".json") ? "jsonViewer" : String(path).endsWith(".md") ? "markdownViewer" : "textViewer",
    })),
    runPolicy: {
      mode: command.kind === "python" || command.kind === "shell" ? "approval_required" : "local_only",
      requiresConfirmation: command.kind === "python" || command.kind === "shell",
      network: command.permissions?.network ? "approval_required" : "blocked",
      fileWrite: outputs.length ? "artifacts_only" : "blocked",
      cloud: "blocked",
    },
    defaultViewerLayout: outputs.slice(0, 3).map((path: string, index: number) => ({
      id: `slot_${index}`,
      title: String(path).split("/").pop() || String(path),
      viewer_id: String(path).endsWith(".csv") ? "tableViewer" : String(path).endsWith(".json") ? "jsonViewer" : String(path).endsWith(".md") ? "markdownViewer" : "textViewer",
      artifact: String(path),
      position: index === 0 ? "left" : index === 1 ? "center" : "right",
    })),
    supportedResources: ["csv", "json", "markdown", "text"],
    permissions: command.permissions || {},
  };
}

function kindLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prompt",
    shell: "Shell",
    python: "Python",
    file_index: "Files",
    codex_prompt: "Codex",
    openclaw_status: "OpenClaw",
  };
  return kind && kind in labels ? labels[kind as KindKey] : kind;
}

export function actionKindLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prepare AI prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Artifact",
    openclaw_status: "Open View",
  };
  return kind && kind in labels ? labels[kind as KindKey] : kindLabel(kind);
}

export function previewLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Preview Prompt",
    shell: "Preview Command",
    python: "Preview Script",
    file_index: "Preview Files",
    codex_prompt: "Preview Prompt",
    openclaw_status: "Preview View",
  };
  return kind && kind in labels ? labels[kind as KindKey] : "Preview";
}

export function executeLabel(kind?: string) {
  const labels: Record<KindKey, string> = {
    prompt_recipe: "Prepare Prompt",
    shell: "Run Script",
    python: "Run Script",
    file_index: "Open View",
    codex_prompt: "Generate Prompt",
    openclaw_status: "Check Status",
  };
  return kind && kind in labels ? labels[kind as KindKey] : "Run";
}

export function actionStatus(command: CommandDefinition = {}) {
  const status = String(command.status || "").toLowerCase();
  if (["ready", "partial", "mock", "planned"].includes(status)) {
    return status[0].toUpperCase() + status.slice(1);
  }
  if (command.kind === "prompt_recipe" || command.kind === "shell") return "Partial";
  if (command.kind === "python" || command.kind === "file_index") return "Ready";
  return "Ready";
}

export function actionOutputLabel(command: CommandDefinition = {}) {
  if (command.output === "chat_prompt" || command.kind === "prompt_recipe") return "Prompt prepared";
  if (command.output === "artifact" || command.kind === "python" || command.kind === "shell") return "Files/logs";
  if (command.kind === "file_index") return "File list";
  if (command.kind === "codex_prompt") return "Codex Prompt";
  return "Run result";
}

export function resultTitle(result: Partial<ActionRunRecord> = {}) {
  if (result.status !== "completed") return "Run failed";
  if (result.kind === "prompt_recipe") return "Prompt recipe recorded";
  if (result.kind === "python") return "Python script completed";
  if (result.kind === "shell") return "Shell command completed";
  if (result.kind === "codex_prompt") return "Codex prompt generated";
  if (result.kind === "file_index") return "File list prepared";
  return "Run completed";
}

export function resultDescription(result: Partial<ActionRunRecord> = {}) {
  if (result.status !== "completed") return "Check stderr and result.json to trace the failure.";
  if (result.kind === "prompt_recipe") {
    return "This command does not modify files. It stores a prompt in the runs folder so you can continue with it in chat.";
  }
  if ((result.artifacts || []).length > 0) return "Generated files are available below and in the project artifact viewer.";
  return "Execution logs and result.json were stored in the project runs folder.";
}
