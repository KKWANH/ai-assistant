import { useEffect, useState, type ReactNode, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import { useT } from "../../lib/i18n";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: styles["sm"]!,
  md: styles["md"]!,
  lg: styles["lg"]!,
};

/** Selector for elements Tab navigation can land on. Mirrors the
 *  WAI-ARIA dialog pattern's recommended list — covers the cases the
 *  dialogs in this app actually use (Button, IconButton, input,
 *  textarea, select, link) without dragging in a full focus-trap dep. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
  size = "md",
}: DialogProps) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Remember whatever was focused before opening so we can put focus
  // back when the dialog closes. Without this, closing a dialog drops
  // keyboard focus on document.body — the user loses their place.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Keep the dialog mounted through its exit animation: `render` lags `open`
  // by the exit duration, and `leaving` drives the reverse keyframes.
  const [render, setRender] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      setLeaving(false);
    } else if (render) {
      setLeaving(true);
      const id = window.setTimeout(() => setRender(false), 180);
      return () => window.clearTimeout(id);
    }
  }, [open, render]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap — keep Tab navigation inside the dialog. Without
      // this, Tab walks into the background (sidebar, header) which
      // is invisible behind the backdrop, so the user navigates
      // somewhere they can't see.
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      // Capture the outgoing focus + move focus to the dialog's first
      // focusable on next paint. Querying after mount lets useEffect-
      // attached refs / lazy children settle first.
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      const id = window.setTimeout(() => {
        if (!dialogRef.current) return;
        const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        first?.focus();
      }, 0);
      return () => {
        window.clearTimeout(id);
        document.body.style.overflow = "";
        // Restore focus — guard against the previous element being
        // gone (unmounted between open + close).
        const prev = previouslyFocusedRef.current;
        if (prev && document.body.contains(prev)) prev.focus();
      };
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!render) return null;

  const lv = leaving ? ` ${styles["leaving"]!}` : "";

  return (
    <div
      className={styles["overlay"]! + lv}
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? "dialog-title" : undefined}
    >
      <div
        className={styles["backdrop"]! + lv}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className={[
          styles["panel"]!,
          sizeClass[size],
          leaving ? styles["leaving"]! : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {(title || description) && (
          <div className={styles["header"]!}>
            <div>
              {title && (
                <h2 id="dialog-title" className={styles["title"]!}>
                  {title}
                </h2>
              )}
              {description && (
                <p className={styles["description"]!}>{description}</p>
              )}
            </div>
            <IconButton label={t("common.close")} size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className={styles["body"]!}>{children}</div>
      </div>
    </div>
  );
}
