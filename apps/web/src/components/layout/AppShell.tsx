/**
 * AppShell — chat-first, responsive redesign.
 *
 * Sidebar IA:
 *   [+ New chat]          ← prominent, top
 *   Chats (threads)       ← newest first, delete-on-hover
 *   ──────────────
 *   Workspaces            ← list + new
 *   Runs (recent)         ← standard mode only
 *   ──────────────
 *   Settings · User · Logout  ← pinned bottom
 *
 * Simple mode: hides Templates/Runs/Scripts/surface-edit/Command-menu
 * power features, keeping chat, workspaces, search, settings, logout.
 *
 * Top bar: brand (→ home) + breadcrumb · search · ⌘K · theme · help ·
 * user · inspector toggle.
 *
 * Responsive: below `md` the sidebar collapses to an off-canvas drawer
 * driven by a hamburger toggle; the Inspector is shown only at `lg`+.
 * Right Inspector: contextual — only on workspace/template/run detail screens.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, matchPath, Link } from "react-router-dom";
import { NotificationsBell } from "../../features/alerts/NotificationsBell";
import {
  FolderOpen,
  GraduationCap,
  Play,
  Settings,
  PanelRight,
  Sun,
  Moon,
  Plus,
  ChevronRight,
  HelpCircle,
  Compass,
  BookOpen,
  Flag,
  LogOut,
  Search,
  Terminal,
  MessageSquare,
  MessageSquarePlus,
  Columns2,
  Trash2,
  MoreHorizontal,
  Pencil,
  Globe,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useUIStore } from "../../lib/store";
import {
  useWorkspaces,
  useRuns,
  useMe,
  useLogout,
  useChats,
  useDeleteChat,
  useDeleteEmptyChats,
  useUpdateChat,
  useDeleteWorkspace,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { SidebarItem } from "../ui/SidebarItem";
import { IconButton } from "../ui/IconButton";
import { Badge } from "../ui/Badge";
import { CommandMenu } from "../ui/CommandMenu";
import type { CommandItem } from "../ui/CommandMenu";
import { useToast } from "../ui/Toast";
import { Inspector } from "./Inspector";
import { isBuiltinWorkspace } from "@ariadne/shared";
import type { AccountMode, Chat, Workspace } from "@ariadne/shared";

export interface AppShellProps {
  children: ReactNode;
}

/** Monochrome Ariadne mark — her thread wound into a spiral: the clew that
 *  traces the one path through the labyrinth. Inherits the current text color. */
function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 16 A11.5 11.5 0 0 1 26.5 16 A9.5 9.5 0 0 1 7.5 16 A7.5 7.5 0 0 1 22.5 16 A5.5 5.5 0 0 1 11.5 16 A2.25 2.25 0 0 1 16 16" />
      <circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A sidebar chat row — opens the chat; a ⋯ menu renames, moves, or deletes it. */
// AT — paginated chat list. Avoids rendering 500 DOM nodes for users with
// very long histories. First 50 render eagerly; "Show N more" button
// reveals the rest in 50-chat chunks.
function ChatListBody({
  chats,
  activeChatId,
  workspaces,
  closeMobileNav,
}: {
  chats: Chat[];
  activeChatId: string | null;
  workspaces: Workspace[] | undefined;
  closeMobileNav: () => void;
}) {
  const { t } = useT();
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  const visible = chats.slice(0, shown);
  const remaining = chats.length - visible.length;
  return (
    <>
      {visible.map((chat) => (
        <ChatRow
          key={chat.id}
          chat={chat}
          active={activeChatId === chat.id}
          workspaces={workspaces}
          closeMobileNav={closeMobileNav}
        />
      ))}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShown((s) => s + PAGE)}
          className="w-full mt-1 px-2 py-1.5 text-2xs text-muted-foreground hover:text-foreground hover:bg-surface-3 rounded transition-colors"
        >
          {t("nav.chatsMore", { n: remaining })} ↓
        </button>
      )}
    </>
  );
}

