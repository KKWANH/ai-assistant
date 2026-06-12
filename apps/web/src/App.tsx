import { lazy, Suspense, type ComponentType } from "react";
import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { PROJECT_ROUTES } from "./projects";
import { CreateWorkspaceDialog } from "./features/workspace/CreateWorkspaceDialog";
import { ReportDialog } from "./features/reports/ReportDialog";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { GlobalCommands } from "./components/GlobalCommands";
import { WorkspaceCommands } from "./components/WorkspaceCommands";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { GlobalSettings } from "./components/GlobalSettings";
import { Keybindings } from "./components/Keybindings";
import { LoginView } from "./features/auth/LoginView";
import { useMe } from "./lib/queries";
import { I18nProvider } from "./lib/i18n";
import { ToastList } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { Spinner, PageSpinner } from "./components/ui/Spinner";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

// Route screens are code-split: each becomes its own chunk, loaded on demand.

/** Wrap a lazy import so a stale chunk (after a redeploy) triggers a page reload
 *  instead of crashing with a chunk-load 404.
 *
 *  Loop guard is a short TIME WINDOW, not a once-per-session flag: if we already
 *  reloaded within the last few seconds the chunk is genuinely broken (a reload
 *  won't help) so surface the error; otherwise reload to pick up the fresh index
 *  + hashed chunks. The old once-per-session flag was never cleared, so a SECOND
 *  redeploy in the same session (e.g. during active dev) left every later stale
 *  chunk erroring instead of recovering. */
function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  const load = (): Promise<{ default: T }> =>
    factory().catch((err: unknown) => {
      const KEY = "ariadne.chunkReloadAt";
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      if (Date.now() - last < 10_000) throw err; // just reloaded → genuinely broken
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    });
  return lazy(load);
}

const ChatView = lazyWithReload(() =>
  import("./features/chat/ChatView").then((m) => ({ default: m.ChatView }))
);
const WorkspaceList = lazyWithReload(() =>
  import("./features/workspace/WorkspaceList").then((m) => ({
    default: m.WorkspaceList,
  }))
);
const WorkspaceOverview = lazyWithReload(() =>
  import("./features/workspace/WorkspaceOverview").then((m) => ({
    default: m.WorkspaceOverview,
  }))
);
const HistoryView = lazyWithReload(() =>
  import("./features/workspace/HistoryView").then((m) => ({
    default: m.HistoryView,
  }))
);
const WorkspaceSearchView = lazyWithReload(() =>
  import("./features/workspace/WorkspaceSearchView").then((m) => ({
    default: m.WorkspaceSearchView,
  }))
);
const WorkspaceFileEditor = lazyWithReload(() =>
  import("./features/workspace/WorkspaceFileEditor").then((m) => ({
    default: m.WorkspaceFileEditor,
  }))
);
const ScriptsView = lazyWithReload(() =>
  import("./features/workspace/ScriptsView").then((m) => ({
    default: m.ScriptsView,
  }))
);
const ImmersiveSurfaceHome = lazyWithReload(() =>
  import("./features/workspace/ImmersiveSurfaceHome").then((m) => ({
    default: m.ImmersiveSurfaceHome,
  }))
);
const SurfaceEditor = lazyWithReload(() =>
  import("./features/surface/SurfaceEditor").then((m) => ({
    default: m.SurfaceEditor,
  }))
);
const TemplateRunView = lazyWithReload(() =>
  import("./features/runs/TemplateRunView").then((m) => ({
    default: m.TemplateRunView,
  }))
);
const ContextPickView = lazyWithReload(() =>
  import("./features/runs/ContextPickView").then((m) => ({
    default: m.ContextPickView,
  }))
);
const RunDetailView = lazyWithReload(() =>
  import("./features/runs/RunDetailView").then((m) => ({
    default: m.RunDetailView,
  }))
);
const StagedDiffView = lazyWithReload(() =>
  import("./features/runs/StagedDiffView").then((m) => ({
    default: m.StagedDiffView,
  }))
);
const AttemptDiffView = lazyWithReload(() =>
  import("./features/runs/AttemptDiffView").then((m) => ({
    default: m.AttemptDiffView,
  }))
);
const AttemptsListView = lazyWithReload(() =>
  import("./features/runs/AttemptsListView").then((m) => ({
    default: m.AttemptsListView,
  }))
);
const SettingsView = lazyWithReload(() =>
  import("./features/settings/SettingsView").then((m) => ({
    default: m.SettingsView,
  }))
);
const SearchView = lazyWithReload(() =>
  import("./features/search/SearchView").then((m) => ({
    default: m.SearchView,
  }))
);
const ReportsQueueView = lazyWithReload(() =>
  import("./features/reports/ReportsQueueView").then((m) => ({
    default: m.ReportsQueueView,
  }))
);
const TutorialPage = lazyWithReload(() =>
  import("./features/tutorial/TutorialPage").then((m) => ({
    default: m.TutorialPage,
  }))
);
const CompareView = lazyWithReload(() =>
  import("./features/compare/CompareView").then((m) => ({
    default: m.CompareView,
  }))
);

