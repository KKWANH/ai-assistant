/**
 * WorkspaceOverview — redesigned so the next step is unmistakable.
 *
 * Layout model:
 *  - The outer wrapper is flex-col h-full so the surface tab can flex-1 fill.
 *  - "Custom screen" tab: SurfaceView gets flex-1, fills entire main area.
 *  - "Create & runs" and "Edit screen" tabs share a consistent-width panel
 *    (max-w-5xl mx-auto) so they look cohesive.
 */
import { lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  RefreshCw,
  Play,
  FileText,
  Clock,
  AlertTriangle,
  EyeOff,
  Cpu,
  ChevronRight,
  CheckCircle2,
  ArrowRight,
  Layout,
  Code2,
  Plus,
  Globe,
  Lock,
  Zap,
  MessageSquare,
} from "lucide-react";

import {
  useWorkspace,
  useSnapshot,
  useScanWorkspace,
  useRuns,
  useTemplates,
  useSurface,
  useUpdateWorkspace,
  useChats,
  useCreateChat,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { TokenEstimate } from "../../components/ui/TokenEstimate";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useUIStore } from "../../lib/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/Tabs";
import { SurfaceView } from "../surface/SurfaceView";
import type { WorkspaceVisibility } from "@ariadne/shared";

// The CodeMirror-backed editors are heavy; load them only when their tab opens.
const SurfaceEditor = lazy(() =>
  import("../surface/SurfaceEditor").then((m) => ({ default: m.SurfaceEditor }))
);
const ActionsEditor = lazy(() =>
  import("./ActionsEditor").then((m) => ({ default: m.ActionsEditor }))
);

/** Centered spinner shown while an editor chunk loads. */
function EditorFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-3.5 w-3.5">{icon}</span>
        <span>{label}</span>
      </div>
      <span
        className={[
          "text-sm font-medium",
          accent ? "text-warning" : "text-foreground",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

/** Consistent-width wrapper used by the non-surface tabs. */
function WorkspacePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl w-full mx-auto px-5 py-5 flex flex-col gap-6">
      {children}
    </div>
  );
}