function ChatRow({
  chat,
  active,
  workspaces,
  closeMobileNav,
}: {
  chat: Chat;
  active: boolean;
  workspaces: Workspace[] | undefined;
  closeMobileNav: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useT();
  const { setSidebarSection } = useUIStore();
  const deleteChat = useDeleteChat();
  const updateChat = useUpdateChat();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  const commitRename = () => {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== chat.title) {
      void updateChat.mutateAsync({ id: chat.id, input: { title } });
    } else {
      setDraft(chat.title);
    }
  };

  if (renaming) {
    return (
      <div className="px-1 py-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            // Enter blurs → onBlur commits once (avoids a double commit).
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setDraft(chat.title);
              setRenaming(false);
            }
          }}
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("nav.renameChat")}
        />
      </div>
    );
  }

  return (
    <div className="relative group">
      <SidebarItem
        label={chat.title || t("commandMenu.untitledChat")}
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        active={active}
        to={`/chat/${chat.id}`}
        onClick={() => {
          setSidebarSection("chat");
          closeMobileNav();
        }}
      />
      <button
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-opacity opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label={t("nav.chatOptions")}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute left-1 top-9 z-30 w-48 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1 text-xs">
            <button
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-foreground hover:bg-surface-3 transition-colors"
              onClick={() => {
                setMenuOpen(false);
                setDraft(chat.title);
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              {t("nav.renameChat")}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-destructive hover:bg-surface-3 transition-colors"
              onClick={() => {
                setMenuOpen(false);
                void deleteChat.mutateAsync(chat.id).then(() => {
                  if (active) navigate("/");
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              {t("nav.deleteChat")}
            </button>
            <div className="border-t border-border mt-1 pt-1">
              <p className="px-3 py-1 text-2xs uppercase tracking-wider text-muted-foreground">
                {t("nav.moveToWorkspace")}
              </p>
              <button
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-3 transition-colors"
                onClick={() => {
                  setMenuOpen(false);
                  if (chat.workspaceId != null) {
                    void updateChat.mutateAsync({ id: chat.id, input: { workspaceId: null } });
                  }
                }}
              >
                <span className={chat.workspaceId == null ? "text-accent" : "text-foreground"}>
                  {t("chat.composer.noneGeneral")}
                </span>
              </button>
              {(workspaces ?? []).map((ws) => (
                <button
                  key={ws.id}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface-3 transition-colors"
                  onClick={() => {
                    setMenuOpen(false);
                    if (chat.workspaceId !== ws.id) {
                      void updateChat.mutateAsync({ id: chat.id, input: { workspaceId: ws.id } });
                    }
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className={[
                      "truncate",
                      chat.workspaceId === ws.id ? "text-accent" : "text-foreground",
                    ].join(" ")}
                  >
                    {ws.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const {
    activeWorkspaceId,
    setActiveWorkspaceId,
    setActiveRunId,
    inspectorOpen,
    toggleInspector,
    sidebarSection,
    setSidebarSection,
    theme,
    toggleTheme,
    setCreateWorkspaceOpen,
    setReportDialogOpen,
    setCommandMenuOpen,
    setTutorialOpen,
  } = useUIStore();

  const { data: workspaces } = useWorkspaces();
  const { data: allRuns } = useRuns();
  const { data: chats } = useChats();
  const { data: me } = useMe();
  const logout = useLogout();
  const deleteWorkspace = useDeleteWorkspace();
  const deleteEmptyChats = useDeleteEmptyChats();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();

  // AU — Auto-cleanup empty chats older than 24h on app mount. Silent
  // (no toast), single fire per page load. Today's empties stay in case
  // the user comes back to type; only stale leftovers from yesterday+
  // get pruned.
  useEffect(() => {
    deleteEmptyChats.mutate(24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop sidebar collapse — a focus/reading mode that hides the left nav
  // (mobile already has the off-canvas drawer). Toggled from the top bar.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  const accountMode: AccountMode = me?.account.mode ?? "standard";
  const isSimple = accountMode === "simple";

  // Cmd+K command palette — available in BOTH modes (search chats / workspaces /
  // runs + quick actions). Easy mode previously disabled it entirely.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setCommandMenuOpen]);

  // Close the mobile drawer on any route change.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const activeChatId: string | null = location.pathname.startsWith("/chat/")
    ? (location.pathname.split("/chat/")[1] ?? null)
    : null;

  // Split chats: global (no workspace) vs grouped by workspace.
  // The top list now only shows global conversations, keeping the sidebar's
  // mental model clean — workspace chats live under their workspace.
  const { globalChats, chatsByWorkspace } = useMemo(() => {
    const global: Chat[] = [];
    const byWs = new Map<string, Chat[]>();
    for (const chat of chats ?? []) {
      if (chat.workspaceId == null) {
        global.push(chat);
      } else {
        const list = byWs.get(chat.workspaceId) ?? [];
        list.push(chat);
        byWs.set(chat.workspaceId, list);
      }
    }
    return { globalChats: global, chatsByWorkspace: byWs };
  }, [chats]);

  // Show a workspace's nested chats when the user is anywhere inside that
  // workspace (overview, scripts, or one of its chats).
  const activeChat = activeChatId
    ? (chats ?? []).find((c) => c.id === activeChatId)
    : null;
  const expandedWorkspaceId =
    location.pathname.startsWith("/workspaces/") && activeWorkspaceId
      ? activeWorkspaceId
      : activeChat?.workspaceId ?? null;

  const commandItems: CommandItem[] = [
    {
      id: "new-chat",
      label: t("commandMenu.newChat"),
      description: t("commandMenu.newChatDesc"),
      icon: <MessageSquarePlus className="h-4 w-4" />,
      section: t("commandMenu.sectionChat"),
      onSelect: () => navigate("/"),
    },
    {
      id: "new-workspace",
      label: t("commandMenu.newWorkspace"),
      description: t("commandMenu.newWorkspaceDesc"),
      icon: <Plus className="h-4 w-4" />,
      section: t("commandMenu.sectionWorkspace"),
      onSelect: () => setCreateWorkspaceOpen(true),
    },
    {
      id: "settings",
      label: t("commandMenu.settings"),
      description: t("commandMenu.settingsDesc"),
      icon: <Settings className="h-4 w-4" />,
      section: t("commandMenu.sectionApp"),
      onSelect: () => navigate("/settings"),
    },
    {
      id: "tutorial",
      label: t("commandMenu.tutorial"),
      description: t("commandMenu.tutorialDesc"),
      icon: <BookOpen className="h-4 w-4" />,
      section: t("commandMenu.sectionApp"),
      onSelect: () => navigate("/tutorial"),
    },
    {
      id: "compare",
      label: t("commandMenu.compare"),
      description: t("commandMenu.compareDesc"),
      icon: <Columns2 className="h-4 w-4" />,
      section: t("commandMenu.sectionApp"),
      onSelect: () => navigate("/compare"),
    },
    {
      id: "search-content",
      label: t("commandMenu.searchContent"),
      description: t("commandMenu.searchContentDesc"),
      icon: <Search className="h-4 w-4" />,
      section: t("commandMenu.sectionApp"),
      onSelect: () => {
        setSidebarSection("search");
        navigate("/search");
      },
    },
    ...(workspaces?.map((ws) => ({
      id: `ws-${ws.id}`,
      label: ws.name,
      description: ws.rootPath,
      icon: <FolderOpen className="h-4 w-4" />,
      section: t("commandMenu.sectionWorkspaces"),
      onSelect: () => {
        setActiveWorkspaceId(ws.id);
        navigate(`/workspaces/${ws.id}`);
      },
    })) ?? []),
    ...(allRuns?.slice(0, 5).map((run) => ({
      id: `run-${run.id}`,
      label: t("commandMenu.runLabel", { id: run.id.slice(0, 8) }),
      description: run.templateName,
      icon: <Play className="h-4 w-4" />,
      section: t("commandMenu.sectionRecentRuns"),
      onSelect: () => {
        setActiveRunId(run.id);
        navigate(`/runs/${run.id}`);
      },
    })) ?? []),
    ...(chats?.slice(0, 5).map((chat) => ({
      id: `chat-${chat.id}`,
      label: chat.title || t("commandMenu.untitledChat"),
      description: new Date(chat.updatedAt).toLocaleString(),
      icon: <MessageSquare className="h-4 w-4" />,
      section: t("commandMenu.sectionChats"),
      onSelect: () => navigate(`/chat/${chat.id}`),
    })) ?? []),
  ];

  // Determine if we're on a chat route — used for the breadcrumb.
  const onChatRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");

  // The Inspector is contextual: only workspace / template / run detail
  // screens have metadata to show. The toggle appears only there, so it
  // never looks broken on a screen where it would do nothing.
  const inspectorRoute =
    !!matchPath("/workspaces/:id", location.pathname) ||
    !!matchPath("/templates/:id", location.pathname) ||
    !!matchPath("/runs/:id", location.pathname) ||
    !!matchPath("/runs/:id/context", location.pathname);
  const inspectorAvailable = inspectorRoute && !isSimple;
  const showInspector = inspectorOpen && inspectorAvailable;

  // Side-effects for the home links — the <Link to="/"> handles navigation
  // itself, which lets middle-click / cmd-click open a new tab natively.
  const goHome = () => {
    setSidebarSection("chat");
    setMobileNavOpen(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <header className="h-10 shrink-0 flex items-center justify-between gap-2 px-2 sm:px-3 border-b border-topbar-border bg-topbar">
        <div className="flex items-center gap-1 min-w-0">
          {/* Mobile drawer toggle */}
          <span className="flex md:hidden">
            <IconButton
              label={t("nav.openMenu")}
              size="sm"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </IconButton>
          </span>
          {/* Desktop sidebar collapse toggle */}
          <span className="hidden md:flex">
            <IconButton
              label={sidebarCollapsed ? t("nav.showSidebar") : t("nav.hideSidebar")}
              size="sm"
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </IconButton>
          </span>
          {/* Brand — links to home */}
          <Link
            to="/"
            onClick={goHome}
            title={t("nav.home")}
            className="flex items-center gap-1.5 shrink-0 rounded-md px-1.5 py-1 hover:bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo className="h-4 w-4 text-topbar-foreground" />
            <span className="text-sm font-semibold text-topbar-foreground tracking-tight">
              Ariadne
            </span>
          </Link>
          {activeWorkspaceId && workspaces && !onChatRoute && (
            <span className="hidden sm:flex items-center gap-1.5 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                {workspaces.find((w) => w.id === activeWorkspaceId)?.name}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* ⌘K hint — standard mode, ≥md */}
          {!isSimple && (
            <kbd
              data-tour="command-hint"
              className="hidden md:flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground border border-border rounded-md font-mono"
            >
              ⌘K
            </kbd>
          )}
          {/* Search — opens the same ⌘K command palette (one unified search,
              mouse or keyboard). Content search lives inside it as a command. */}
          <IconButton
            label={t("nav.search")}
            description={t("nav.search.desc")}
            size="sm"
            onClick={() => setCommandMenuOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
          </IconButton>
          {/* Help — guided tour or the full tutorial page; standard mode, ≥sm */}
          {!isSimple && (
            <span className="hidden sm:flex relative">
              <IconButton
                label={t("nav.helpAndTutorial")}
                description={t("nav.helpAndTutorial.desc")}
                size="sm"
                onClick={() => setHelpMenuOpen((v) => !v)}
                data-tour="help-button"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </IconButton>
              {helpMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setHelpMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-9 z-40 w-52 rounded-lg border border-border bg-card shadow-lg py-1 text-xs">
                    <button
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-foreground hover:bg-surface-3 transition-colors"
                      onClick={() => {
                        setHelpMenuOpen(false);
                        setTutorialOpen(true);
                      }}
                    >
                      <Compass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {t("nav.guidedTour")}
                    </button>
                    <button
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-foreground hover:bg-surface-3 transition-colors"
                      onClick={() => {
                        setHelpMenuOpen(false);
                        navigate("/tutorial");
                      }}
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {t("nav.fullTutorial")}
                    </button>
                  </div>
                </>
              )}
            </span>
          )}
          {/* Report a problem — available to everyone */}
          <IconButton
            label={t("nav.report")}
            description={t("nav.report.desc")}
            size="sm"
            onClick={() => setReportDialogOpen(true)}
          >
            <Flag className="h-3.5 w-3.5" />
          </IconButton>
          {me && <NotificationsBell />}
          <IconButton
            label={t("nav.toggleTheme")}
            description={t("nav.toggleTheme.desc")}
            size="sm"
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </IconButton>
          {me && (
            <>
              <span className="hidden sm:block text-xs text-muted-foreground px-1 select-none">
                {me.account.displayName}
              </span>
              <span className="hidden sm:flex">
                <IconButton
                  label={t("nav.signOut")}
                  description={t("nav.signOut.desc")}
                  size="sm"
                  onClick={() => void logout.mutateAsync()}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </IconButton>
              </span>
            </>
          )}
          {/* Inspector toggle — only where it has an effect, ≥lg */}
          {inspectorAvailable && (
            <span className="hidden lg:flex">
              <IconButton
                label={t("nav.toggleInspector")}
                description={t("nav.toggleInspector.desc")}
                size="sm"
                onClick={toggleInspector}
                data-tour="inspector-toggle"
              >
                <PanelRight className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile drawer backdrop */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar — static column ≥md, off-canvas drawer below md */}
        <nav
          className={[
            "w-52 shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar overflow-hidden",
            "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64 max-md:shadow-2xl",
            "max-md:transition-transform max-md:duration-200 max-md:ease-out",
            mobileNavOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
            // Desktop collapse — hide the static column (mobile keeps its drawer).
            sidebarCollapsed ? "md:hidden" : "",
          ].join(" ")}
          aria-label={t("nav.ariaLabel")}
        >
          {/* Mobile drawer header */}
          <div className="md:hidden flex items-center justify-between h-10 pl-2 pr-1 border-b border-sidebar-border shrink-0">
            <Link
              to="/"
              onClick={goHome}
              className="flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-surface-3 transition-colors"
            >
              <Logo className="h-4 w-4 text-foreground" />
              <span className="text-sm font-semibold text-foreground tracking-tight">
                Ariadne
              </span>
            </Link>
            <IconButton
              label={t("nav.closeMenu")}
              size="sm"
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          {/* New Chat button — prominent top action */}
          <div className="px-2 pt-2.5 pb-2 shrink-0">
            <Link
              to="/"
              data-tour="new-chat"
              onClick={() => {
                setSidebarSection("chat");
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageSquarePlus className="h-4 w-4 shrink-0" />
              {t("nav.newChat")}
            </Link>
          </div>

          {/* AU — Workspaces section. Now positioned ABOVE chats so the
              user's workspaces are always visible (chats no longer push
              them off-screen when the list grows). shrink-0 + a soft
              max-height with internal scroll if they happen to have 30+
              workspaces. */}
          <div className="shrink-0 max-h-[45vh] overflow-y-auto px-2 pt-1 pb-1" data-tour="workspaces-section">
              <div className="flex items-center justify-between mb-1 px-1">
                <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("nav.workspaces")}
                </span>
                <IconButton
                  label={t("nav.newWorkspace")}
                  size="xs"
                  onClick={() => {
                    setMobileNavOpen(false);
                    setCreateWorkspaceOpen(true);
                  }}
                  data-tour="new-workspace"
                >
                  <Plus className="h-3 w-3" />
                </IconButton>
              </div>
              {workspaces && workspaces.length > 0 ? (
                workspaces.map((ws) => (
                  <div key={ws.id}>
                    <div
                      className="relative group"
                      onMouseEnter={() => setHoveredWorkspaceId(ws.id)}
                      onMouseLeave={() => setHoveredWorkspaceId(null)}
                    >
                      <SidebarItem
                        label={ws.name}
                        icon={
                          ws.category === "lecture" ? (
                            <GraduationCap className="h-3.5 w-3.5" />
                          ) : (
                            <FolderOpen className="h-3.5 w-3.5" />
                          )
                        }
                        active={
                          activeWorkspaceId === ws.id &&
                          location.pathname.startsWith("/workspaces/")
                        }
                        // Projects with an immersive home open straight to it
                        // (lecture view, or a custom screen set as main); the
                        // overview/tabs stay reachable from inside it.
                        to={
                          ws.category === "lecture"
                            ? `/workspaces/${ws.id}/lecture`
                            : ws.homeView === "surface"
                              ? `/workspaces/${ws.id}/screen`
                              : `/workspaces/${ws.id}`
                        }
                        onClick={() => {
                          setActiveWorkspaceId(ws.id);
                          setSidebarSection("workspaces");
                          setMobileNavOpen(false);
                        }}
                        meta={ws.visibility === "public" && hoveredWorkspaceId !== ws.id ? (
                          <span className="flex items-center gap-0.5 text-2xs text-accent font-medium">
                            <Globe className="h-2.5 w-2.5" />
                            {t("workspace.visibility.publicBadge")}
                          </span>
                        ) : undefined}
                      />
                      {hoveredWorkspaceId === ws.id && !isBuiltinWorkspace(ws.id) && (
                        <button
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteWorkspace.mutateAsync(ws.id).then(() => {
                              if (activeWorkspaceId === ws.id) navigate("/");
                            });
                          }}
                          aria-label={t("nav.deleteWorkspace")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {/* Scripts link — standard mode only */}
                    {!isSimple &&
                      activeWorkspaceId === ws.id &&
                      location.pathname.startsWith("/workspaces/") && (
                        <SidebarItem
                          label={t("nav.scripts")}
                          icon={<Terminal className="h-3 w-3" />}
                          to={`/workspaces/${ws.id}/scripts`}
                          onClick={() => setMobileNavOpen(false)}
                          className="pl-5 text-2xs"
                        />
                      )}
                    {/* Workspace chats — nested under the expanded workspace */}
                    {expandedWorkspaceId === ws.id &&
                      (chatsByWorkspace.get(ws.id)?.length ?? 0) > 0 && (
                        <div className="pl-3">
                          {chatsByWorkspace.get(ws.id)!.slice(0, 10).map((chat) => (
                            <ChatRow
                              key={chat.id}
                              chat={chat}
                              active={activeChatId === chat.id}
                              workspaces={workspaces}
                              closeMobileNav={() => setMobileNavOpen(false)}
                            />
                          ))}
                        </div>
                      )}
                  </div>
                ))
              ) : (
                <button
                  className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md"
                  onClick={() => {
                    setMobileNavOpen(false);
                    setCreateWorkspaceOpen(true);
                  }}
                >
                  {t("nav.addWorkspace")}
                </button>
              )}
            </div>

          {/* AU — Divider between Workspaces (above) and Chats (below). */}
          <div className="border-t border-sidebar-border mx-2 my-1 shrink-0" />

          {/* AU — Chats list. flex-1 + overflow-y-auto so ONLY this region
              scrolls when the chat list is long. Workspaces above stay
              pinned. Header row labels the section and shows the count. */}
          <div className="flex-1 overflow-y-auto min-h-0 px-2 pt-1 pb-1">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("nav.chats")}
              </span>
            </div>
            {globalChats && globalChats.length > 0 ? (
              <ChatListBody
                chats={globalChats}
                activeChatId={activeChatId}
                workspaces={workspaces}
                closeMobileNav={() => setMobileNavOpen(false)}
              />
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t("nav.noConversations")}
              </p>
            )}
          </div>

          {/* Recent Runs — standard mode only. Pinned below chats. */}
          {!isSimple && (
            <div className="shrink-0 border-t border-sidebar-border mx-2 my-1" />
          )}
          {!isSimple && (
            <div className="shrink-0 px-2 pt-1 pb-1">
              <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider px-1 block mb-1">
                {t("nav.recentRuns")}
              </span>
              {allRuns && allRuns.length > 0 ? (
                allRuns.slice(0, 6).map((run) => (
                  <Link
                    key={run.id}
                    to={`/runs/${run.id}`}
                    className="w-full flex flex-col px-2 py-1.5 rounded-md text-left text-xs transition-colors duration-100 text-sidebar-foreground hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setActiveRunId(run.id);
                      setMobileNavOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{run.templateName}</span>
                      <Badge variant={run.status} dot />
                    </div>
                  </Link>
                ))
              ) : (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t("nav.noRunsYet")}
                </p>
              )}
            </div>
          )}

          {/* Bottom: Reports (admin) + Settings + User */}
          <div className="shrink-0 px-2 pb-2 pt-1 border-t border-sidebar-border">
            {me?.account.role === "admin" && (
              <SidebarItem
                label={t("nav.reportsQueue")}
                icon={<Flag className="h-3.5 w-3.5" />}
                active={sidebarSection === "reports"}
                to="/reports"
                onClick={() => {
                  setSidebarSection("reports");
                  setMobileNavOpen(false);
                }}
              />
            )}
            <SidebarItem
              label={t("nav.settings")}
              icon={<Settings className="h-3.5 w-3.5" />}
              active={sidebarSection === "settings"}
              to="/settings"
              onClick={() => {
                setSidebarSection("settings");
                setMobileNavOpen(false);
              }}
            />
            {me && (
              <div className="flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md bg-surface-2 border border-border">
                <div className="h-5 w-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-2xs font-semibold shrink-0">
                  {me.account.displayName.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-foreground truncate flex-1">
                  {me.account.displayName}
                </span>
                <IconButton
                  label={t("nav.signOut")}
                  size="xs"
                  onClick={() => void logout.mutateAsync()}
                >
                  <LogOut className="h-3 w-3" />
                </IconButton>
              </div>
            )}
          </div>
        </nav>

        {/* Main canvas — `min-w-0` lets it shrink under flex parents that
            don't, and `min-h-0` lets children with `overflow-y-auto` clip
            properly so following `shrink-0` siblings (chat composer, page
            footer pills) stay pinned to the viewport bottom on iOS Safari. */}
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col min-w-0">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
        </main>

        {/* Right Inspector — contextual; rendered ≥lg */}
        {showInspector && <Inspector />}
      </div>

      {/* Command Menu overlay — standard mode only */}
      <CommandMenu items={commandItems} />
    </div>
  );
}
