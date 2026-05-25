/**
 * HooksPanel — view + edit `.ariadne/hooks.yaml`, with per-hook log tails.
 *
 * For v1 the editor is a plain textarea. The actions.yaml editor is a
 * full CodeMirror experience; we lean on the simpler shape here
 * because hooks.yaml is much shorter (typically 5–10 lines of YAML)
 * and we want the panel to land in one batch. Upgrading to CodeMirror
 * later is a cosmetic swap.
 *
 * Editing is local-only on the server side. Remote viewers see the
 * panel but the Save button surfaces a clear "local only" error.
 */
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, ChevronDown, ChevronRight, Workflow } from "lucide-react";
import type { HookEvent } from "@ariadne/shared";
import {
  getWorkspaceHooks,
  putWorkspaceHooks,
  getHookLog,
} from "../../lib/api";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Textarea";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

const hooksKey = (workspaceId: string) => ["workspace-hooks", workspaceId] as const;

const SAMPLE_YAML = `# .ariadne/hooks.yaml — per-workspace commands that fire on key events.
# Events: staged_apply | post_scan | memory_added
# Env: $ARIADNE_EVENT is set on each invocation; $ARIADNE_PAYLOAD has event details as JSON.

hooks:
  - id: typecheck-on-apply
    event: staged_apply
    command: npm run typecheck
    timeoutMs: 60000
    enabled: true
`;

function HookLogTail({
  workspaceId,
  hookId,
}: {
  workspaceId: string;
  hookId: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const resp = await getHookLog(workspaceId, hookId);
      setLog(resp.log || "(no runs yet)");
    } finally {
      setLoading(false);
    }
  }

  function toggle(): void {
    if (!open && log === null) void load();
    setOpen(!open);
  }

  return (
    <div className="text-2xs">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t("hooks.log.show")}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <Button
            variant="ghost"
            size="xs"
            leftIcon={<RefreshCw className="h-3 w-3" />}
            onClick={() => void load()}
            loading={loading}
          >
            {t("hooks.log.refresh")}
          </Button>
          <pre className="rounded bg-surface-2 px-2 py-1.5 font-mono whitespace-pre-wrap break-words text-foreground/80 max-h-60 overflow-y-auto">
            {log ?? t("common.loading")}
          </pre>
        </div>
      )}
    </div>
  );
}

const EVENT_COLORS: Record<HookEvent, string> = {
  staged_apply: "text-accent",
  post_scan: "text-success",
  memory_added: "text-primary",
};

export function HooksPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: hooksKey(workspaceId),
    queryFn: () => getWorkspaceHooks(workspaceId),
    enabled: !!workspaceId,
  });

  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Hydrate the editor from the server source. We only do this once
  // per workspace (or when the user hits Reset), so a "save mid-edit"
  // race from another window doesn't clobber what they typed.
  useEffect(() => {
    if (!data) return;
    if (!dirty) {
      setDraft(data.source || SAMPLE_YAML);
    }
  }, [data, dirty]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const resp = await putWorkspaceHooks(workspaceId, { source: draft });
      queryClient.setQueryData(hooksKey(workspaceId), resp);
      setDirty(false);
      toast({ title: t("hooks.save.saved"), variant: "success" });
    } catch (err) {
      toast({
        title: t("hooks.save.failed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleReset(): void {
    if (!data) return;
    setDraft(data.source || SAMPLE_YAML);
    setDirty(false);
  }

  const hooks = data?.hooks ?? [];

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div className="flex items-start gap-2">
        <Workflow className="h-4 w-4 text-accent mt-0.5" />
        <div>
          <h2 className="text-base font-medium text-foreground">{t("hooks.panel.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("hooks.panel.subtitle")}</p>
        </div>
      </div>

      {/* Parsed-hooks summary — what the server actually knows about
          right now, separate from the editor's unsaved buffer. */}
      <div className="flex flex-col gap-2">
        <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("hooks.panel.registered", { n: hooks.length.toString() })}
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : hooks.length === 0 ? (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("hooks.panel.empty")}</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-1.5">
            {hooks.map((h) => (
              <Card key={h.id} className="p-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-foreground">{h.id}</span>
                  <span className={`font-mono ${EVENT_COLORS[h.event]}`}>on {h.event}</span>
                  {!h.enabled && (
                    <span className="text-muted-foreground">— {t("hooks.disabled")}</span>
                  )}
                </div>
                <div className="text-2xs text-muted-foreground font-mono break-all">
                  $ {h.command}
                </div>
                <HookLogTail workspaceId={workspaceId} hookId={h.id} />
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Editor — yaml source, plain textarea for v1. */}
      <div className="flex flex-col gap-2">
        <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("hooks.editor.title")}
        </div>
        <Textarea
          rows={14}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          disabled={saving}
          className="font-mono text-xs"
        />
        <div className="flex items-center justify-between text-2xs">
          <span className="text-muted-foreground">{t("hooks.editor.localOnly")}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || saving}
            >
              {t("hooks.editor.reset")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Save className="h-3.5 w-3.5" />}
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              loading={saving}
            >
              {t("hooks.editor.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
