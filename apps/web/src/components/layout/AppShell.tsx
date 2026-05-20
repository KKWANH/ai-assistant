/**
 * AppShell — chat-first redesign.
 *
 * Sidebar IA:
 *   [+ New chat]          ← prominent, top
 *   Chats (threads)       ← newest first, delete-on-hover
 *   ──────────────
 *   Workspaces            ← list + new
 *   Runs (recent)         ← standard mode only
 *   Search
 *   ──────────────
 *   Settings · User · Logout  ← pinned bottom
 *
 * Simple mode: hides Templates/Runs/Scripts/surface-edit/Command-menu
 * power features, keeping chat, workspaces, search, settings, logout.
 *
 * Top bar: Ariadne wordmark + breadcrumb + ⌘K + theme + help + inspector toggle.
 * Right Inspector: stays for workspace/run screens; hidden on chat screen.
 */
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FolderOpen,
  Play,
  Settings,
  PanelRight,
  Sun,
  Moon,
  Plus,
  ChevronRight,
  HelpCircle,
  LogOut,
  Search,
  Terminal,
  MessageSquare,
  MessageSquarePlus,
  Trash2,
  Globe,
} from "lucide-react";
import { useUIStore } from "../../lib/store";
import {
  useWorkspaces,
  useRuns,
  useMe,
  useLogout,
  useChats,
  useDeleteChat,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { SidebarItem } from "../ui/SidebarItem";
import { IconButton } from "../ui/IconButton";
import { Badge } from "../ui/Badge";
import { CommandMenu } from "../ui/CommandMenu";
import type { CommandItem } from "../ui/CommandMenu";
import { Inspector } from "./Inspector";
import type { AccountMode } from "@ariadne/shared";

export interface AppShellProps {
  children: ReactNode;
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
    setCommandMenuOpen,
    setTutorialOpen,
  } = useUIStore();

  const { data: workspaces } = useWorkspaces();
  const { data: allRuns } = useRuns();
  const { data: chats } = useChats();
  const { data: me } = useMe();
  const logout = useLogout();
  const deleteChat = useDeleteChat();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();

  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);

  const accountMode: AccountMode = me?.account.mode ?? "standard";
  const isSimple = accountMode === "simple";

  // Cmd+K — only in standard mode
  useEffect(() => {
    if (isSimple) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandMenuOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [setCommandMenuOpen, isSimple]);

  const activeChatId = location.pathname.startsWith("/chat/")
    ? location.pathname.split("/chat/")[1]
    : null;

  const commandItems: CommandItem[] = isSimple ? [] : [
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
      icon: <HelpCircle className="h-4 w-4" />,
      section: t("commandMenu.sectionApp"),
      onSelect: () => setTutorialOpen(true),
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

  // Determine if we're on a chat route — hide inspector for pure chat screens
  const onChatRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");

  const showInspector = inspectorOpen && !onChatRoute && !isSimple;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <header className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-topbar-border bg-topbar">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-topbar-foreground tracking-tight">
            Ariadne
          </span>
          {activeWorkspaceId && workspaces && !onChatRoute && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                {workspaces.find((w) => w.id === activeWorkspaceId)?.name}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* ⌘K hint — standard mode only */}
          {!isSimple && (
            <kbd
              data-tour="command-hint"
              className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground border border-border rounded-md font-mono"
            >
              ⌘K
            </kbd>
          )}
          {/* Help — standard mode only */}
          {!isSimple && (
            <IconButton
              label={t("nav.helpAndTutorial")}
              size="sm"
              onClick={() => setTutorialOpen(true)}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton label={t("nav.toggleTheme")} size="sm" onClick={toggleTheme}>
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
              <IconButton
                label={t("nav.signOut")}
                size="sm"
                onClick={() => void logout.mutateAsync()}
              >
                <LogOut className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
          {/* Inspector toggle — standard mode only */}
          {!isSimple && (
            <IconButton
              label={t("nav.toggleInspector")}
              size="sm"
              onClick={toggleInspector}
              data-tour="inspector-toggle"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav
          className="w-52 shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar overflow-hidden"
          aria-label={t("nav.ariaLabel")}
        >
          {/* New Chat button — prominent top action */}
          <div className="px-2 pt-2.5 pb-2 shrink-0">
            <button
              data-tour="new-chat"
              onClick={() => {
                setSidebarSection("chat");
                navigate("/");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageSquarePlus className="h-4 w-4 shrink-0" />
              {t("nav.newChat")}
            </button>
          </div>

          {/* Chats list */}
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            <div className="px-2 pb-1">
              {chats && chats.length > 0 ? (
                chats.slice(0, 20).map((chat) => (
                  <div
                    key={chat.id}
                    className="relative group"
                    onMouseEnter={() => setHoveredChatId(chat.id)}
                    onMouseLeave={() => setHoveredChatId(null)}
                  >
                    <SidebarItem
                      label={chat.title || t("commandMenu.untitledChat")}
                      icon={<MessageSquare className="h-3.5 w-3.5" />}
                      active={activeChatId === chat.id}
                      onClick={() => {
                        setSidebarSection("chat");
                        navigate(`/chat/${chat.id}`);
                      }}
                    />
                    {hoveredChatId === chat.id && (
                      <button
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteChat.mutateAsync(chat.id).then(() => {
                            if (activeChatId === chat.id) navigate("/");
                          });
                        }}
                        aria-label={t("nav.deleteChat")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("nav.noConversations")}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-sidebar-border mx-2 my-1" />

            {/* Workspaces */}
            <div className="px-2 pt-1 pb-1" data-tour="workspaces-section">
              <div className="flex items-center justify-between mb-1 px-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("nav.workspaces")}
                </span>
                <IconButton
                  label={t("nav.newWorkspace")}
                  size="xs"
                  onClick={() => setCreateWorkspaceOpen(true)}
                  data-tour="new-workspace"
                >
                  <Plus className="h-3 w-3" />
                </IconButton>
              </div>
              {workspaces && workspaces.length > 0 ? (
                workspaces.map((ws) => (
                  <div key={ws.id}>
                    <SidebarItem
                      label={ws.name}
                      icon={<FolderOpen className="h-3.5 w-3.5" />}
                      active={
                        activeWorkspaceId === ws.id &&
                        location.pathname.startsWith("/workspaces/")
                      }
                      onClick={() => {
                        setActiveWorkspaceId(ws.id);
                        setSidebarSection("workspaces");
                        navigate(`/workspaces/${ws.id}`);
                      }}
                      meta={ws.visibility === "public" ? (
                        <span className="flex items-center gap-0.5 text-[9px] text-accent font-medium">
                          <Globe className="h-2.5 w-2.5" />
                          {t("workspace.visibility.publicBadge")}
                        </span>
                      ) : undefined}
                    />
                    {/* Scripts link — standard mode only */}
                    {!isSimple &&
                      activeWorkspaceId === ws.id &&
                      location.pathname.startsWith("/workspaces/") && (
                        <SidebarItem
                          label={t("nav.scripts")}
                          icon={<Terminal className="h-3 w-3" />}
                          onClick={() =>
                            navigate(`/workspaces/${ws.id}/scripts`)
                          }
                          className="pl-5 text-[11px]"
                        />
                      )}
                  </div>
                ))
              ) : (
                <button
                  className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md"
                  onClick={() => setCreateWorkspaceOpen(true)}
                >
                  {t("nav.addWorkspace")}
                </button>
              )}
            </div>

            {/* Recent Runs — standard mode only */}
            {!isSimple && (
              <>
                {/* Divider */}
                <div className="border-t border-sidebar-border mx-2 my-1" />
                <div className="px-2 pt-1 pb-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 block mb-1">
                    {t("nav.recentRuns")}
                  </span>
                  {allRuns && allRuns.length > 0 ? (
                    allRuns.slice(0, 6).map((run) => (
                      <button
                        key={run.id}
                        className="w-full flex flex-col px-2 py-1.5 rounded-md text-left text-xs transition-colors duration-100 text-sidebar-foreground hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setActiveRunId(run.id);
                          navigate(`/runs/${run.id}`);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{run.templateName}</span>
                          <Badge variant={run.status} dot />
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("nav.noRunsYet")}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Bottom: Search + Settings + User */}
          <div className="shrink-0 px-2 pb-2 pt-1 border-t border-sidebar-border">
            <SidebarItem
              label={t("nav.search")}
              icon={<Search className="h-3.5 w-3.5" />}
              active={sidebarSection === "search"}
              onClick={() => {
                setSidebarSection("search");
                navigate("/search");
              }}
            />
            <SidebarItem
              label={t("nav.settings")}
              icon={<Settings className="h-3.5 w-3.5" />}
              active={sidebarSection === "settings"}
              onClick={() => {
                setSidebarSection("settings");
                navigate("/settings");
              }}
            />
            {me && (
              <div className="flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md bg-surface-2 border border-border">
                <div className="h-5 w-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">
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

        {/* Main canvas */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
        </main>

        {/* Right Inspector — hidden on chat routes and in simple mode */}
        {showInspector && <Inspector />}
      </div>

      {/* Command Menu overlay — standard mode only */}
      {!isSimple && <CommandMenu items={commandItems} />}
    </div>
  );
}
