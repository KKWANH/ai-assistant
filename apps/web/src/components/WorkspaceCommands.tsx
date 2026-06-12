/**
 * WorkspaceCommands — when a workspace is active, registers its files as
 * query-only commands in the Cmd+K palette: type a filename, jump straight into
 * the editor. Same registry pattern as GlobalCommands, but contextual to the
 * open workspace — the palette grows with where you are. Renders nothing.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { useUIStore } from "../lib/store";
import { useSnapshot } from "../lib/queries";
import { useRegisterCommands, type CommandItem } from "../lib/commands";
import { useT } from "../lib/i18n";

export function WorkspaceCommands() {
  const workspaceId = useUIStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();
  const { t } = useT();
  const { data: snapshot } = useSnapshot(workspaceId ?? "", !!workspaceId);

  const items: CommandItem[] = useMemo(() => {
    if (!workspaceId || !snapshot) return [];
    const section = t("commandMenu.sectionFiles");
    // Cap so a huge workspace can't bloat the registry; fuzzy search over the
    // capped set still finds anything the user is likely reaching for.
    return snapshot.files.slice(0, 500).map((f) => ({
      id: `file:${f.path}`,
      label: f.path.split("/").pop() ?? f.path,
      description: f.path,
      icon: <FileText className="h-4 w-4" />,
      section,
      queryOnly: true,
      onSelect: () => navigate(`/workspaces/${workspaceId}/edit?path=${encodeURIComponent(f.path)}`),
    }));
  }, [workspaceId, snapshot, navigate, t]);

  useRegisterCommands("workspace-files", items);
  return null;
}
