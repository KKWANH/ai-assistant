/**
 * Command registry — the extensibility spine for the Cmd+K palette.
 *
 * Any feature, project, or user-authored surface can contribute commands to the
 * palette WITHOUT editing the shell: call `useRegisterCommands(sourceId, items)`
 * and they appear (merged with the shell's built-ins, ranked by the palette's
 * fuzzy matcher) for as long as the calling component is mounted. This is the
 * platform's "register, don't hardcode" model — the same philosophy as the
 * project registry and the surface system, applied to commands.
 */
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Group header in the palette (empty-query view); ranked views ignore it. */
  section?: string;
  /** Only surface once the user types a query — for large dynamic sets (e.g.
   *  workspace file search) that would otherwise flood the empty palette. */
  queryOnly?: boolean;
  /** Default keyboard shortcut (a combo like "Mod+Shift+D"); the user can
   *  remap it. Fired globally by the Keybindings handler. Mod = ⌘ / Ctrl. */
  keybinding?: string;
}

interface CommandStore {
  /** Contributed command sets, keyed by a stable source id. */
  sources: Record<string, CommandItem[]>;
  register: (sourceId: string, items: CommandItem[]) => void;
  unregister: (sourceId: string) => void;
}

const useCommandStore = create<CommandStore>((set) => ({
  sources: {},
  register: (sourceId, items) => set((s) => ({ sources: { ...s.sources, [sourceId]: items } })),
  unregister: (sourceId) =>
    set((s) => {
      if (!(sourceId in s.sources)) return s;
      const next = { ...s.sources };
      delete next[sourceId];
      return { sources: next };
    }),
}));

/**
 * Contribute commands under a stable `sourceId` while the caller is mounted.
 * Pass a MEMOIZED `items` array (useMemo) so the registry isn't churned every
 * render. Re-registering the same sourceId replaces its previous set.
 */
export function useRegisterCommands(sourceId: string, items: CommandItem[]): void {
  const register = useCommandStore((s) => s.register);
  const unregister = useCommandStore((s) => s.unregister);
  useEffect(() => {
    register(sourceId, items);
    return () => unregister(sourceId);
  }, [sourceId, items, register, unregister]);
}

/** Every contributed command, flattened — read by the palette. */
export function useRegisteredCommands(): CommandItem[] {
  const sources = useCommandStore((s) => s.sources);
  return Object.values(sources).flat();
}
