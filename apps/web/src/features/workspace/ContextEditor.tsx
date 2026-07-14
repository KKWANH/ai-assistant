/**
 * ContextEditor — a modal to view and edit a workspace's project context
 * (`.ariadne/context.md`): the user's standing brief for the project, injected
 * into every chat and into deck/script generation. General to all workspaces.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { useT } from "../../lib/i18n";
import * as api from "../../lib/api";

export function ContextEditor({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["workspace-context", workspaceId],
    queryFn: () => api.getWorkspaceContext(workspaceId),
  });
  // Seed the editable buffer once the saved value loads.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (data && text === null) setText(data.context);
  }, [data, text]);

  const save = useMutation({
    mutationFn: (v: string) => api.setWorkspaceContext(workspaceId, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspace-context", workspaceId] });
      onClose();
    },
  });

  const value = text ?? "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border/60 bg-card/85 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.1] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("workspace.context.title")}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-surface-3" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("workspace.context.desc")}</p>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : (
          <textarea
            value={value}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            autoFocus
            placeholder={t("workspace.context.placeholder")}
            className="w-full resize-y rounded-md border border-border bg-surface-2 p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-3">
            {t("common.cancel")}
          </button>
          <button
            onClick={() => save.mutate(value)}
            disabled={save.isPending || isLoading}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
          >
            {save.isPending ? t("workspace.context.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
