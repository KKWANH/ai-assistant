/**
 * ActionsEditor — YAML editor for workspace custom actions.
 *
 * Shows a CodeMirror YAML editor with the raw source of
 * `.ariadne/actions.yaml`. Parsed actions are displayed below.
 * Remote users get 403 on save → auto read-only.
 *
 * Reuses the SurfaceEditor CodeMirror pattern.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Save, Zap, AlertCircle, Lock, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useActions, useSaveActions } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

// CodeMirror doesn't include a built-in YAML language mode in our dependencies;
// we fall back to plain text editing but still get full editor UX.
// If @codemirror/lang-yaml is ever added, swap it in here.

export interface ActionsEditorProps {
  workspaceId: string;
}

export function ActionsEditor({ workspaceId }: ActionsEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { toast } = useToast();
  const { t } = useT();

  const { data: actionsData, isLoading } = useActions(workspaceId);
  const saveActions = useSaveActions(workspaceId);

  const [readOnly, setReadOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const initialSource = actionsData?.source ?? "";

  // Initialise / recreate CodeMirror when source loads
  useEffect(() => {
    if (!editorRef.current || isLoading) return;

    const editorState = EditorState.create({
      doc: initialSource,
      extensions: [
        oneDark,
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) setDirty(true);
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
        }),
      ],
    });

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    viewRef.current = new EditorView({
      state: editorState,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Re-init only when the workspace changes or loading completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, isLoading]);

  const getSource = useCallback(() => {
    return viewRef.current?.state.doc.toString() ?? "";
  }, []);

  const handleSave = async () => {
    const source = getSource();
    try {
      await saveActions.mutateAsync(source);
      setDirty(false);
      toast({ title: t("actions.saved"), variant: "success" });
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) {
        setReadOnly(true);
        toast({
          title: t("actions.saveFailed"),
          description: t("surface.readOnlyNote"),
          variant: "error",
        });
      } else {
        toast({
          title: t("actions.saveFailed"),
          description: e.message,
          variant: "error",
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {t("actions.loading")}
      </div>
    );
  }

  const actions = actionsData?.actions ?? [];
  const parseError = actionsData?.error ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">{t("actions.title")}</h2>
        <p className="text-xs text-muted-foreground flex-1">{t("actions.description")}</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {readOnly && (
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <Lock className="h-3.5 w-3.5" />
            {t("surface.readOnly")}
          </span>
        )}
        <div className="flex-1" />
        {dirty && (
          <span className="text-xs text-muted-foreground">{t("surface.unsavedChanges")}</span>
        )}
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Save className="h-3.5 w-3.5" />}
          loading={saveActions.isPending}
          disabled={readOnly || !dirty}
          onClick={() => void handleSave()}
        >
          {t("actions.save")}
        </Button>
      </div>

      {/* Parse error */}
      {parseError && (
        <Card className="flex items-start gap-2 px-4 py-3 border-destructive/30 bg-destructive/5">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-destructive">{t("actions.parseError")}</p>
            <pre className="mt-1 text-xs font-mono text-destructive/80 whitespace-pre-wrap">
              {parseError}
            </pre>
          </div>
        </Card>
      )}

      {/* CodeMirror mount */}
      <div
        ref={editorRef}
        className="rounded-xl border border-border overflow-hidden bg-[#282c34]"
        style={{ height: "400px" }}
      />

      {/* Parsed action list */}
      {actions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            {t("actions.parsed", { n: actions.length })}
          </h3>
          <div className="flex flex-col gap-1.5">
            {actions.map((action, i) => {
              const open = expanded.has(i);
              return (
                <Card key={action.id} className="px-3 py-2.5">
                  <button
                    className="w-full flex items-center gap-2 text-left"
                    onClick={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      });
                    }}
                  >
                    {open
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="font-mono text-xs text-accent shrink-0">{action.id}</span>
                    <span className="text-xs text-foreground truncate flex-1">{action.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{action.type}</span>
                  </button>
                  {open && (
                    <div className="mt-2 ml-5 flex flex-col gap-1 text-xs text-muted-foreground">
                      {action.description && (
                        <p>{action.description}</p>
                      )}
                      {action.script && (
                        <p><span className="text-foreground font-medium">{t("actions.field.script")}:</span> <code className="font-mono">{action.script}</code></p>
                      )}
                      {action.path && (
                        <p><span className="text-foreground font-medium">{t("actions.field.path")}:</span> <code className="font-mono">{action.path}</code></p>
                      )}
                      {action.query && (
                        <p><span className="text-foreground font-medium">{t("actions.field.query")}:</span> {action.query}</p>
                      )}
                      {action.template && (
                        <p><span className="text-foreground font-medium">{t("actions.field.template")}:</span> {action.template}</p>
                      )}
                      {action.constraints && (
                        <p><span className="text-foreground font-medium">{t("actions.field.constraints")}:</span> {action.constraints}</p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {actions.length === 0 && !parseError && !isLoading && (
        <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
          <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground mb-1">{t("actions.empty.title")}</p>
          <p className="text-xs text-muted-foreground">{t("actions.empty.body")}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("actions.footer")}
        {" "}<code className="font-mono">.ariadne/actions.yaml</code>
      </p>
    </div>
  );
}
