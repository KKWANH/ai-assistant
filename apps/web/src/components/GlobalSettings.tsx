/**
 * GlobalSettings — app-global preferences contributed to the Settings view via
 * the settings registry. The first proof that a module adds a config section
 * without SettingsView knowing about it; features/projects/surfaces register the
 * same way. Renders nothing — it only registers while mounted.
 */
import { useMemo } from "react";
import { useUIStore } from "../lib/store";
import { useRegisterSettings, type SettingsSection } from "../lib/settings-registry";
import { useT } from "../lib/i18n";

export function GlobalSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const workspaceAdvanced = useUIStore((s) => s.workspaceAdvanced);
  const setWorkspaceAdvanced = useUIStore((s) => s.setWorkspaceAdvanced);
  const { t } = useT();

  const section: SettingsSection = useMemo(
    () => ({
      title: t("settings.preferences"),
      fields: [
        {
          id: "dark-mode",
          label: t("settings.pref.darkMode"),
          type: "toggle",
          value: theme === "dark",
          onChange: (v) => setTheme(v ? "dark" : "light"),
        },
        {
          id: "advanced",
          label: t("workspace.advanced.label"),
          description: t("settings.pref.advanced.desc"),
          type: "toggle",
          value: workspaceAdvanced,
          onChange: setWorkspaceAdvanced,
        },
      ],
    }),
    [theme, workspaceAdvanced, setTheme, setWorkspaceAdvanced, t],
  );

  useRegisterSettings("preferences", section);
  return null;
}
