/**
 * Settings registry — the configurability backbone (P2). Parallel to the command
 * registry: any feature, project, or surface registers a config SECTION (a
 * titled group of fields) and the Settings view renders it, without the shell
 * hardcoding every preference. Each field carries its own value + onChange, so
 * the owner keeps its state/persistence — the registry is purely for discovery
 * and rendering. "register, don't hardcode", applied to settings.
 */
import { useEffect } from "react";
import { create } from "zustand";

export type SettingsField =
  | {
      id: string;
      label: string;
      description?: string;
      type: "toggle";
      value: boolean;
      onChange: (value: boolean) => void;
    }
  | {
      id: string;
      label: string;
      description?: string;
      type: "select";
      value: string;
      options: { value: string; label: string }[];
      onChange: (value: string) => void;
    };

export interface SettingsSection {
  title: string;
  fields: SettingsField[];
}

interface SettingsStore {
  sections: Record<string, SettingsSection>;
  register: (id: string, section: SettingsSection) => void;
  unregister: (id: string) => void;
}

const useSettingsStore = create<SettingsStore>((set) => ({
  sections: {},
  register: (id, section) => set((s) => ({ sections: { ...s.sections, [id]: section } })),
  unregister: (id) =>
    set((s) => {
      if (!(id in s.sections)) return s;
      const next = { ...s.sections };
      delete next[id];
      return { sections: next };
    }),
}));

/**
 * Contribute a settings section under a stable `id` while the caller is mounted.
 * Pass a MEMOIZED `section` (useMemo) so the registry isn't churned every render.
 */
export function useRegisterSettings(id: string, section: SettingsSection): void {
  const register = useSettingsStore((s) => s.register);
  const unregister = useSettingsStore((s) => s.unregister);
  useEffect(() => {
    register(id, section);
    return () => unregister(id);
  }, [id, section, register, unregister]);
}

/** Every contributed section (with its id) — read by the Settings view. */
export function useRegisteredSettings(): Array<{ id: string; section: SettingsSection }> {
  const sections = useSettingsStore((s) => s.sections);
  return Object.entries(sections).map(([id, section]) => ({ id, section }));
}
