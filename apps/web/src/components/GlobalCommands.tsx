/**
 * GlobalCommands — app-level commands contributed to the Cmd+K palette through
 * the command registry. The first proof that any module can extend the palette
 * without touching the shell; features, projects, and surfaces register the
 * same way. Renders nothing — it only registers while mounted.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Moon, SunMedium, Sparkles, SlidersHorizontal, Code2 } from "lucide-react";
import { useUIStore } from "../lib/store";
import { useMe, useUpdateMode } from "../lib/queries";
import { useRegisterCommands, type CommandItem } from "../lib/commands";
import { useT } from "../lib/i18n";

export function GlobalCommands() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const { data: me } = useMe();
  const updateMode = useUpdateMode();
  const isSimple = me?.account.mode === "simple";
  const navigate = useNavigate();
  const { t } = useT();

  const items: CommandItem[] = useMemo(
    () => [
      {
        id: "global.toggle-theme",
        label: t("nav.toggleTheme"),
        description: t("nav.toggleTheme.desc"),
        icon: theme === "dark" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
        section: t("commandMenu.sectionApp"),
        keybinding: "Mod+Shift+Y",
        onSelect: () => toggleTheme(),
      },
      {
        id: "global.toggle-mode",
        label: isSimple ? t("nav.mode.toStandard") : t("nav.mode.toSimple"),
        description: t("nav.mode.toggle.desc"),
        icon: isSimple ? <SlidersHorizontal className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />,
        section: t("commandMenu.sectionApp"),
        keybinding: "Mod+Shift+M",
        onSelect: () => updateMode.mutate(isSimple ? "standard" : "simple"),
      },
      {
        id: "global.developer-docs",
        label: t("nav.developerDocs"),
        description: t("nav.developerDocs.desc"),
        icon: <Code2 className="h-4 w-4" />,
        section: t("commandMenu.sectionApp"),
        onSelect: () => navigate("/developers"),
      },
    ],
    [theme, toggleTheme, isSimple, updateMode, navigate, t],
  );

  useRegisterCommands("global", items);
  return null;
}
