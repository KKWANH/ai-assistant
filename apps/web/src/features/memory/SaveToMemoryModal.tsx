/**
 * SaveToMemoryModal — the promotion gate.
 *
 * AI surfaces a fact in chat → user clicks 📌 → modal opens with the
 * full message text pre-filled and editable → user trims to a useful
 * single sentence → save. The persisted memory is what the user typed,
 * not what the AI said. That's the gate: nothing reaches
 * `.ariadne/memory.yaml` without explicit human approval.
 */
import { useState } from "react";
import type { AddMemoryInput } from "@ariadne/shared";
import { Dialog } from "../../components/ui/Dialog";
import { Textarea } from "../../components/ui/Textarea";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { addWorkspaceMemory } from "../../lib/api";

export interface SaveToMemoryModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Pre-fills the editable textarea. Usually the assistant message text. */
  initialText: string;
  /** Optional source ref — typically the assistant message id. */
  source?: AddMemoryInput["source"];
  /** Fired after a successful save so the parent can refresh its list. */
  onSaved?: () => void;
}

const MAX_LEN = 500;

export function SaveToMemoryModal({
  open,
  onClose,
  workspaceId,
  initialText,
  source,
  onSaved,
}: SaveToMemoryModalProps) {
  const { t } = useT();
  const { toast } = useToast();
  // Trim the prefill aggressively — full assistant messages are usually
  // way more than a memory should be. If the user wants the rest, they
  // can paste.
  const trimmed = initialText.trim().slice(0, MAX_LEN);
  const [text, setText] = useState(trimmed);
  const [saving, setSaving] = useState(false);

  // Re-seed on each open without useEffect dance: when `initialText`
  // changes between opens, key the dialog on it via the parent. For v1
  // we accept the slightly-stale state on consecutive opens of the same
  // bubble — the user is editing anyway.

  const canSave = text.trim().length > 0;

  async function handleSave(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await addWorkspaceMemory(workspaceId, {
        text: text.trim(),
        source,
      });
      toast({
        title: t("memory.saved"),
        description: text.trim().slice(0, 60),
        variant: "success",
      });
      setSaving(false);
      onSaved?.();
      onClose();
    } catch (err) {
      toast({
        title: t("memory.saveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("memory.save.title")}
      description={t("memory.save.subtitle")}
      size="md"
    >
      <div className="flex flex-col gap-3">
        <Textarea
          label={t("memory.save.textLabel")}
          hint={t("memory.save.textHint")}
          rows={4}
          maxLength={MAX_LEN}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
        <div className="text-2xs text-muted-foreground -mt-1 self-end">
          {text.length.toString()} / {MAX_LEN.toString()}
        </div>
        <div className="flex items-center justify-end gap-2 mt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={!canSave}
            loading={saving}
          >
            {t("memory.save.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
