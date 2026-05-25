/**
 * Tiny strip at the top of a workspace-scoped chat. Surfaces three
 * things every workspace-attached reply already uses:
 *
 *   - Workspace name (links to /workspaces/:id)
 *   - Memory count (links to the Memory tab)
 *   - MCP server count (links to Settings → MCP)
 *
 * Pure discoverability. None of these features have a place to surface
 * inside the chat composer today — without this strip, a new user has
 * no way to know memory or MCP exist while they're chatting.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Network, FolderOpen } from "lucide-react";
import { useWorkspace } from "../../lib/queries";
import { listWorkspaceMemory, listMcpServers } from "../../lib/api";
import { useT } from "../../lib/i18n";

export function WorkspaceContextStrip({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  // Three lightweight reads, all cached. Each chip hides at count=0 so
  // a brand-new workspace doesn't show empty affordances.
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: memoryResp } = useQuery({
    queryKey: ["workspace-memory", workspaceId],
    queryFn: () => listWorkspaceMemory(workspaceId),
  });
  const { data: mcpServers } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => listMcpServers(),
  });
  const memoryCount = memoryResp?.memories.length ?? 0;
  const mcpCount = (mcpServers ?? []).filter((s) => s.enabled).length;
  if (!workspace) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-2xs text-muted-foreground">
      <Link
        to={`/workspaces/${workspaceId}`}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-2 hover:text-foreground hover:bg-surface-3 transition-colors"
      >
        <FolderOpen className="h-3 w-3" />
        <span className="truncate max-w-[140px]">{workspace.name}</span>
      </Link>
      {memoryCount > 0 && (
        <Link
          to={`/workspaces/${workspaceId}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-2 hover:text-foreground hover:bg-surface-3 transition-colors"
          title={t("chat.contextStrip.memoryTitle")}
        >
          <BrainCircuit className="h-3 w-3 text-accent" />
          {/* English needs proper plural — "1 memory" vs "N memories". Korean
              ignores the distinction so memoryCountPlural === memoryCount
              in ko.ts. */}
          {t(memoryCount === 1 ? "chat.contextStrip.memoryCount" : "chat.contextStrip.memoryCountPlural", {
            n: memoryCount.toString(),
          })}
        </Link>
      )}
      {mcpCount > 0 && (
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-2 hover:text-foreground hover:bg-surface-3 transition-colors"
          title={t("chat.contextStrip.mcpTitle")}
        >
          <Network className="h-3 w-3 text-accent" />
          {t("chat.contextStrip.mcpCount", { n: mcpCount.toString() })}
        </Link>
      )}
    </div>
  );
}
