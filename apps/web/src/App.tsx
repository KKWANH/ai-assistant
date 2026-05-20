import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { CreateWorkspaceDialog } from "./features/workspace/CreateWorkspaceDialog";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { LoginView } from "./features/auth/LoginView";
import { useMe } from "./lib/queries";
import { I18nProvider } from "./lib/i18n";

// Route screens are code-split: each becomes its own chunk, loaded on demand.
const ChatView = lazy(() =>
  import("./features/chat/ChatView").then((m) => ({ default: m.ChatView }))
);
const WorkspaceList = lazy(() =>
  import("./features/workspace/WorkspaceList").then((m) => ({
    default: m.WorkspaceList,
  }))
);
const WorkspaceOverview = lazy(() =>
  import("./features/workspace/WorkspaceOverview").then((m) => ({
    default: m.WorkspaceOverview,
  }))
);
const ScriptsView = lazy(() =>
  import("./features/workspace/ScriptsView").then((m) => ({
    default: m.ScriptsView,
  }))
);
const SurfaceEditor = lazy(() =>
  import("./features/surface/SurfaceEditor").then((m) => ({
    default: m.SurfaceEditor,
  }))
);
const TemplateRunView = lazy(() =>
  import("./features/runs/TemplateRunView").then((m) => ({
    default: m.TemplateRunView,
  }))
);
const ContextPickView = lazy(() =>
  import("./features/runs/ContextPickView").then((m) => ({
    default: m.ContextPickView,
  }))
);
const RunDetailView = lazy(() =>
  import("./features/runs/RunDetailView").then((m) => ({
    default: m.RunDetailView,
  }))
);
const SettingsView = lazy(() =>
  import("./features/settings/SettingsView").then((m) => ({
    default: m.SettingsView,
  }))
);
const SearchView = lazy(() =>
  import("./features/search/SearchView").then((m) => ({
    default: m.SearchView,
  }))
);

/** Centered spinner — used as the Suspense fallback while a route chunk loads. */
function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

/** Route wrapper that injects workspaceId from the URL. */
function SurfaceEditorRoute() {
  const { id } = useParams<{ id: string }>();
  return <SurfaceEditor workspaceId={id ?? ""} />;
}

function AppContent() {
  return (
    <>
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Chat-first home */}
            <Route path="/" element={<ChatView />} />
            <Route path="/chat/:id" element={<ChatView />} />

            {/* Workspaces */}
            <Route path="/workspaces" element={<WorkspaceList />} />
            <Route path="/workspaces/:id" element={<WorkspaceOverview />} />
            <Route path="/workspaces/:id/scripts" element={<ScriptsView />} />
            <Route path="/workspaces/:id/surface/edit" element={<SurfaceEditorRoute />} />

            {/* Templates & Runs */}
            <Route path="/templates/:id" element={<TemplateRunView />} />
            <Route path="/runs/:id/context" element={<ContextPickView />} />
            <Route path="/runs/:id" element={<RunDetailView />} />

            {/* Utility */}
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/search" element={<SearchView />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
      <CreateWorkspaceDialog />
      <TutorialOverlay />
    </>
  );
}

function AuthGate() {
  const { data, isLoading, error } = useMe();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // 401 or network error → show login (outside I18nProvider; fallback to localStorage/en)
  if (error || !data) {
    return (
      <I18nProvider>
        <LoginView />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider initialLocale={data.account.locale}>
      <AppContent />
    </I18nProvider>
  );
}

export default function App() {
  return <AuthGate />;
}
