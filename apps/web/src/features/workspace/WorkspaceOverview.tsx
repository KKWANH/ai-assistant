/**
 * WorkspaceOverview — redesigned so the next step is unmistakable.
 *
 * Layout model:
 *  - The outer wrapper is flex-col h-full so the surface tab can flex-1 fill.
 *  - Every workspace shows the same 5 tabs regardless of whether a custom
 *    surface exists. The "Custom screen" tab swaps its content between
 *    SurfaceView (when surface.tsx exists) and an "Add custom screen"
 *    placeholder (when it doesn't). Previously workspaces without a
 *    surface saw a completely different UI; that asymmetry made the
 *    other four tabs (Data / Create & runs / Edit screen / Actions)
 *    look like they didn't exist for those workspaces.
 *  - "Create & runs" and "Edit screen" tabs share a consistent-width panel
 *    (max-w-5xl mx-auto) so they look cohesive.
 */
import { lazy, Suspense, useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
  Search,
  Zap,
  MessageSquare,
  MessageSquarePlus,
  Database,
  Pencil,
  Trash2,
  GitCommit,
  BookText,
  SlidersHorizontal,
  Undo2,
  BrainCircuit,
  Workflow,
  GitBranch,
  SquareTerminal,
  Webhook,
  Copy,
} from "lucide-react";

import {
  useWorkspace,
  useSnapshot,
  useScanWorkspace,
  useRuns,
  useActionDefs,
  useRunAction,
  useSurface,
  useUpdateWorkspace,
  useChats,
  useCreateChat,
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useTriggers,
  useCreateTrigger,
  useDeleteTrigger,
  useWorkspaceHistory,
  useRewindWorkspaceCommit,
  useMe,
} from "../../lib/queries";
import type { ScheduleFrequency } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { TokenEstimate } from "../../components/ui/TokenEstimate";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary";
import { PageHeader } from "../../components/layout/PageHeader";
import { NotFoundRedirect } from "../../components/NotFoundRedirect";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useUIStore } from "../../lib/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/Tabs";
import { SurfaceView } from "../surface/SurfaceView";
import { FloatingChat } from "../chat/FloatingChat";
import { DataFilesView } from "./DataFilesView";
import { GitPanel } from "./GitPanel";
import { ContextEditor } from "./ContextEditor";
import { resolveProjectHome, resolveProjectHomeScreen } from "../../projects";
import { MemoryPanel } from "../memory/MemoryPanel";
import { HooksPanel } from "../hooks/HooksPanel";
import { templateName, templateDescription } from "../../lib/templateLabels";
import type { WorkspaceVisibility } from "@ariadne/shared";

// The CodeMirror-backed editors are heavy; load them only when their tab opens.
const SurfaceEditor = lazy(() =>
  import("../surface/SurfaceEditor").then((m) => ({ default: m.SurfaceEditor }))
);
const ActionsEditor = lazy(() =>
  import("./ActionsEditor").then((m) => ({ default: m.ActionsEditor }))
);
const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel }))
);

/** Centered spinner shown while an editor chunk loads. */
function EditorFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

