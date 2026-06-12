import { useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Clock, FileText, ArrowRight } from "lucide-react";
import { useWorkspaces } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useUIStore } from "../../lib/store";
import { useAutoAnimate } from "@formkit/auto-animate/react";

export function WorkspaceList() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const navigate = useNavigate();
  const { setActiveWorkspaceId, setCreateWorkspaceOpen } = useUIStore();
  const { t } = useT();
  // Smoothly animate cards in / out / reorder as workspaces change (motion).
  const [cardsRef] = useAutoAnimate<HTMLDivElement>();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!workspaces || workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <FolderOpen className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{t("workspace.noWorkspaces.title")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("workspace.noWorkspaces.body")}
          </p>
        </div>
        <Button
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => setCreateWorkspaceOpen(true)}
        >
          {t("workspace.list.newWorkspace")}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-5 max-w-5xl mx-auto w-full overflow-y-auto h-full">
      <PageHeader
        icon={<FolderOpen className="h-5 w-5" />}
        title={t("workspace.list.title")}
        description={t("workspace.list.description")}
        action={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setCreateWorkspaceOpen(true)}
          >
            {t("workspace.list.newWorkspace")}
          </Button>
        }
      />

      <div ref={cardsRef} className="flex flex-col gap-2">
        {workspaces.map((ws) => (
          <Card
            key={ws.id}
            interactive
            className="flex items-center gap-4 px-4 py-3 group"
            onClick={() => {
              setActiveWorkspaceId(ws.id);
              navigate(`/workspaces/${ws.id}`);
            }}
          >
            <div className="h-8 w-8 rounded-lg bg-surface-3 border border-border flex items-center justify-center shrink-0">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{ws.name}</p>
              <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
                {ws.rootPath}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {t("workspace.list.files", { n: ws.fileCount })}
              </span>
              {ws.lastScanAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(ws.lastScanAt).toLocaleDateString()}
                </span>
              )}
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
