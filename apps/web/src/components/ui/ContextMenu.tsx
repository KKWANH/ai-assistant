/**
 * ContextMenu — a native-feeling right-click menu rendered at the cursor. Pair
 * with useContextMenu(): spread `bind` on the target's onContextMenu, render
 * <ContextMenu {...menu} items={…} />. Portaled to <body>, viewport-clamped,
 * dismiss on click-away / Escape / scroll, with the shared exit animation.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "../../lib/useExitTransition";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

export function useContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAt({ x: e.clientX, y: e.clientY });
  }, []);
  const close = useCallback(() => setAt(null), []);
  return { bind: { onContextMenu }, at, open: at !== null, close };
}

export function ContextMenu({
  at,
  open,
  close,
  items,
}: {
  at: { x: number; y: number } | null;
  open: boolean;
  close: () => void;
  items: ContextMenuItem[];
}) {
  const { mounted, leaving } = useExitTransition(open, 100);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  if (!mounted || !at) return null;

  // Clamp to the viewport so the menu never spills off any edge.
  const W = 184;
  const H = items.length * 30 + 8;
  const left = Math.max(8, Math.min(at.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - H - 8));

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[var(--z-command)]"
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div
        role="menu"
        style={{ left, top, minWidth: W }}
        className={`fixed z-[var(--z-command)] rounded-lg border border-border/60 bg-card/90 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.08] shadow-xl py-1 text-xs origin-top-left transition-all duration-100 ${
          leaving ? "opacity-0 scale-95" : "animate-fade-in"
        }`}
      >
        {items.map((it, i) => (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              it.onSelect();
              close();
            }}
            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
              it.destructive
                ? "text-destructive hover:bg-destructive/10"
                : "text-foreground hover:bg-surface-3"
            }`}
          >
            {it.icon && <span className="shrink-0 text-muted-foreground">{it.icon}</span>}
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
