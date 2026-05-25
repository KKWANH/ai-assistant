/**
 * PromoteCaseModal — shared modal opened by chat 👎 and search 👎.
 *
 * Captures the bare minimum for a useful eval case:
 *   - the query (read-only, pre-filled)
 *   - "what file SHOULD have been returned?" (optional path)
 *   - free-text note (optional)
 *
 * Backend rejects unless at least one of path / note is provided.
 */
import { useState } from "react";
import type { PromoteEvalCaseInput } from "@ariadne/shared";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { promoteEvalCase } from "../../lib/api";

export interface PromoteCaseModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  query: string;
  source: PromoteEvalCaseInput["source"];
  /** Traceability handle: a chat message id for source="chat", a chunk
   *  file path for source="search". Stored on the YAML as `source.ref`. */
  sourceRef?: string;
  /** If the caller already knows the file that *should* have been
   *  retrieved, pre-fill the mustHit input. */
  initialMustHitPath?: string;
}

export function PromoteCaseModal({
  open,
  onClose,
  workspaceId,
  query,
  source,
  sourceRef,
  initialMustHitPath,
}: PromoteCaseModalProps) {
  const { t } = useT();
  const { toast } = useToast();
  const [mustHitPath, setMustHitPath] = useState(initialMustHitPath ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Backend requires at least one positive/negative/note hint or the case
  // is meaningless. Button's `loading` prop handles the in-flight disable.
  const canSave = mustHitPath.trim().length > 0 || note.trim().length > 0;

  function reset(): void {
    setMustHitPath("");
    setNote("");
    setSaving(false);
  }

  // See SaveToMemoryModal: inline "✓ Saved" pulse before close so the
  // user's eye (focused on the modal) sees confirmation, not just a
  // toast in the bottom-right they missed.
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const res = await promoteEvalCase({
        workspaceId,
        query,
        source,
        sourceRef,
        mustHitPath: mustHitPath.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast({
        title: t("eval.promote.saved"),
        description: res.caseId,
        variant: "success",
      });
      setSaving(false);
      setSavedAt(Date.now());
      setTimeout(() => {
        reset();
        onClose();
      }, 700);
    } catch (err) {
      toast({
        title: t("eval.promote.failed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("eval.promote.title")}
      description={t("eval.promote.subtitle")}
      size="md"
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="text-2xs text-muted-foreground mb-1">
            {t("eval.promote.queryLabel")}
          </div>
          <div className="text-sm text-foreground break-words">{query}</div>
        </div>

        <Input
          label={t("eval.promote.mustHitLabel")}
          hint={t("eval.promote.mustHitHint")}
          placeholder="src/services/retrieval.ts"
          value={mustHitPath}
          onChange={(e) => setMustHitPath(e.target.value)}
          disabled={saving}
        />

        <Textarea
          label={t("eval.promote.noteLabel")}
          hint={t("eval.promote.noteHint")}
          placeholder={t("eval.promote.notePlaceholder")}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
        />

        <div className="flex items-center justify-end gap-2 mt-1">
          {savedAt !== null ? (
            <span className="text-xs text-success font-medium inline-flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              {t("eval.promote.saved")}
            </span>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                  onClose();
                }}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSave()}
                disabled={!canSave}
                loading={saving}
              >
                {t("eval.promote.save")}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
