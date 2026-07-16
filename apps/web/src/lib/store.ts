/**
 * Zustand UI store — client-only transient state.
 * Server state lives in TanStack Query.
 */
import { create } from "zustand";
import { applyTheme } from "./theme";
import { applyWallpaper, DEFAULT_WALLPAPER } from "./wallpaper";

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

// Desktop-style resizable sidebar — drag the divider to set the width, kept in
// localStorage so it survives reloads (and is shared with a browser tab on the
// same loopback origin in the desktop app).
const SIDEBAR_WIDTH_KEY = "ariadne.sidebarWidth.v1";
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 440;
const SIDEBAR_WIDTH_DEFAULT = 208;
export function clampSidebarWidth(n: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(n)));
}
function loadSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

// How the sidebar chat list is ordered. "recent" = newest activity first
// (default); "name" = alphabetical. Chats are no longer manually reorderable,
// so this is the single ordering knob. Persisted across reloads.
export type ChatSort = "recent" | "name";
const CHAT_SORT_KEY = "ariadne.chatSort.v1";
function loadChatSort(): ChatSort {
  try {
    return localStorage.getItem(CHAT_SORT_KEY) === "name" ? "name" : "recent";
  } catch {
    return "recent";
  }
}

// Appearance — theme (dark/light) + wallpaper preset, both persisted so a
// reload keeps the user's choice (theme previously always reset to dark).
// Exported so main.tsx can apply them before first paint.
const THEME_KEY = "ariadne.theme.v1";
export function loadTheme(): "dark" | "light" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
const WALLPAPER_KEY = "ariadne.wallpaper.v1";
export function loadWallpaper(): string {
  try {
    return localStorage.getItem(WALLPAPER_KEY) || DEFAULT_WALLPAPER;
  } catch {
    return DEFAULT_WALLPAPER;
  }
}
// Chat message text size (px). Message bodies read it via the --chat-font CSS
// var so every chat surface scales together; adjustable in Settings → 화면.
const CHAT_FONT_KEY = "ariadne.chatFont.v1";
export const DEFAULT_CHAT_FONT = 16;
export function loadChatFontSize(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_FONT_KEY));
    return n >= 14 && n <= 20 ? n : DEFAULT_CHAT_FONT;
  } catch {
    return DEFAULT_CHAT_FONT;
  }
}
export function applyChatFontSize(px: number): void {
  document.documentElement.style.setProperty("--chat-font", `${px.toString()}px`);
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

  // Activity panel — live background tasks (runs), toggled from the top bar.
  activityOpen: boolean;
  toggleActivity: () => void;

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

  // Resizable sidebar width (px), persisted. See loadSidebarWidth.
  sidebarWidth: number;
  setSidebarWidth: (px: number) => void;

  // Chat list ordering (persisted). See loadChatSort.
  chatSort: ChatSort;
  setChatSort: (sort: ChatSort) => void;

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
  wallpaper: string;
  setWallpaper: (key: string) => void;

  // Chat message text size (px) — persisted; applied as the --chat-font var.
  chatFontSize: number;
  setChatFontSize: (px: number) => void;

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

  sidebarWidth: loadSidebarWidth(),
  setSidebarWidth: (px) => {
    const w = clampSidebarWidth(px);
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w)); } catch { /* ignore */ }
    set({ sidebarWidth: w });
  },

  chatSort: loadChatSort(),
  setChatSort: (sort) => {
    try { localStorage.setItem(CHAT_SORT_KEY, sort); } catch { /* ignore */ }
    set({ chatSort: sort });
  },

  inspectorOpen: true,
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),

  activityOpen: false,
  toggleActivity: () => set((s) => ({ activityOpen: !s.activityOpen })),

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

  theme: loadTheme(),
  setTheme: (t) => {
    applyTheme(t);
    applyWallpaper(get().wallpaper, t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    set({ theme: t });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
  wallpaper: loadWallpaper(),
  setWallpaper: (key) => {
    applyWallpaper(key, get().theme);
    try { localStorage.setItem(WALLPAPER_KEY, key); } catch { /* ignore */ }
    set({ wallpaper: key });
  },

  chatFontSize: loadChatFontSize(),
  setChatFontSize: (px) => {
    applyChatFontSize(px);
    try { localStorage.setItem(CHAT_FONT_KEY, String(px)); } catch { /* ignore */ }
    set({ chatFontSize: px });
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
