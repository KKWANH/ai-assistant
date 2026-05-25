/**
 * MemoryPanel — list + manage the per-workspace memory.
 *
 * Rendered inside a tab on WorkspaceOverview. Lets the user:
 *   - Add a memory by hand (the "manual" promotion path that doesn't
 *     start from a chat).
 *   - Delete an existing memory.
 *   - See where each memory came from (source.kind + ref).
 *
 * Edits-in-place are not in v1; edit by deleting and re-adding. Keeps
 * the contract minimal and the YAML diff trivial.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, BrainCircuit, MessageSquare, Edit3 } from "lucide-react";
import type { WorkspaceMemory } from "@ariadne/shared";
import {
  listWorkspaceMemory,
  addWorkspaceMemory,
  deleteWorkspaceMemory,
} from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Textarea } from "../../components/ui/Textarea";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { useMe } from "../../lib/queries";

const MAX_LEN = 500;

const memoryKey = (workspaceId: string) => ["workspace-memory", workspaceId] as const;

function formatAddedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SourceBadge({ memory }: { memory: WorkspaceMemory }) {
  const { t } = useT();
  if (!memory.source) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
        <Edit3 className="h-3 w-3" />
        {t("memory.source.manual")}
      </span>
    );
  }
  if (memory.source.kind === "chat") {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
        <MessageSquare className="h-3 w-3" />
        {t("memory.source.chat")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
      <Edit3 className="h-3 w-3" />
      {t("memory.source.manual")}
    </span>
  );
}

export function MemoryPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const isSimple = me?.account.mode === "simple";
  const { data, isLoading } = useQuery({
    queryKey: memoryKey(workspaceId),
    queryFn: () => listWorkspaceMemory(workspaceId),
    enabled: !!workspaceId,
  });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const memories = data?.memories ?? [];
  const canAdd = draft.trim().length > 0 && !saving;

  async function handleAdd(): Promise<void> {
    if (!canAdd) return;
    setSaving(true);
    try {
      await addWorkspaceMemory(workspaceId, {
        text: draft.trim(),
        source: { kind: "manual" },
      });
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: memoryKey(workspaceId) });
      toast({ title: t("memory.saved"), variant: "success" });
    } catch (err) {
      toast({
        title: t("memory.saveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(memoryId: string): Promise<void> {
    setBusyId(memoryId);
    try {
      await deleteWorkspaceMemory(workspaceId, memoryId);
      await queryClient.invalidateQueries({ queryKey: memoryKey(workspaceId) });
    } catch (err) {
      toast({
        title: t("memory.deleteFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BrainCircuit className="h-4 w-4 text-accent" />
          <h2 className="text-base font-medium text-foreground">{t("memory.panel.title")}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t(isSimple ? "memory.panel.subtitle.simple" : "memory.panel.subtitle")}</p>
      </div>

      <Card className="p-3 flex flex-col gap-2">
        <Textarea
          label={t("memory.panel.addLabel")}
          hint={t("memory.panel.addHint")}
          placeholder={t("memory.panel.addPlaceholder")}
          rows={3}
          maxLength={MAX_LEN}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
        />
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-foreground">
            {draft.length.toString()} / {MAX_LEN.toString()}
          </span>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => void handleAdd()}
            disabled={!canAdd}
            loading={saving}
          >
            {t("memory.panel.addButton")}
          </Button>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        {isLoading && (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        )}
        {!isLoading && memories.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground">{t("memory.panel.empty")}</p>
          </Card>
        )}
        {memories.map((m) => (
          <Card key={m.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{m.text}</p>
              <div className="mt-1.5 flex items-center gap-3 text-2xs text-muted-foreground">
                <span>{formatAddedAt(m.addedAt)}</span>
                {m.addedBy && <span>· {m.addedBy}</span>}
                <SourceBadge memory={m} />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDelete(m.id)}
              disabled={busyId === m.id}
              loading={busyId === m.id}
              aria-label={t("memory.panel.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
