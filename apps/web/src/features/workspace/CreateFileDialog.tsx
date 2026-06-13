/**
 * CreateFileDialog — make a workspace file by pasting its content.
 *
 * The "긴 글을 파일로 저장" feature: instead of attaching a transient file in
 * chat, the user names a file and pastes its body here. On create we kick off a
 * background rescan (so the file enters search + the snapshot) and open it in
 * the full editor for immediate confirmation. Restricted to plain data files —
 * the same set the server's create route allows.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { useCreateWorkspaceFile, useScanWorkspace } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

const ALLOWED_EXT = /\.(csv|tsv|txt|json|md|ya?ml)$/i;

export function CreateFileDialog({
  open,
  onClose,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const navigate = useNavigate();
  const createFile = useCreateWorkspaceFile(workspaceId);
  const scan = useScanWorkspace();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const trimmedName = name.trim();
  let nameError: string | undefined;
  if (trimmedName === "") nameError = t("workspace.createFile.nameRequired");
  else if (!ALLOWED_EXT.test(trimmedName)) nameError = t("workspace.createFile.badExt");

  const reset = () => {
    setName("");
    setContent("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameError) return;
    try {
      await createFile.mutateAsync({ path: trimmedName, content });
      // Rescan in the background so the new file lands in search + the
      // snapshot; we don't block the editor hand-off on it finishing.
      void scan.mutateAsync(workspaceId);
      toast({ title: t("workspace.createFile.created"), variant: "success" });
      close();
      navigate(`/workspaces/${workspaceId}/edit?path=${encodeURIComponent(trimmedName)}`);
    } catch (err) {
      toast({
        title: t("workspace.createFile.createFailed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("workspace.createFile.title")}
      description={t("workspace.createFile.description")}
      size="lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <Input
          label={t("workspace.createFile.nameLabel")}
          placeholder={t("workspace.createFile.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftElement={<FilePlus className="h-3.5 w-3.5" />}
          error={trimmedName === "" ? undefined : nameError}
          className="font-mono text-xs"
          autoFocus
          required
        />

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              {t("workspace.createFile.contentLabel")}
            </label>
            <span className="text-2xs text-muted-foreground/80">
              {t("workspace.createFile.charCount", { count: content.length.toLocaleString() })}
            </span>
          </div>
          <textarea
            className="h-64 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed text-foreground resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t("workspace.createFile.contentPlaceholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          <p className="text-2xs leading-snug text-muted-foreground/80">
            {t("workspace.createFile.extHint")}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={createFile.isPending}
            disabled={!!nameError}
          >
            {t("workspace.createFile.createBtn")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
