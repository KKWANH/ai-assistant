/**
 * FloatingChat — a chat that floats over a workspace's custom screen, so you can
 * watch the data (a surface / a project home) and chat about it at the same time
 * instead of switching away. A bottom-right button opens a glass panel anchored
 * to the screen; it reuses the full ThreadView (composer, modes, message list,
 * and the per-project starter empty state), grounded in this workspace's latest
 * chat (or a fresh one).
 *
 * Rendered as an absolute overlay, so its parent must be `relative`.
 */
import { useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, X, Maximize2 } from "lucide-react";
import { useT } from "../../lib/i18n";
import { useChats, useCreateChat } from "../../lib/queries";
import { Spinner } from "../../components/ui/Spinner";

// Lazy so the screen views (immersive home, the Screen tab) don't pull the chat
// bundle until the panel is actually opened — it shares the existing ChatView chunk.
const ThreadView = lazy(() => import("./ChatView").then((m) => ({ default: m.ThreadView })));

export function FloatingChat({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { data: chats } = useChats();
  const createChat = useCreateChat();
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);

  const handleOpen = async () => {
    if (!chatId) {
      // Continue the workspace's most recent chat, or start one.
      const wsChats = (chats ?? [])
        .filter((c) => c.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (wsChats[0]) setChatId(wsChats[0].id);
      else {
        try {
          const created = await createChat.mutateAsync({ workspaceId });
          setChatId(created.id);
        } catch {
          return; // surfaced by the mutation's own error path
        }
      }
    }
    setOpen(true);
  };

  return (
    <>
      {/* Glass panel — anchored to the screen, above the FAB. */}
      {open && chatId && (
        <div className="absolute bottom-[5.25rem] right-4 z-30 flex h-[min(68vh,560px)] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-2xl backdrop-blur-xl animate-fade-in">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-surface-2/50 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <MessageSquare className="h-3.5 w-3.5 text-accent" /> {t("chat.floating.label")}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { if (chatId) navigate(`/chat/${chatId}`); }}
                aria-label={t("chat.floating.expand")}
                title={t("chat.floating.expand")}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => { setOpen(false); }}
                aria-label={t("chat.floating.close")}
                title={t("chat.floating.close")}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner size="sm" label="Loading" /></div>}>
              <ThreadView chatId={chatId} />
            </Suspense>
          </div>
        </div>
      )}

      {/* FAB — toggles the panel. */}
      <button
        onClick={() => (open ? setOpen(false) : void handleOpen())}
        aria-label={t("chat.floating.label")}
        title={t("chat.floating.label")}
        className="absolute bottom-4 right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition hover:opacity-90 active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </button>
    </>
  );
}
