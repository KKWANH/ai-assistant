/**
 * SectionManagerDialog — assign every workspace to a sidebar section in ONE
 * place, instead of opening each workspace's Settings. Sections are the fixed
 * set (WORKSPACE_SECTIONS); this just bulk-edits which section each workspace
 * belongs to. Each change saves immediately (useUpdateWorkspace), so the sidebar
 * regroups live.
 */
import { Dialog } from "../../components/ui/Dialog";
import { Select } from "../../components/ui/Select";
import { useWorkspaces, useUpdateWorkspace } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { useToast } from "../../components/ui/Toast";
import { WORKSPACE_SECTIONS, isBuiltinWorkspace } from "@ariadne/shared";
import { FolderOpen } from "lucide-react";

export function SectionManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const { data: workspaces } = useWorkspaces();
  const update = useUpdateWorkspace();

  const setSection = (id: string, v: string) =>
    update
      .mutateAsync({ id, input: { section: v || null } })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  // Only workspaces the user can edit + that aren't built-in showcases.
  const editable = (workspaces ?? []).filter((w) => w.editable !== false && !isBuiltinWorkspace(w.id));
  const options = [
    { value: "", label: t("section.none") },
    ...WORKSPACE_SECTIONS.map((s) => ({ value: s.id, label: t(s.labelKey) })),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("section.manage.title")}
      description={t("section.manage.desc")}
      size="md"
    >
      {editable.length > 0 ? (
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {editable.map((w) => (
            <div key={w.id} className="flex items-center gap-3">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm text-foreground">{w.name}</span>
              <div className="w-40 shrink-0">
                <Select
                  value={w.section ?? ""}
                  onChange={(e) => void setSection(w.id, e.target.value)}
                  disabled={update.isPending}
                  options={options}
                  aria-label={t("section.manage.title")}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-2">{t("section.manage.empty")}</p>
      )}
    </Dialog>
  );
}
