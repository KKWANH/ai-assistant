/**
 * Keybindings — fires registry commands by their effective keyboard shortcut
 * (user override from the keybindings store ?? the command's declared default).
 * Suppressed while typing in a field, so remap-capture inputs and normal typing
 * are never swallowed. Renders nothing.
 */
import { useEffect } from "react";
import { useRegisteredCommands } from "../lib/commands";
import { useKeybindings, comboFromEvent } from "../lib/keybindings";

export function Keybindings() {
  const commands = useRegisteredCommands();
  const overrides = useKeybindings((s) => s.overrides);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      for (const cmd of commands) {
        const binding = cmd.id in overrides ? overrides[cmd.id] : cmd.keybinding;
        if (binding && binding === combo) {
          e.preventDefault();
          cmd.onSelect();
          return;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [commands, overrides]);

  return null;
}
