/**
 * Notification bell + inbox dropdown for the top bar.
 *
 * Polls /api/alerts (useAlerts, 30s). Shows an unread badge; the dropdown lists
 * recent alerts, click opens the linked run/chat and marks it read, with
 * mark-all-read and per-alert dismiss. Persisted server-side, so alerts survive
 * reloads (unlike toasts).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import type { Alert } from "@ariadne/shared";
import { IconButton } from "../../components/ui/IconButton";
import { useT } from "../../lib/i18n";
import {
  useAlerts,
  useMarkAlertRead,
  useMarkAllAlertsRead,
  useDeleteAlert,
} from "../../lib/queries";

export function NotificationsBell() {
  const { t } = useT();
  const navigate = useNavigate();
  const { data } = useAlerts();
  const markRead = useMarkAlertRead();
  const markAll = useMarkAllAlertsRead();
  const dismiss = useDeleteAlert();
  const [open, setOpen] = useState(false);

  const alerts = data?.alerts ?? [];
  const unread = data?.unreadCount ?? 0;
  const hasUnread = alerts.some((a) => !a.readAt);

  function openAlert(a: Alert): void {
    if (!a.readAt) markRead.mutate(a.id);
    if (a.link) {
      setOpen(false);
      navigate(a.link);
    }
  }

  return (
    <span className="relative inline-flex">
      <IconButton
        label={t("alerts.title")}
        description={t("alerts.title")}
        size="sm"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="relative inline-flex">
          <Bell className="h-3.5 w-3.5" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] leading-[14px] text-center font-semibold">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </IconButton>

      {open && createPortal(
        <>
          {/* Portaled to <body>: the dropdown must escape the top bar's own
              stacking context (its backdrop-blur creates one), otherwise the
              panel's backdrop-blur can't frost the main content behind it and
              the translucent panel bleeds sharp page text through. */}
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-[var(--z-modal)]" onClick={() => setOpen(false)} />
          <div className="fixed right-2 sm:right-3 top-11 z-[var(--z-modal)] w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface-1/90 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.08] shadow-elevation-3 animate-fade-in">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface-1">
              <span className="text-xs font-semibold text-foreground">{t("alerts.title")}</span>
              {hasUnread && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="text-2xs text-accent hover:underline"
                >
                  {t("alerts.markAllRead")}
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("alerts.empty")}</p>
            ) : (
              <ul className="flex flex-col">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={`group flex items-start gap-2 px-3 py-2 border-b border-border/50 transition-colors hover:bg-surface-2 ${a.readAt ? "" : "bg-accent/5"}`}
                  >
                    <button
                      type="button"
                      onClick={() => openAlert(a)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {!a.readAt && <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />}
                        <span className="text-xs font-medium text-foreground truncate">{a.title}</span>
                      </span>
                      {a.body && (
                        <span className="block text-2xs text-muted-foreground truncate">{a.body}</span>
                      )}
                      <span className="block text-2xs text-muted-foreground/70 mt-0.5">
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss.mutate(a.id)}
                      aria-label={t("alerts.dismiss")}
                      title={t("alerts.dismiss")}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}
