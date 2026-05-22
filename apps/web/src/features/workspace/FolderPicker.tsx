/**
 * FolderPicker — browse the server host's filesystem and pick a directory.
 * Replaces error-prone manual path typing for workspace creation.
 */
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Folder,
  FileText,
  CornerLeftUp,
  FolderPlus,
  Check,
  Loader2,
} from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import * as api from "../../lib/api";

export interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function FolderPicker({
  open,
  onClose,
  onSelect,
  initialPath,
}: FolderPickerProps) {
  const { toast } = useToast();
  const { t } = useT();
  const qc = useQueryClient();
  // `undefined` → server defaults to the home directory.
  const [cwd, setCwd] = useState<string | undefined>(initialPath);
  const [newFolder, setNewFolder] = useState("");
  const [creating, setCreating] = useState(false);

  const listing = useQuery({
    queryKey: ["fs", cwd ?? "~"],
    queryFn: () => api.listDir(cwd),
    enabled: open,
  });

  const mkdir = useMutation({
    mutationFn: ({ parent, name }: { parent: string; name: string }) =>
      api.makeDir(parent, name),
    onSuccess: (res) => {
      setNewFolder("");
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["fs"] });
      setCwd(res.path);
      toast({ title: t("folderPicker.created"), variant: "success" });
    },
    onError: (err) => {
      toast({
        title: t("folderPicker.createFailed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    },
  });

  const data = listing.data;
  const dirs = data?.entries.filter((e) => e.isDirectory) ?? [];
  const files = data?.entries.filter((e) => !e.isDirectory) ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("folderPicker.title")}
      description={t("folderPicker.description")}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        {/* Current path + Up */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!data?.parent}
            onClick={() => data?.parent && setCwd(data.parent)}
          >
            <CornerLeftUp className="h-3.5 w-3.5" />
            {t("common.back")}
          </Button>
          <code className="flex-1 truncate rounded-md border border-border bg-surface-2 px-2 py-1.5 text-2xs text-muted-foreground">
            {data?.path ?? "…"}
          </code>
        </div>

        {/* Directory listing */}
        <div className="h-64 overflow-y-auto rounded-md border border-border bg-surface-1">
          {listing.isLoading && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {listing.isError && (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
              {listing.error instanceof Error
                ? listing.error.message
                : t("folderPicker.cannotRead")}
            </div>
          )}
          {data && (
            <ul className="py-1">
              {dirs.length === 0 && files.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  {t("folderPicker.empty")}
                </li>
              )}
              {dirs.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    onClick={() => setCwd(d.path)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate">{d.name}</span>
                  </button>
                </li>
              ))}
              {files.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* New folder */}
        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder={t("folderPicker.newFolderPlaceholder")}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              autoFocus
              className="text-xs"
            />
            <Button
              variant="secondary"
              size="sm"
              type="button"
              loading={mkdir.isPending}
              disabled={newFolder.trim() === "" || !data}
              onClick={() =>
                data &&
                mkdir.mutate({ parent: data.path, name: newFolder.trim() })
              }
            >
              {t("common.create")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setCreating(false);
                setNewFolder("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("folderPicker.newFolder")}
          </button>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!data}
            onClick={() => {
              if (data) {
                onSelect(data.path);
                onClose();
              }
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {t("folderPicker.select")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
