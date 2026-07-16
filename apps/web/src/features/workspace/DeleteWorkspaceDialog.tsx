/**
 * DeleteWorkspaceDialog — confirm deleting a workspace, with an explicit,
 * default-OFF choice to also delete its data files on disk.
 *
 * Deleting the DB row alone leaves the files intact (the safe default). Ticking
 * "also delete files" sends ?deleteFiles=true; the server removes the rootPath
 * (guarded against catastrophic roots). The action is hard to reverse, so it
 * lives behind this confirm instead of the old one-click sidebar delete.
 */
import { useEffect, useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import type { Workspace } from "@ariadne/shared";
import { isBuiltinWorkspace } from "@ariadne/shared";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { useDeleteWorkspace } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

export function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onDeleted,
}: {
  workspace: Workspace | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const del = useDeleteWorkspace();
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Reset the dangerous (default-off) choice whenever the target changes.
  useEffect(() => {
    setDeleteFiles(false);
  }, [workspace?.id]);

  if (!workspace) return null;

  // Built-in samples live under the app's data dir and are re-seedable — the
  // server ignores deleteFiles for them, so don't offer the checkbox at all.
  const builtin = isBuiltinWorkspace(workspace.id);

  const handleDelete = async () => {
    try {
      const res = await del.mutateAsync({ id: workspace.id, deleteFiles: !builtin && deleteFiles });
      toast({
        title: t("workspace.delete.done", { name: workspace.name }),
        description: res.filesDeleted
          ? t("workspace.delete.filesRemoved")
          : t("workspace.delete.filesKept"),
        variant: "success",
      });
      onDeleted(workspace.id);
      onClose();
    } catch (err) {
      toast({
        title: t("workspace.delete.failed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  return (
    <Dialog
      open={!!workspace}
      onClose={onClose}
      title={t("workspace.delete.title", { name: workspace.name })}
      description={t("workspace.delete.description")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {!builtin && (
        <label
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
            deleteFiles ? "border-destructive/50 bg-destructive/5" : "border-border hover:bg-surface-3"
          }`}
        >
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--destructive))]"
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-medium text-foreground">
              {t("workspace.delete.alsoFiles")}
            </span>
            <span className="text-2xs font-mono text-muted-foreground break-all">
              {workspace.rootPath}
            </span>
            <span className="text-2xs text-muted-foreground">
              {deleteFiles ? t("workspace.delete.filesWarn") : t("workspace.delete.filesKeptHint")}
            </span>
          </span>
        </label>
        )}

        {deleteFiles && !builtin && (
          <div className="flex items-start gap-2 text-2xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{t("workspace.delete.irreversible")}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            type="button"
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            loading={del.isPending}
            onClick={() => void handleDelete()}
          >
            {deleteFiles ? t("workspace.delete.confirmWithFiles") : t("workspace.delete.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
