import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, queryKeys } from "../api/client";
import { parseProjectConnections } from "../contracts/guards";
import type { ProjectConnectionsPayload } from "../contracts/workbench";

type ConnectionResponse = { connections?: ProjectConnectionsPayload };

export function useProjectConnections(projectPath: string, initial?: ProjectConnectionsPayload | null) {
  return useQuery({
    queryKey: queryKeys.projectConnections(projectPath),
    queryFn: async () => {
      const payload = await apiJson<ConnectionResponse>(`/api/project-connections/${projectPath}`);
      return parseProjectConnections(payload.connections);
    },
    initialData: initial || undefined,
    staleTime: initial ? 30_000 : 0,
    enabled: Boolean(projectPath),
  });
}

export function useProjectLinkMutations(projectPath: string, onConnections?: (connections: ProjectConnectionsPayload) => void) {
  const queryClient = useQueryClient();

  async function mutate(body: URLSearchParams) {
    const payload = await apiJson<ConnectionResponse>(`/api/project-connections/${projectPath}`, { method: "POST", body });
    const connections = parseProjectConnections(payload.connections);
    queryClient.setQueryData(queryKeys.projectConnections(projectPath), connections);
    onConnections?.(connections);
    return connections;
  }

  const request = useMutation({
    mutationFn: (input: { sourceProject: string; resourceTypes: string[]; mode: string }) => {
      const body = new URLSearchParams({
        action: "request",
        source_project: input.sourceProject,
        resource_types: input.resourceTypes.join(","),
        mode: input.mode,
      });
      return mutate(body);
    },
  });

  const approve = useMutation({
    mutationFn: (linkId: string) => mutate(new URLSearchParams({ action: "approve", link_id: linkId })),
  });

  const revoke = useMutation({
    mutationFn: (linkId: string) => mutate(new URLSearchParams({ action: "revoke", link_id: linkId })),
  });

  return { request, approve, revoke };
}
