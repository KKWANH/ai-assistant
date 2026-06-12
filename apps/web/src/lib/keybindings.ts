/**
 * Keybindings (P2 #1) — user-remappable keyboard shortcuts for registry commands.
 *
 * A command in the command registry may declare a default `keybinding`; this
 * store holds the user's per-command OVERRIDES (persisted to localStorage), and
 * the Keybindings handler fires whichever combo is effective (override ?? default).
 * The `?` shortcuts overlay reads + remaps through here. Combines the command
 * registry (what runs) with persisted config (how it's bound).
 */
import { create } from "zustand";

const LS_KEY = "ariadne.keybindings.v1";

function load(): Record<string, string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persist(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable — overrides stay in-memory for the session */
  }
}

interface KeybindingStore {
  /** commandId → combo. An empty string means "unbound" (user cleared it). */
  overrides: Record<string, string>;
  setBinding: (commandId: string, combo: string) => void;
  resetBinding: (commandId: string) => void;
}

export const useKeybindings = create<KeybindingStore>((set) => ({
  overrides: load(),
  setBinding: (commandId, combo) =>
    set((s) => {
      const overrides = { ...s.overrides, [commandId]: combo };
      persist(overrides);
      return { overrides };
    }),
  resetBinding: (commandId) =>
    set((s) => {
      if (!(commandId in s.overrides)) return s;
      const overrides = { ...s.overrides };
      delete overrides[commandId];
      persist(overrides);
      return { overrides };
    }),
}));

/**
 * Normalized combo string from a keydown event, e.g. "Mod+K", "Shift+D", "G".
 * Mod folds ⌘/Ctrl so a binding works cross-platform. Returns "" for a bare
 * modifier press (so capturing waits for the real key).
 */
export function comboFromEvent(e: KeyboardEvent): string {
  if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

/** A combo string as display keys, e.g. "Mod+Shift+D" → "⌘ ⇧ D". */
export function comboToDisplay(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "Mod" ? "⌘" : p === "Shift" ? "⇧" : p === "Alt" ? "⌥" : p === "Enter" ? "↵" : p))
    .join(" ");
}
