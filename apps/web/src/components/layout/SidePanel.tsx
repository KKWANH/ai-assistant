/**
 * SidePanel — the Claude-Code-style right-docked workspace panel. A tab bar over
 * three panes:
 *   - Activity: live background tasks (runs).
 *   - Code:     read-only file viewer for the active workspace.
 *   - Preview:  the workspace's custom surface (live).
 * Toggled from the top bar (store.activityOpen). Rendered ≥lg.
 */
import { useState } from "react";
import { Activity, Code2, Eye } from "lucide-react";
import { useUIStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { ActivityPanel } from "./ActivityPanel";
import { CodePane } from "./CodePane";
import { SurfaceView } from "../../features/surface/SurfaceView";

type Tab = "activity" | "code" | "preview";
const TABS: { key: Tab; Icon: typeof Activity }[] = [
  { key: "activity", Icon: Activity },
  { key: "code", Icon: Code2 },
  { key: "preview", Icon: Eye },
];

export function SidePanel() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("activity");
  const activeWs = useUIStore((s) => s.activeWorkspaceId);

  return (
    <aside
      className="hidden lg:flex flex-col w-80 shrink-0 border-l border-inspector-border/70 bg-inspector/45 glass glass-control backdrop-blur-xl backdrop-saturate-[1.8] overflow-hidden"
      aria-label={t("sidePanel.title")}
    >
      <div className="h-10 shrink-0 flex items-stretch border-b border-inspector-border">
        {TABS.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              "flex-1 flex items-center justify-center gap-1.5 text-xs transition-colors",
              tab === key
                ? "text-foreground border-b-2 border-foreground/60"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(`sidePanel.tab.${key}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "activity" && <ActivityPanel />}
        {tab === "code" &&
          (activeWs ? (
            <CodePane key={activeWs} workspaceId={activeWs} />
          ) : (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">{t("sidePanel.noWorkspace")}</div>
          ))}
        {tab === "preview" &&
          (activeWs ? (
            <div className="h-full">
              <SurfaceView key={activeWs} workspaceId={activeWs} />
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">{t("sidePanel.noWorkspace")}</div>
          ))}
      </div>
    </aside>
  );
}
