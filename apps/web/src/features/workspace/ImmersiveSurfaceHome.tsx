/**
 * ImmersiveSurfaceHome — a workspace's custom screen shown as a clean,
 * tab-less main home. This is the general "immersive home" the lecture view
 * pioneered, now an option any workspace can turn on (homeView === "surface").
 * Minimal header with an escape hatch to the full tabbed overview; the global
 * sidebar can still be collapsed for max focus via the app's own control.
 */
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { useT } from "../../lib/i18n";
import * as api from "../../lib/api";
import { SurfaceView } from "../surface/SurfaceView";
import { FloatingChat } from "../chat/FloatingChat";

export function ImmersiveSurfaceHome() {
  const { t } = useT();
  const { id: workspaceId = "" } = useParams<{ id: string }>();
  const { data: ws } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api.getWorkspace(workspaceId),
    enabled: !!workspaceId,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h1 className="min-w-0 truncate text-sm font-semibold">{ws?.name ?? ""}</h1>
        <Link
          to={`/workspaces/${workspaceId}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-surface-3 hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" /> {t("workspace.overviewLink")}
        </Link>
      </div>
      <div className="relative min-h-0 flex-1 flex flex-col">
        <SurfaceView workspaceId={workspaceId} />
        {workspaceId && <FloatingChat workspaceId={workspaceId} />}
      </div>
    </div>
  );
}