/** The workspace name in the page header — click the pencil (or double-click the name) to rename. */
function WorkspaceTitle({ workspaceId, name }: { workspaceId: string; name: string }) {
  const { t } = useT();
  const updateWorkspace = useUpdateWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== name) {
      void updateWorkspace.mutateAsync({ id: workspaceId, input: { name: next } });
    } else {
      setDraft(name);
    }
  };

  const startRename = () => {
    setDraft(name);
    setRenaming(true);
  };

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(name);
            setRenaming(false);
          }
        }}
        className="min-w-0 w-64 max-w-full rounded border border-border bg-surface-2 px-1.5 text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("workspace.rename")}
      />
    );
  }

  return (
    <span className="group inline-flex min-w-0 items-center gap-1.5">
      <span
        onDoubleClick={startRename}
        title={t("workspace.renameHint")}
        className="-mx-1 min-w-0 truncate cursor-text rounded px-1 transition-colors hover:bg-surface-3"
      >
        {name}
      </span>
      <button
        onClick={startRename}
        aria-label={t("workspace.rename")}
        title={t("workspace.rename")}
        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </span>
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

/** Schedules block — list existing, inline 'add' row, toggle/delete. */
function SchedulesSection({
  workspaceId,
  actionOptions,
}: {
  workspaceId: string;
  actionOptions: { id: string; name: string }[];
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { data: schedules } = useSchedules(workspaceId);
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const runAction = useRunAction();

  const [adding, setAdding] = useState(false);
  const [actionId, setActionId] = useState(actionOptions[0]?.id ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>("daily");
  const [runningId, setRunningId] = useState<string | null>(null);

  const freqLabel = (f: ScheduleFrequency): string =>
    f === "hourly"
      ? t("schedules.freq.hourly")
      : f === "daily"
        ? t("schedules.freq.daily")
        : f === "weekly"
          ? t("schedules.freq.weekly")
          : t("schedules.freq.monthly");

  const actionName = (id: string): string =>
    actionOptions.find((a) => a.id === id)?.name ?? id;

  const fmt = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleString() : t("schedules.never");

  const submitNew = async () => {
    if (!actionId) return;
    try {
      await createSchedule.mutateAsync({
        workspaceId,
        input: { workspaceId, actionId, frequency },
      });
      setAdding(false);
    } catch {
      toast({ title: t("schedules.failed"), variant: "error" });
    }
  };

  // "Run now" reuses the manual action-run path — the schedule row itself
  // has no ad-hoc trigger; firing the underlying action is the same thing
  // the scheduler does on a tick. Lets the user test a schedule without
  // waiting for the next 09:00.
  const runNow = async (id: string, actId: string) => {
    setRunningId(id);
    try {
      await runAction.mutateAsync({ workspaceId, actionId: actId });
      toast({ title: t("schedules.runStarted"), variant: "success" });
    } catch {
      toast({ title: t("schedules.failed"), variant: "error" });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section>
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground mb-0.5 flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            {t("schedules.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("schedules.subtitle")}</p>
        </div>
        {!adding && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAdding(true)}
            className="shrink-0"
          >
            {t("schedules.addAction")}
          </Button>
        )}
      </div>

      {/* Inline add row */}
      {adding && (
        <div className="rounded-lg border border-accent bg-surface-2 px-3 py-2.5 mb-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-2xs text-muted-foreground">{t("schedules.pickAction")}</span>
            <select
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {actionOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-2xs text-muted-foreground">{t("schedules.frequency")}</span>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="hourly">{t("schedules.freq.hourly")}</option>
              <option value="daily">{t("schedules.freq.daily")}</option>
              <option value="weekly">{t("schedules.freq.weekly")}</option>
              <option value="monthly">{t("schedules.freq.monthly")}</option>
            </select>
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(false)}
          >
            {t("schedules.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submitNew()}
            disabled={!actionId || createSchedule.isPending}
            loading={createSchedule.isPending}
          >
            {t("schedules.create")}
          </Button>
        </div>
      )}

      {/* List */}
      {(schedules ?? []).length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground px-1">{t("schedules.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {(schedules ?? []).map((s) => (
            <Card
              key={s.id}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <Clock
                className={`h-3.5 w-3.5 shrink-0 ${s.enabled ? "text-accent" : "text-muted-foreground"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">
                  {actionName(s.actionId)}
                  <span className="ml-2 text-2xs text-muted-foreground">
                    · {freqLabel(s.frequency)}
                  </span>
                </div>
                <div className="text-2xs text-muted-foreground mt-0.5">
                  {t("schedules.nextRun")}: {fmt(s.nextRunAt)}
                  <span className="mx-2">·</span>
                  {t("schedules.lastRun")}: {fmt(s.lastRunAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runNow(s.id, s.actionId)}
                disabled={runningId === s.id}
                className="inline-flex items-center gap-1 text-2xs px-2 py-1 rounded-md border border-border text-foreground hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-50"
                title={t("schedules.runNow")}
              >
                <Play className="h-3 w-3" />
                {t("schedules.runNow")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void updateSchedule.mutateAsync({
                    id: s.id,
                    input: { enabled: !s.enabled },
                  })
                }
                className="text-2xs px-2 py-1 rounded-md border border-border text-foreground hover:bg-surface-3 transition-colors shrink-0"
                title={s.enabled ? t("schedules.enabled") : t("schedules.paused")}
              >
                {s.enabled ? t("schedules.enabled") : t("schedules.paused")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void confirm({ message: t("schedules.confirmDelete"), danger: true }).then((ok) => {
                    if (ok)
                      void deleteSchedule.mutateAsync({
                        id: s.id,
                        workspaceId: s.workspaceId,
                      });
                  })
                }
                aria-label={t("schedules.delete")}
                title={t("schedules.delete")}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-surface-3 transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/** Event triggers — webhook URLs that fire a workspace action when POSTed to.
 *  The secret in the URL is the auth; copy it into CI / a file-watcher / etc. */
function TriggersSection({
  workspaceId,
  actionOptions,
}: {
  workspaceId: string;
  actionOptions: { id: string; name: string }[];
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { data: triggers } = useTriggers(workspaceId);
  const createTrigger = useCreateTrigger();
  const deleteTrigger = useDeleteTrigger();

  const [adding, setAdding] = useState(false);
  const [actionId, setActionId] = useState(actionOptions[0]?.id ?? "");

  const actionName = (id: string): string =>
    actionOptions.find((a) => a.id === id)?.name ?? id;
  const urlFor = (secret: string): string => `${window.location.origin}/api/triggers/${secret}`;

  const submitNew = async () => {
    if (!actionId) return;
    try {
      await createTrigger.mutateAsync({ workspaceId, input: { workspaceId, actionId } });
      setAdding(false);
    } catch {
      toast({ title: t("triggers.failed"), variant: "error" });
    }
  };

  const copyUrl = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(urlFor(secret));
      toast({ title: t("triggers.copied"), variant: "success" });
    } catch {
      toast({ title: t("triggers.copyFailed"), variant: "error" });
    }
  };

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground mb-0.5 flex items-center gap-2">
            <Webhook className="h-4 w-4 text-accent" />
            {t("triggers.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("triggers.subtitle")}</p>
        </div>
        {!adding && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setAdding(true)}
            className="shrink-0"
          >
            {t("triggers.add")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border border-accent bg-surface-2 px-3 py-2.5 mb-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <span className="text-2xs text-muted-foreground">{t("triggers.pickAction")}</span>
            <select
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {actionOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
            {t("schedules.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submitNew()}
            disabled={!actionId || createTrigger.isPending}
            loading={createTrigger.isPending}
          >
            {t("triggers.create")}
          </Button>
        </div>
      )}

      {(triggers ?? []).length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground px-1">{t("triggers.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {(triggers ?? []).map((tr) => (
            <Card key={tr.id} className="flex items-center gap-3 px-4 py-2.5">
              <Webhook className="h-3.5 w-3.5 shrink-0 text-accent" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{actionName(tr.actionId)}</div>
                <div className="text-2xs text-muted-foreground font-mono truncate">{urlFor(tr.secret)}</div>
              </div>
              <button
                type="button"
                onClick={() => void copyUrl(tr.secret)}
                className="text-2xs px-2 py-1 rounded-md border border-border text-foreground hover:bg-surface-3 transition-colors shrink-0 inline-flex items-center gap-1"
                title={t("triggers.copy")}
              >
                <Copy className="h-3 w-3" />
                {t("triggers.copy")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void confirm({ message: t("triggers.confirmDelete"), danger: true }).then((ok) => {
                    if (ok) void deleteTrigger.mutateAsync({ id: tr.id, workspaceId });
                  })
                }
                aria-label={t("triggers.delete")}
                title={t("triggers.delete")}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-surface-3 transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compact history list — auto-versioned commits of `.ariadne/` per run. */
function HistorySection({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { data: commits } = useWorkspaceHistory(workspaceId, 12);
  const rewind = useRewindWorkspaceCommit();
  // Hide entirely when there's nothing to show — keeps the overview
  // clean for workspaces that haven't run anything yet (or where git
  // isn't on the host).
  if (!commits || commits.length === 0) return null;

  const doRewind = async (sha: string) => {
    if (!(await confirm({ message: t("workspace.history.rewindConfirm"), danger: true }))) return;
    try {
      const result = await rewind.mutateAsync({ workspaceId, sha });
      toast({
        title: t("workspace.history.rewindSuccess", { n: result.restored.length }),
        variant: "success",
      });
    } catch (err) {
      toast({
        title: t("workspace.history.rewindFailed"),
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          <GitCommit className="h-3.5 w-3.5" />
          {t("workspace.history.title")}
        </h2>
        <Link
          to={`/workspaces/${workspaceId}/history`}
          className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("workspace.history.viewAll")} →
        </Link>
      </div>
      <div className="flex flex-col gap-1">
        {commits.map((c) => (
          <div
            key={c.sha}
            className="flex items-center gap-3 px-3 py-1.5 rounded-md border border-border bg-background group"
          >
            <span className="font-mono text-2xs text-muted-foreground shrink-0">
              {c.shortSha}
            </span>
            <span className="text-xs text-foreground truncate flex-1">
              {c.message}
            </span>
            <span className="text-2xs text-muted-foreground shrink-0">
              {c.filesChanged > 0
                ? t("workspace.history.filesChanged", { n: c.filesChanged })
                : ""}
            </span>
            <span className="text-2xs text-muted-foreground shrink-0">
              {new Date(c.timestamp).toLocaleString()}
            </span>
            {/* Rewind only on apply-commits; hidden until hover so a long
                history list isn't a wall of buttons. */}
            {c.applyRunId && (
              <button
                type="button"
                onClick={() => void doRewind(c.sha)}
                disabled={rewind.isPending}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-all"
                aria-label={t("workspace.history.rewind")}
                title={t("workspace.history.rewind")}
              >
                <Undo2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceOverview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const { setActiveRunId } = useUIStore();
  // Per-workspace "Advanced view": this workspace's saved override, falling back
  // to the global default. Persisted, so the choice sticks per workspace.
  const globalAdvanced = useUIStore((s) => s.workspaceAdvanced);
  const advancedOverride = useUIStore((s) => s.workspaceAdvancedById[id ?? ""]);
  const setWorkspaceAdvancedFor = useUIStore((s) => s.setWorkspaceAdvancedFor);
  const workspaceAdvanced = advancedOverride ?? globalAdvanced;
  const scan = useScanWorkspace();
  const updateWorkspace = useUpdateWorkspace();

  const { data: ws, isLoading: wsLoading } = useWorkspace(id ?? "");
  const { data: me } = useMe();
  // Simple/Easy mode users don't see the power-user tabs (hooks runs
  // arbitrary shell, memory is fine to keep). Memory stays visible
  // because non-developers benefit from it too.
  const isSimple = me?.account.mode === "simple";
  // The terminal is a LOCAL-only capability (the server refuses it over remote
  // access), so its tab is hidden for remote sessions.
  const isRemote = me?.accessContext === "remote";
  const { data: snapshot } = useSnapshot(id ?? "");
  const { data: runs } = useRuns(id ?? undefined);
  const { data: actionDefs } = useActionDefs(id ?? "");
  const { data: surfaceData } = useSurface(id ?? "");
  const { data: chats } = useChats();
  const createChat = useCreateChat();
  const runAction = useRunAction();

  // AT — controlled tab state. Declared ABOVE the early returns so the
  // hooks order stays stable across renders (React error #310 otherwise).
  // Auto-switches to "surface" once the surface query resolves with
  // exists=true, unless the user has already picked a tab themselves.
  const surfaceExists = surfaceData?.state?.exists ?? false;
  // A project (e.g. lecture) contributes a default home SCREEN rendered inside
  // this shell. Priority on the screen tab: a user surface > the project home >
  // the empty "add a screen" state.
  const projectHome = ws ? resolveProjectHomeScreen(ws) : null;
  const hasProjectHome = projectHome != null;
  const [activeTab, setActiveTab] = useState<string>("chats");
  const [userPickedTab, setUserPickedTab] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    if (userPickedTab) return;
    if (surfaceData === undefined) return;
    // Land on the screen tab when there's something to show (a user surface or a
    // project home), else fall back to chats — also resets a stale "surface" tab
    // carried over when switching from a screen workspace to a plain one (same
    // route, no remount).
    const wantsScreen = surfaceExists || hasProjectHome;
    if (wantsScreen && activeTab !== "surface") setActiveTab("surface");
    else if (!wantsScreen && activeTab === "surface") setActiveTab("chats");
  }, [surfaceData, surfaceExists, hasProjectHome, userPickedTab, activeTab]);
  // Turning Advanced off while on a power tab → fall back to chats so the
  // user isn't stranded on a now-hidden tab.
  useEffect(() => {
    if (!workspaceAdvanced && ["standard", "edit", "actions", "schedules", "memory", "hooks", "git", "terminal"].includes(activeTab)) {
      setActiveTab("chats");
    }
  }, [workspaceAdvanced, activeTab]);

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // Loading finished but no workspace — it was deleted (or never existed).
  if (!ws) return <NotFoundRedirect />;

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

  const handleRunAction = async (actionId: string) => {
    try {
      const run = await runAction.mutateAsync({ workspaceId: ws.id, actionId });
      navigate(`/runs/${run.id}`);
    } catch {
      toast({ title: t("actions.runFailed"), variant: "error" });
    }
  };

  const workspaceChats = (chats ?? []).filter((c) => c.workspaceId === ws.id);

  const lastScan = ws.lastScanAt
    ? new Date(ws.lastScanAt).toLocaleString()
    : t("workspace.neverScanned");

  const hasSnapshot = !!snapshot;
  const hasRuns = runs && runs.length > 0;
  // The unified create-and-run list: built-in templates (category-scoped on the
  // server) plus the workspace's own block-pipeline actions.
  const templates = actionDefs?.templates ?? [];
  const customActions = actionDefs?.actions ?? [];
  const hasCreatables = templates.length > 0 || customActions.length > 0;
  const hasSurface = surfaceExists;

  // ── Chats block — workspace-scoped conversations + "new chat" CTA.
  //    Z1: promoted out of StandardView into its own first tab so chat
  //    is the workspace's top-level surface, not buried under
  //    "Create & Run".
  const ChatsBlock = (
    <section>
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground mb-0.5 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            {t("workspace.chats.title")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("workspace.chats.subtitle")}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<MessageSquarePlus className="h-3.5 w-3.5" />}
          loading={createChat.isPending}
          onClick={() => void handleNewChatHere()}
          className="shrink-0"
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
              <span className="text-2xs text-muted-foreground shrink-0">
                {new Date(c.updatedAt).toLocaleDateString()}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </Card>
          ))}
        </div>
      ) : (
        <Card className="px-6 py-8 flex flex-col items-center gap-3 text-center bg-surface-2">
          <div className="h-10 w-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-accent" />
          </div>
          <div className="max-w-md">
            <p className="text-sm font-medium text-foreground mb-1">
              {t("workspace.chats.empty.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("workspace.chats.empty.body")}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<MessageSquarePlus className="h-3.5 w-3.5" />}
            loading={createChat.isPending}
            onClick={() => void handleNewChatHere()}
          >
            {t("workspace.chats.new")}
          </Button>
        </Card>
      )}
    </section>
  );

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

      {/* Conversations section moved to its own first tab (Z1). The
          Standard tab now focuses on templates + runs only. */}

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

        {hasCreatables ? (
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
                  <p className="text-sm font-medium text-foreground">{templateName(tmpl, t)}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {templateDescription(tmpl, t)}
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
            {customActions.map((action) => (
              <Card
                key={action.id}
                interactive
                className="flex items-center gap-4 px-4 py-3.5 group"
                onClick={() => void handleRunAction(action.id)}
              >
                <div className="h-8 w-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <Zap className="h-4 w-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{action.name}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {action.description ||
                      t("workspace.create.actionDesc", { n: action.blocks.length })}
                  </p>
                </div>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-colors shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRunAction(action.id);
                  }}
                >
                  {t("workspace.create.runBtn")}
                  <Play className="h-3 w-3" />
                </button>
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
                  <div className="flex items-center gap-3 mt-0.5 text-2xs text-muted-foreground">
                    <span>{run.createdByName ?? "—"}</span>
                    <span>·</span>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    {run.evidenceCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("runs.detail.claims", { n: run.evidenceCount })}
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
            {templates.length > 0 && (
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

      {/* Workspace history — auto-committed snapshot of every run's
          .ariadne/ artifacts. Hidden when git isn't available or there
          are no commits yet. */}
      <HistorySection workspaceId={ws.id} />

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
          title={<WorkspaceTitle workspaceId={ws.id} name={ws.name} />}
          description={
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{ws.rootPath}</span>
              {/* Visibility badge — public means any authenticated account
                  can READ this workspace's files / runs / surface, but only
                  the owner (or an admin) can modify, scan, or delete it.
                  See routes/workspaceGuard.ts for the split. */}
              {ws.visibility === "public" ? (
                <span className="flex items-center gap-1 text-2xs text-accent font-medium">
                  <Globe className="h-3 w-3" />
                  {t("workspace.visibility.public")}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {t("workspace.visibility.private")}
                </span>
              )}
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              {/* Advanced toggle — reveals power tabs + secondary actions.
                  Off by default for a clean view; the power user flips it on
                  (persists across workspaces this session). */}
              <Button
                variant={workspaceAdvanced ? "secondary" : "ghost"}
                size="sm"
                leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                onClick={() => setWorkspaceAdvancedFor(id ?? "", !workspaceAdvanced)}
                title={t("workspace.advanced.tip")}
              >
                {t("workspace.advanced.label")}
              </Button>
              {/* A way back to this workspace's home view, if it has one —
                  a project's (e.g. lecture → /lecture) or a custom screen set
                  as main. Generic, registry-driven; no vertical hardcoded. */}
              {(() => {
                const home =
                  resolveProjectHome(ws) ??
                  (ws.homeView === "surface" ? `/workspaces/${ws.id}/screen` : null);
                return home ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Layout className="h-3.5 w-3.5" />}
                    onClick={() => navigate(home)}
                  >
                    {t("workspace.homeView.mainScreen")}
                  </Button>
                ) : null;
              })()}
              {workspaceAdvanced && (
                <>
                  {/* Visibility toggle — owner/admin only. */}
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
                    variant="ghost"
                    size="sm"
                    leftIcon={<BookText className="h-3.5 w-3.5" />}
                    onClick={() => setContextOpen(true)}
                    title={t("workspace.context.desc")}
                  >
                    {t("workspace.context.button")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Search className="h-3.5 w-3.5" />}
                    onClick={() => navigate(`/workspaces/${ws.id}/search`)}
                  >
                    {t("workspace.search.button")}
                  </Button>
                </>
              )}
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

      {/* All workspaces show the same 5 tabs. The Custom screen tab swaps
          its body between SurfaceView and an "Add custom screen" placeholder
          depending on whether .ariadne/surface.tsx exists. The other four
          tabs are independent of the surface and always functional. */}
      <Tabs
        // AO/AT: Controlled tab state instead of defaultValue + key remount.
        // The key trick stopped reliably triggering after Tabs internal
        // state was already set; switched to fully-controlled `value` +
        // `onValueChange` + an effect that flips to surface once the
        // surface query resolves with exists=true.
        value={activeTab}
        onValueChange={(v) => { setActiveTab(v); setUserPickedTab(true); }}
        className="flex flex-col flex-1 min-h-0"
      >
        {/* Tab bar — pinned, scrollable on narrow screens */}
        <div className="shrink-0 px-5 border-b border-border">
          <TabsList>
            <TabsTrigger value="chats">
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                {t("workspace.chats.tab")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="surface">
              <span className="flex items-center gap-1.5" title={t("workspace.surface.tip.customScreen")}>
                <Layout className="h-3.5 w-3.5" />
                {/* "Custom screen" only when it's a user-authored surface; a
                    project's own home screen is just "Screen". */}
                {hasProjectHome && !surfaceExists
                  ? t("workspace.surface.screen")
                  : t("workspace.surface.customScreen")}
              </span>
            </TabsTrigger>
            <TabsTrigger value="data">
              <span className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                {t("workspace.data.tab")}
              </span>
            </TabsTrigger>
            {/* Power tabs — hidden until "Advanced" is on, so the default
                view is just talk / dashboard / files. */}
            {workspaceAdvanced && (
              <>
                <TabsTrigger value="standard">
                  <span className="flex items-center gap-1.5" title={t("workspace.surface.tip.templates")}>
                    <Play className="h-3.5 w-3.5" />
                    {t("workspace.surface.createRuns")}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="edit">
                  <span className="flex items-center gap-1.5" title={t("workspace.surface.tip.editScreen")}>
                    <Code2 className="h-3.5 w-3.5" />
                    {t("workspace.surface.editScreen")}
                  </span>
                </TabsTrigger>
                {!isSimple && (
                  <TabsTrigger value="actions">
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      {t("workspace.actions.tab")}
                    </span>
                  </TabsTrigger>
                )}
                {!isSimple && (
                  <TabsTrigger value="schedules">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {t("workspace.schedules.tab")}
                    </span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="memory">
                  <span className="flex items-center gap-1.5" title={t("workspace.surface.tip.memory")}>
                    <BrainCircuit className="h-3.5 w-3.5" />
                    {t("memory.tab")}
                  </span>
                </TabsTrigger>
                {!isSimple && (
                  <TabsTrigger value="hooks">
                    <span className="flex items-center gap-1.5">
                      <Workflow className="h-3.5 w-3.5" />
                      {t("hooks.tab")}
                    </span>
                  </TabsTrigger>
                )}
                {!isSimple && (
                  <TabsTrigger value="git">
                    <span className="flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5" />
                      {t("git.tab")}
                    </span>
                  </TabsTrigger>
                )}
                {!isSimple && !isRemote && (
                  <TabsTrigger value="terminal">
                    <span className="flex items-center gap-1.5">
                      <SquareTerminal className="h-3.5 w-3.5" />
                      {t("terminal.tab")}
                    </span>
                  </TabsTrigger>
                )}
              </>
            )}
          </TabsList>
        </div>

        {/* Chats — the primary surface. Lifted out of the Standard
            tab so chatting is one click in, not buried under "Create
            & Run". */}
        <TabsContent value="chats" className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>{ChatsBlock}</WorkspacePanel>
        </TabsContent>

        {/* Custom screen — fills the remaining height. When surface.tsx
            exists, render it. Otherwise show a centred "add custom screen"
            placeholder so the empty state explains the next step. */}
        <TabsContent value="surface" className="relative flex-1 flex flex-col min-h-0 p-0">
          {hasSurface ? (
            <div className="flex-1 flex flex-col min-h-0 p-4">
              {/* Set this custom screen as the workspace's immersive main
                  home (the general version of the lecture-prep pattern). */}
              <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span className="text-2xs text-muted-foreground sm:mr-auto">
                  {t("workspace.homeView.tip")}
                </span>
                {/* Always-visible edit affordance — the "화면 편집" tab is gated
                    behind the (default-off) Advanced toggle, and the empty-state
                    "화면 추가" shortcut vanishes once a surface exists, so a
                    populated custom screen otherwise has no discoverable editor. */}
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => navigate(`/workspaces/${ws.id}/surface/edit`)}
                >
                  {t("workspace.surface.editScreen")}
                </Button>
                <Button
                  variant={ws.homeView === "surface" ? "secondary" : "ghost"}
                  size="sm"
                  leftIcon={
                    ws.homeView === "surface" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Layout className="h-3.5 w-3.5" />
                    )
                  }
                  loading={updateWorkspace.isPending}
                  onClick={() =>
                    void updateWorkspace.mutateAsync({
                      id: ws.id,
                      input: { homeView: ws.homeView === "surface" ? "overview" : "surface" },
                    })
                  }
                >
                  {ws.homeView === "surface"
                    ? t("workspace.homeView.isMain")
                    : t("workspace.homeView.setMain")}
                </Button>
              </div>
              {/* BD2 — surfaces are user-authored React bundles (the
                  highest crash risk in the app). Its own boundary so a
                  broken surface shows a Retry card in THIS tab while the
                  other workspace tabs (chat, data, runs) keep working. */}
              <ErrorBoundary label="커스텀 화면을 불러오는 중 문제가 발생했어요">
                <SurfaceView workspaceId={ws.id} />
              </ErrorBoundary>
            </div>
          ) : projectHome ? (
            // A project's default home (e.g. lecture), rendered in the SAME shell
            // — so a project workspace gets the same chrome as a custom-surface
            // one. A user can still author a surface (Advanced → Edit screen) to
            // override it. Own boundary + Suspense so the tabs stay live.
            <ErrorBoundary label="화면을 불러오는 중 문제가 발생했어요">
              <Suspense fallback={<EditorFallback />}>
                <div className="flex-1 flex flex-col min-h-0">{projectHome}</div>
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              <WorkspacePanel>
                <div className="rounded-xl border border-border border-dashed px-6 py-10 flex flex-col items-center text-center gap-3 max-w-2xl mx-auto">
                  <Layout className="h-8 w-8 text-muted-foreground" />
                  <p className="text-base font-medium text-foreground">
                    {t("workspace.surface.addTitle")}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {t("workspace.surface.addBody")}
                  </p>
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
          {/* Chat over the screen — only when there's a real screen to chat about. */}
          {(surfaceExists || hasProjectHome) && <FloatingChat workspaceId={ws.id} />}
        </TabsContent>

        {/* Data — view & edit CSV files (independent of surface) */}
        <TabsContent value="data" className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>
            <DataFilesView workspaceId={ws.id} />
          </WorkspacePanel>
        </TabsContent>

        {/* Create & runs — templates + runs list, independent of surface */}
        <TabsContent value="standard" className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>{StandardView}</WorkspacePanel>
        </TabsContent>

        {/* Edit screen — surface.tsx editor. Doubles as the entry point
            for creating a surface when none exists yet. */}
        <TabsContent value="edit" className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>
            <Suspense fallback={<EditorFallback />}>
              <SurfaceEditor workspaceId={ws.id} />
            </Suspense>
          </WorkspacePanel>
        </TabsContent>

        {/* Actions editor — workspace actions.yaml, independent of
            surface. Hidden in Simple mode alongside Hooks (matches
            translator-qa §4: "에이전트" wording in the placeholder is
            too heavy for non-devs; consistent with how Hooks is
            handled). Standard users still see it. */}
        {!isSimple && (
          <TabsContent value="actions" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              <Suspense fallback={<EditorFallback />}>
                <ActionsEditor workspaceId={ws.id} />
              </Suspense>
            </WorkspacePanel>
          </TabsContent>
        )}

        {/* Schedules — recurring runs of a workspace action. Promoted out
            of "Create & runs" into its own tab next to Actions so the
            already-running scheduler is visible, not buried (PLANNED Bet 1). */}
        {!isSimple && (
          <TabsContent value="schedules" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              {customActions.length > 0 ? (
                <>
                  {/* Surface where automated output lands — a scheduled/triggered
                      run produces a Run (the brief) visible under Create & runs. */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab("standard"); setUserPickedTab(true); }}
                    className="text-2xs text-accent hover:underline mb-3"
                  >
                    {t("schedules.viewRuns")}
                  </button>
                  <SchedulesSection
                    workspaceId={ws.id}
                    actionOptions={customActions.map((a) => ({ id: a.id, name: a.name }))}
                  />
                  <TriggersSection
                    workspaceId={ws.id}
                    actionOptions={customActions.map((a) => ({ id: a.id, name: a.name }))}
                  />
                </>
              ) : (
                <Card className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t("schedules.needAction")}</p>
                </Card>
              )}
            </WorkspacePanel>
          </TabsContent>
        )}

        {/* Workspace memory — promotion-gated facts the AI uses as
            context on every chat against this workspace. */}
        <TabsContent value="memory" className="flex-1 overflow-y-auto min-h-0">
          <WorkspacePanel>
            <MemoryPanel workspaceId={ws.id} />
          </WorkspacePanel>
        </TabsContent>

        {/* Hooks — per-workspace commands that fire on key events
            (staged_apply, post_scan, memory_added). Local-only edit.
            TabsContent stays mounted but the trigger above is hidden
            in Simple mode, so it's never reachable by non-power users. */}
        {!isSimple && (
          <TabsContent value="hooks" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              <HooksPanel workspaceId={ws.id} />
            </WorkspacePanel>
          </TabsContent>
        )}
        {/* Git — the workspace's own repo: status, per-file diff, commit.
            Power-user surface, hidden in Simple mode like Hooks. */}
        {!isSimple && (
          <TabsContent value="git" className="flex-1 overflow-y-auto min-h-0">
            <WorkspacePanel>
              <GitPanel workspaceId={ws.id} />
            </WorkspacePanel>
          </TabsContent>
        )}
        {/* Terminal — a real shell in the workspace root. Local-only (the server
            refuses it remotely) + power-user, so gated on !isSimple && !isRemote.
            xterm is heavy, hence lazy-loaded. Fills the tab (no WorkspacePanel
            padding — the terminal manages its own chrome). */}
        {!isSimple && !isRemote && (
          <TabsContent value="terminal" className="flex-1 min-h-0">
            <Suspense fallback={<EditorFallback />}>
              <TerminalPanel workspaceId={ws.id} />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>

      {contextOpen && <ContextEditor workspaceId={ws.id} onClose={() => setContextOpen(false)} />}
    </div>
  );
}
