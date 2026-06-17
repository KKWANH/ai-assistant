/**
 * Zustand UI store — client-only transient state.
 * Server state lives in TanStack Query.
 */
import { create } from "zustand";
import { applyTheme } from "./theme";

// Per-workspace "Advanced view" memory — persisted to localStorage so a
// workspace reopens in the view you left it in (a coding workspace stays
// IDE-dense, a notes workspace stays clean), independent of the session.
const WS_ADVANCED_KEY = "ariadne.workspaceAdvanced.v1";
function loadWorkspaceAdvanced(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(WS_ADVANCED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function saveWorkspaceAdvanced(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(WS_ADVANCED_KEY, JSON.stringify(map));
  } catch {
    /* localStorage unavailable / over quota — fall back to in-memory only */
  }
}

// Per-workspace floating-chat open behavior — "recent" continues the
// workspace's latest chat (the default), "new" always starts a fresh one.
// A personal UI preference set in Workspace Settings, so it's client-side
// (localStorage) rather than a workspace field, keyed by workspace id.
export type FloatingChatMode = "recent" | "new";
const FLOATING_CHAT_KEY = "ariadne.floatingChatMode.v1";
function loadFloatingChatMode(): Record<string, FloatingChatMode> {
  try {
    const raw = localStorage.getItem(FLOATING_CHAT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, FloatingChatMode>) : {};
  } catch {
    return {};
  }
}
function saveFloatingChatMode(map: Record<string, FloatingChatMode>): void {
  try {
    localStorage.setItem(FLOATING_CHAT_KEY, JSON.stringify(map));
  } catch {
    /* localStorage unavailable / over quota — fall back to in-memory only */
  }
}

export type SidebarSection =
  | "chat"
  | "workspaces"
  | "templates"
  | "runs"
  | "artifacts"
  | "settings"
  | "search"
  | "reports";

export interface UIStore {
  // Sidebar
  sidebarSection: SidebarSection;
  setSidebarSection: (s: SidebarSection) => void;

  // Active workspace / run
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;

  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;

  // Inspector panel
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;

  // Workspace overview: show power tabs/actions. `workspaceAdvanced` is the
  // global default (toggled in Settings); `workspaceAdvancedById` holds
  // per-workspace overrides, persisted so a workspace stays in the view you
  // left it in — the "Standard = IDE / Simple = clean, per workspace" lever.
  workspaceAdvanced: boolean;
  setWorkspaceAdvanced: (on: boolean) => void;
  workspaceAdvancedById: Record<string, boolean>;
  setWorkspaceAdvancedFor: (id: string, on: boolean) => void;

  // Per-workspace floating-chat open behavior (see loadFloatingChatMode).
  floatingChatModeById: Record<string, FloatingChatMode>;
  setFloatingChatModeFor: (id: string, mode: FloatingChatMode) => void;

  // Command menu
  commandMenuOpen: boolean;
  setCommandMenuOpen: (open: boolean) => void;
  toggleCommandMenu: () => void;

  // Selected claim in Evidence view
  selectedClaimId: string | null;
  setSelectedClaimId: (id: string | null) => void;

  // Transient include/exclude toggles (context pick)
  contextExcludes: Set<string>;
  contextIncludes: Set<string>;
  toggleContextExclude: (path: string) => void;
  toggleContextInclude: (path: string) => void;
  resetContextToggles: () => void;

  // Theme
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  toggleTheme: () => void;

  // Create workspace dialog
  createWorkspaceOpen: boolean;
  setCreateWorkspaceOpen: (open: boolean) => void;

  // Report-a-problem dialog
  reportDialogOpen: boolean;
  setReportDialogOpen: (open: boolean) => void;

  // Tutorial / guided tour
  tutorialOpen: boolean;
  setTutorialOpen: (open: boolean) => void;

  /** Composer pulse — monotonically increments to ask the composer to
   *  perform a one-shot UI action (open file picker, toggle web mode).
   *  Used by the empty-state chips to drive the composer that lives in
   *  a sibling route component. The composer reads the pulse on an
   *  effect and triggers the action, then resets nothing — the next
   *  pulse just increments the counter.
   *
   *  This pattern beats a flat boolean because two clicks in a row
   *  should fire twice; useEffect dep on a counter handles that
   *  cleanly. */
  composerPulse:
    | { kind: "open_file_picker" | "toggle_web_search"; n: number }
    | { kind: "set_text"; text: string; n: number }
    | null;
  pulseComposer: (kind: "open_file_picker" | "toggle_web_search") => void;
  /** Prefill the composer with text (e.g. a project's chat starter) — the user
   *  reviews + sends, so it uses the composer's own modes. */
  prefillComposer: (text: string) => void;

  // Chat: composer workspace selector
  chatComposerWorkspaceId: string | null;
  setChatComposerWorkspaceId: (id: string | null) => void;

  /** Unsent composer text keyed by chat id (or "new") — kept here, not in the
   *  composer's local state, so navigating away (e.g. to the fullscreen screen)
   *  and back doesn't clear what you were typing. Cleared on send. */
  composerDrafts: Record<string, string>;
  setComposerDraft: (key: string, text: string) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarSection: "workspaces",
  setSidebarSection: (s) => set({ sidebarSection: s }),

  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

  activeRunId: null,
  setActiveRunId: (id) => set({ activeRunId: id }),

  workspaceAdvanced: false,
  setWorkspaceAdvanced: (on) => set({ workspaceAdvanced: on }),
  workspaceAdvancedById: loadWorkspaceAdvanced(),
  setWorkspaceAdvancedFor: (id, on) =>
    set((s) => {
      const next = { ...s.workspaceAdvancedById, [id]: on };
      saveWorkspaceAdvanced(next);
      return { workspaceAdvancedById: next };
    }),

  floatingChatModeById: loadFloatingChatMode(),
  setFloatingChatModeFor: (id, mode) =>
    set((s) => {
      const next = { ...s.floatingChatModeById, [id]: mode };
      saveFloatingChatMode(next);
      return { floatingChatModeById: next };
    }),

  inspectorOpen: true,
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),

  commandMenuOpen: false,
  setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),
  toggleCommandMenu: () => set((s) => ({ commandMenuOpen: !s.commandMenuOpen })),

  selectedClaimId: null,
  setSelectedClaimId: (id) => set({ selectedClaimId: id }),

  contextExcludes: new Set(),
  contextIncludes: new Set(),
  toggleContextExclude: (path) =>
    set((s) => {
      const next = new Set(s.contextExcludes);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { contextExcludes: next };
    }),
  toggleContextInclude: (path) =>
    set((s) => {
      const next = new Set(s.contextIncludes);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { contextIncludes: next };
    }),
  resetContextToggles: () =>
    set({ contextExcludes: new Set(), contextIncludes: new Set() }),

  theme: "dark",
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },

  createWorkspaceOpen: false,
  setCreateWorkspaceOpen: (open) => set({ createWorkspaceOpen: open }),

  reportDialogOpen: false,
  setReportDialogOpen: (open) => set({ reportDialogOpen: open }),

  tutorialOpen: false,
  setTutorialOpen: (open) => set({ tutorialOpen: open }),

  composerPulse: null,
  pulseComposer: (kind) =>
    set((state) => ({
      composerPulse: { kind, n: (state.composerPulse?.n ?? 0) + 1 },
    })),
  prefillComposer: (text) =>
    set((state) => ({
      composerPulse: { kind: "set_text", text, n: (state.composerPulse?.n ?? 0) + 1 },
    })),

  chatComposerWorkspaceId: null,
  setChatComposerWorkspaceId: (id) => set({ chatComposerWorkspaceId: id }),

  composerDrafts: {},
  setComposerDraft: (key, text) =>
    set((s) => {
      if ((s.composerDrafts[key] ?? "") === text) return s; // no-op, avoid churn
      const next = { ...s.composerDrafts };
      if (text) next[key] = text;
      else delete next[key];
      return { composerDrafts: next };
    }),
}));