export function WorkspaceOverview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const { setActiveRunId } = useUIStore();
  const scan = useScanWorkspace();
  const updateWorkspace = useUpdateWorkspace();

  const { data: ws, isLoading: wsLoading } = useWorkspace(id ?? "");
  const { data: snapshot } = useSnapshot(id ?? "");
  const { data: runs } = useRuns(id ?? undefined);
  const { data: templates } = useTemplates();
  const { data: surfaceData } = useSurface(id ?? "");
  const { data: chats } = useChats();
  const createChat = useCreateChat();

  if (wsLoading || !ws) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const handleScan = async () => {
    try {
      await scan.mutateAsync(ws.id);
      toast({ title: t("workspace.scanComplete"), variant: "success" });
    } catch {
      toast({ title: t("workspace.scanFailed"), variant: "error" });
    }
  };

  const handleVisibilityToggle = async () => {
    const next: WorkspaceVisibility = ws.visibility === "public" ? "private" : "public";
    try {
      await updateWorkspace.mutateAsync({ id: ws.id, input: { visibility: next } });
      toast({
        title: next === "public"
          ? t("workspace.visibility.madePublic")
          : t("workspace.visibility.madePrivate"),
        variant: "success",
      });
    } catch {
      toast({ title: t("workspace.visibility.failed"), variant: "error" });
    }
  };

  const handleNewChatHere = async () => {
    try {
      const chat = await createChat.mutateAsync({ workspaceId: ws.id });
      navigate(`/chat/${chat.id}`);
    } catch {
      toast({ title: t("workspace.chats.failed"), variant: "error" });
    }
  };

  const workspaceChats = (chats ?? []).filter((c) => c.workspaceId === ws.id);

  const lastScan = ws.lastScanAt
    ? new Date(ws.lastScanAt).toLocaleString()
    : t("workspace.neverScanned");

  const hasSnapshot = !!snapshot;
  const hasRuns = runs && runs.length > 0;
  const hasTemplates = templates && templates.length > 0;
  const hasSurface = surfaceData?.state?.exists ?? false;

  // ── Standard overview content (templates + runs) ──────────────────────────
  const StandardView = (
    <>
      {/* Snapshot status bar */}
      <Card className="divide-x divide-border flex overflow-hidden p-0">
        <StatPill
          icon={<Clock className="h-3.5 w-3.5" />}
          label={t("workspace.lastScan")}
          value={lastScan}
        />
        <StatPill
          icon={<FileText className="h-3.5 w-3.5" />}
          label={t("workspace.files")}
          value={ws.fileCount.toLocaleString()}
        />
        {snapshot && (
          <>
            <StatPill
              icon={<EyeOff className="h-3.5 w-3.5" />}
              label={t("workspace.ignored")}
              value={snapshot.ignoredCount.toLocaleString()}
            />
            <StatPill
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label={t("workspace.sensitive")}
              value={snapshot.sensitiveCount}
              accent={snapshot.sensitiveCount > 0}
            />
            <StatPill
              icon={<Cpu className="h-3.5 w-3.5" />}
              label={t("workspace.estTokens")}
              value={<TokenEstimate tokens={snapshot.totalEstimatedTokens} />}
            />
          </>
        )}
        {!hasSnapshot && (
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {t("workspace.scanFirst")}
          </div>
        )}
      </Card>

      {/* ── What do you want to create? ─────────────────────────────────── */}
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground mb-0.5">
            {t("workspace.create.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("workspace.create.subtitle")}
          </p>
        </div>

        {hasTemplates ? (
          <div className="grid grid-cols-1 gap-2">
            {templates.map((tmpl) => (
              <Card
                key={tmpl.id}
                interactive
                className="flex items-center gap-4 px-4 py-3.5 group"
                onClick={() => navigate(`/templates/${tmpl.id}?workspaceId=${ws.id}`)}
              >
                <div className="h-8 w-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {tmpl.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {tmpl.evidenceRequired && (
                    <Badge variant="supported" dot>{t("badge.evidence")}</Badge>
                  )}
                  <button
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/templates/${tmpl.id}?workspaceId=${ws.id}`);
                    }}
                  >
                    {t("workspace.create.templateBtn")}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
            <FileText className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">{t("workspace.create.noTemplates.title")}</p>
            <p className="text-sm text-muted-foreground">
              {t("workspace.create.noTemplates.body")}
            </p>
          </div>
        )}
      </section>

      {/* Recent outputs */}
      <section>
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">
          {t("workspace.runs.title")}
        </h2>
        {hasRuns ? (
          <div className="flex flex-col gap-1.5">
            {runs.slice(0, 5).map((run) => (
              <Card
                key={run.id}
                interactive
                className="flex items-center gap-3 px-4 py-2.5"
                onClick={() => {
                  setActiveRunId(run.id);
                  navigate(`/runs/${run.id}`);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {run.id.slice(0, 8)}
                    </span>
                    <Badge variant={run.status} dot>
                      {(
                        {
                          created: t("badge.status.created"),
                          scanning: t("badge.status.scanning"),
                          context_pick: t("badge.status.contextPick"),
                          generating: t("badge.status.generating"),
                          completed: t("badge.status.completed"),
                          failed: t("badge.status.failed"),
                        } as Record<string, string>
                      )[run.status] ?? run.status}
                    </Badge>
                    <span className="text-xs text-foreground truncate flex-1">
                      {run.templateName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                    <span>{run.createdByName ?? "—"}</span>
                    <span>·</span>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    {run.evidenceCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          {run.evidenceCount} claims
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
            <Play className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">
              {t("workspace.runs.empty.title")}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {t("workspace.runs.empty.body")}
            </p>
            {hasTemplates && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play className="h-3.5 w-3.5" />}
                onClick={() =>
                  navigate(`/templates/${templates[0]!.id}?workspaceId=${ws.id}`)
                }
              >
                {t("workspace.runs.getStarted")}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Conversations linked to this workspace */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            {t("workspace.chats.title")}
          </h2>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
            loading={createChat.isPending}
            onClick={() => void handleNewChatHere()}
          >
            {t("workspace.chats.new")}
          </Button>
        </div>
        {workspaceChats.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {workspaceChats.map((c) => (
              <Card
                key={c.id}
                interactive
                className="flex items-center gap-3 px-4 py-2.5"
                onClick={() => navigate(`/chat/${c.id}`)}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">
                  {c.title || t("commandMenu.untitledChat")}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border border-dashed px-6 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("workspace.chats.empty")}</p>
          </div>
        )}
      </section>

      {/* Patterns (secondary info) */}
      {(ws.include.length > 0 || ws.exclude.length > 0) && (
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            {t("workspace.patterns.title")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {ws.include.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("workspace.patterns.include")}</p>
                <div className="flex flex-wrap gap-1">
                  {ws.include.map((p) => (
                    <code
                      key={p}
                      className="px-1.5 py-0.5 text-xs font-mono rounded-md bg-surface-3 text-foreground border border-border"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </div>
            )}
            {ws.exclude.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("workspace.patterns.exclude")}</p>
                <div className="flex flex-wrap gap-1">
                  {ws.exclude.map((p) => (
                    <code
                      key={p}
                      className="px-1.5 py-0.5 text-xs font-mono rounded-md bg-surface-3 text-muted-foreground border border-border"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );

  return (
    /* h-full + flex-col so the surface tab can flex-1 fill */
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip — always visible, does NOT scroll. Full-width px-5 so its
          left edge lines up with the tab bar below. */}
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border bg-background">
        <PageHeader
          icon={<FolderOpen className="h-5 w-5" />}
          title={ws.name}
          description={
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{ws.rootPath}</span>
              {/* Visibility badge */}
              {ws.visibility === "public" ? (
                <span className="flex items-center gap-1 text-[11px] text-accent font-medium">
                  <Globe className="h-3 w-3" />
                  {t("workspace.visibility.public")}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {t("workspace.visibility.private")}
                </span>
              )}
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              {/* Visibility toggle */}
              <Button
                variant="ghost"
                size="sm"
                leftIcon={ws.visibility === "public"
                  ? <Globe className="h-3.5 w-3.5" />
                  : <Lock className="h-3.5 w-3.5" />}
                loading={updateWorkspace.isPending}
                onClick={() => void handleVisibilityToggle()}
              >
                {ws.visibility === "public"
                  ? t("workspace.visibility.makePrivate")
                  : t("workspace.visibility.makePublic")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={scan.isPending}
                onClick={() => void handleScan()}
              >
                {t("workspace.scanFiles")}
              </Button>
            </div>
          }
        />
      </div>

      {hasSurface ? (
        /* Surface workspace: tabs between Surface / Create / Edit / Actions */
        <Tabs defaultValue="surface" className="flex flex-col flex-1 min-h-0">
          {/* Tab bar — pinned, scrollable on narrow screens */}
          <div className="shrink-0 px-5 border-b border-border">
            <TabsList>
              <TabsTrigger value="surface">
                <span className="flex items-center gap-1.5">
                  <Layout className="h-3.5 w-3.5" />
                  {t("workspace.surface.customScreen")}
                </span>
              </TabsTrigger>
              <TabsTrigger value="standard">
                <span className="flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  {t("workspace.surface.createRuns")}
                </span>
              </TabsTrigger>
              <TabsTrigger value="edit">
                <span className="flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5" />
                  {t("workspace.surface.editScreen")}
                </span>
              </TabsTrigger>
              <TabsTrigger value="actions">
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  {t("workspace.actions.tab")}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Custom screen — fills entire remaining height, no max-w cap */}
          <TabsContent value="surface" className="flex-1 flex flex-col min-h-0 p-0">
            <div className="flex-1 flex flex-col min-h-0 p-4">
              <SurfaceView workspaceId={ws.id} />
            </div>
          </TabsContent>

          {/* Create & runs — consistent-width panel */}
          <TabsContent value="standard" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>{StandardView}</WorkspacePanel>
          </TabsContent>

          {/* Edit screen — consistent-width panel */}
          <TabsContent value="edit" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              <Suspense fallback={<EditorFallback />}>
                <SurfaceEditor workspaceId={ws.id} />
              </Suspense>
            </WorkspacePanel>
          </TabsContent>

          {/* Actions editor — consistent-width panel */}
          <TabsContent value="actions" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              <Suspense fallback={<EditorFallback />}>
                <ActionsEditor workspaceId={ws.id} />
              </Suspense>
            </WorkspacePanel>
          </TabsContent>
        </Tabs>
      ) : (
        /* No surface: standard overview + subtle affordance to add one, scrollable */
        <div className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>
            {StandardView}
            <div className="rounded-xl border border-border border-dashed px-5 py-4 flex items-center gap-4">
              <Layout className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t("workspace.surface.addTitle")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("workspace.surface.addBody")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => navigate(`/workspaces/${ws.id}/surface/edit`)}
              >
                {t("workspace.surface.addBtn")}
              </Button>
            </div>
          </WorkspacePanel>
        </div>
      )}
    </div>
  );
}