/** Centered spinner — used as the Suspense fallback while a route chunk loads. */
function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in">
      <Spinner size="md" label="Loading" />
    </div>
  );
}

/** Route wrapper that injects workspaceId from the URL. */
function SurfaceEditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <SurfaceEditor workspaceId={id ?? ""} />;
}

function AppContent() {
  // Section-keyed entrance: re-mount + fade the route area when the top-level
  // section changes (chat ↔ workspaces ↔ settings …), but NOT on within-section
  // navigation (chat → chat keeps the composer draft + scroll).
  const location = useLocation();
  const routeSection = location.pathname.split("/")[1] || "home";
  return (
    <>
      <AppShell>
        {/* BD2 — route-level error boundary. A render crash in any lazy
            route (ChatView, WorkspaceOverview, etc.) is contained here:
            the AppShell chrome (sidebar, header) survives and the user
            gets a Retry card instead of a blank screen — the
            "never blank-screen" invariant. The app
            root has its own outer boundary; this inner one keeps the
            shell alive so navigation still works after a route crash. */}
        <Suspense fallback={<RouteFallback />}>
          <ErrorBoundary label="이 화면을 여는 중 문제가 발생했어요">
          <div key={routeSection} className="flex-1 min-h-0 flex flex-col animate-fade-in">
          <Routes>
            {/* Chat-first home */}
            <Route path="/" element={<ChatView />} />
            <Route path="/chat/:id" element={<ChatView />} />

            {/* Workspaces */}
            <Route path="/workspaces" element={<WorkspaceList />} />
            <Route path="/workspaces/:id" element={<WorkspaceOverview />} />
            <Route path="/workspaces/:id/scripts" element={<ScriptsView />} />
            {/* Routes contributed by example projects (e.g. lecture's view). */}
            {PROJECT_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="/workspaces/:id/screen" element={<ImmersiveSurfaceHome />} />
            <Route path="/workspaces/:id/surface/edit" element={<SurfaceEditorRoute />} />
            <Route path="/workspaces/:id/history" element={<HistoryView />} />
            <Route path="/workspaces/:id/search" element={<WorkspaceSearchView />} />
            <Route path="/workspaces/:id/edit" element={<WorkspaceFileEditor />} />

            {/* Templates & Runs */}
            <Route path="/templates/:id" element={<TemplateRunView />} />
            <Route path="/runs/:id/context" element={<ContextPickView />} />
            <Route path="/runs/:id/diff" element={<StagedDiffView />} />
            <Route path="/runs/:id" element={<RunDetailView />} />
            <Route path="/attempts/:id/diff" element={<AttemptDiffView />} />
            <Route path="/chat/:chatId/attempts" element={<AttemptsListView />} />

            {/* Utility */}
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/search" element={<SearchView />} />
            <Route path="/compare" element={<CompareView />} />
            <Route path="/reports" element={<ReportsQueueView />} />
            <Route path="/tutorial" element={<TutorialPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </div>
          </ErrorBoundary>
        </Suspense>
      </AppShell>
      <CreateWorkspaceDialog />
      <ReportDialog />
      <TutorialOverlay />
      <GlobalCommands />
      <WorkspaceCommands />
      <ShortcutsHelp />
      <GlobalSettings />
      <Keybindings />
    </>
  );
}

function AuthGate() {
  const { data, isLoading, error } = useMe();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background animate-fade-in">
        <PageSpinner />
      </div>
    );
  }

  // 401 or network error → show login (outside I18nProvider; fallback to localStorage/en)
  if (error || !data) {
    return (
      <I18nProvider>
        <LoginView />
        <ToastList />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider initialLocale={data.account.locale}>
      {/* ConfirmProvider supplies the in-app confirm()/promptText() dialogs
          (replacing window.confirm/prompt). Inside I18nProvider so its default
          button labels can call useT(). */}
      <ConfirmProvider>
        <AppContent />
      </ConfirmProvider>
      {/* ToastList must render INSIDE I18nProvider — its close-button
          aria-label calls useT(). ToastProvider lives above us in main.tsx
          but the list UI is mounted here. */}
      <ToastList />
    </I18nProvider>
  );
}

export default function App() {
  // AV polish: wrap the whole tree in an ErrorBoundary so a render crash
  // anywhere shows a friendly retry card instead of the blank-black-screen
  // experience that AT-fix-3 inflicted on the user.
  return (
    <ErrorBoundary label="앱에 문제가 발생했음">
      <AuthGate />
    </ErrorBoundary>
  );
}
