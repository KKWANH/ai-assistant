/**
 * ShortcutsHelp — keyboard-shortcuts reference + remap UI, opened with `?` (when
 * not typing in a field). Lists the app's built-in shortcuts (static table) and
 * the registry commands that carry a keybinding — those are user-REMAPPABLE here
 * (click the combo, press a new one; reset reverts to the default). The remap
 * input is focused, so the global Keybindings handler ignores it and the capture
 * never fires the command. The P2 configurable-keybindings UI.
 */
import { useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { useT } from "../lib/i18n";
import type { TranslationKey } from "../lib/i18n/en";
import { useRegisteredCommands } from "../lib/commands";
import { useKeybindings, comboFromEvent, comboToDisplay } from "../lib/keybindings";

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
  const [recording, setRecording] = useState<string | null>(null);
  const { t } = useT();
  const commands = useRegisteredCommands();
  const { overrides, setBinding, resetBinding } = useKeybindings();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // While capturing a new binding, the focused input owns every key.
      if (recording) return;
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
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
  }, [open, recording]);

  if (!open) return null;

  // Registry commands that carry a default binding or a user override — the
  // remappable set (file-search and other query-only commands are excluded).
  const bindable = commands.filter((c) => c.keybinding != null || c.id in overrides);

  return (
    <div
      className="fixed inset-0 z-[var(--z-command)] flex items-center justify-center p-4"
      onClick={() => {
        setRecording(null);
        setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <div
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card/85 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.1] shadow-2xl animate-modal-in"
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

          {bindable.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("shortcuts.group.commands")}</p>
              <div className="space-y-1.5">
                {bindable.map((cmd) => {
                  const combo = cmd.id in overrides ? overrides[cmd.id] : cmd.keybinding;
                  return (
                    <div key={cmd.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-foreground">{cmd.label}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {recording === cmd.id ? (
                          <input
                            autoFocus
                            readOnly
                            value=""
                            placeholder={t("shortcuts.pressKey")}
                            onKeyDown={(e) => {
                              e.preventDefault();
                              if (e.key === "Escape") {
                                setRecording(null);
                                return;
                              }
                              const c = comboFromEvent(e.nativeEvent);
                              if (c) {
                                setBinding(cmd.id, c);
                                setRecording(null);
                              }
                            }}
                            onBlur={() => setRecording(null)}
                            className="w-28 rounded border border-accent bg-surface-2 px-2 py-0.5 text-xs outline-none"
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => setRecording(cmd.id)}
                              className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                            >
                              {combo ? comboToDisplay(combo) : t("shortcuts.unbound")}
                            </button>
                            {cmd.id in overrides && (
                              <button
                                onClick={() => resetBinding(cmd.id)}
                                title={t("shortcuts.reset")}
                                aria-label={t("shortcuts.reset")}
                                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
