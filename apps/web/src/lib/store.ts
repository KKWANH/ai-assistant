/**
 * Zustand UI store — client-only transient state.
 * Server state lives in TanStack Query.
 */
import { create } from "zustand";
import { applyTheme } from "./theme";

export type SidebarSection =
  | "chat"
  | "workspaces"
  | "templates"
  | "runs"
  | "artifacts"
  | "settings"
  | "search";

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

  // Tutorial / guided tour
  tutorialOpen: boolean;
  setTutorialOpen: (open: boolean) => void;

  // Chat: composer workspace selector
  chatComposerWorkspaceId: string | null;
  setChatComposerWorkspaceId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarSection: "workspaces",
  setSidebarSection: (s) => set({ sidebarSection: s }),

  activeWorkspaceId: null,
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

  activeRunId: null,
  setActiveRunId: (id) => set({ activeRunId: id }),

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

  tutorialOpen: false,
  setTutorialOpen: (open) => set({ tutorialOpen: open }),

  chatComposerWorkspaceId: null,
  setChatComposerWorkspaceId: (id) => set({ chatComposerWorkspaceId: id }),
}));
