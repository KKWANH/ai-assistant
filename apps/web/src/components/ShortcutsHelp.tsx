/**
 * ShortcutsHelp — keyboard-shortcuts reference, opened with `?` (when not typing
 * in a field). The first P2 (configurability) increment: a canonical, data-driven
 * list of the app's shortcuts. A later step turns SHORTCUTS into a remappable
 * registry; for now it's the reference power users reach for.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";
import type { TranslationKey } from "../lib/i18n/en";

const SHORTCUTS: { groupKey: TranslationKey; items: { keys: string; descKey: TranslationKey }[] }[] = [
  {
    groupKey: "shortcuts.group.general",
    items: [
      { keys: "⌘ K", descKey: "shortcuts.commandPalette" },
      { keys: "?", descKey: "shortcuts.thisHelp" },
      { keys: "Esc", descKey: "shortcuts.dismiss" },
    ],
  },
  {
    groupKey: "shortcuts.group.chat",
    items: [{ keys: "⌘ ↵", descKey: "shortcuts.send" }],
  },
  {
    groupKey: "shortcuts.group.editor",
    items: [{ keys: "⌘ S", descKey: "shortcuts.save" }],
  },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const { t } = useT();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      // `?` toggles — but not while typing in a field.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement as HTMLElement | null;
        const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (typing) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-command)] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-modal-in"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t("shortcuts.title")}</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
            aria-label={t("shortcuts.dismiss")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {SHORTCUTS.map((group) => (
            <div key={group.groupKey}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t(group.groupKey)}</p>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.descKey} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{t(item.descKey)}</span>
                    <kbd className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
