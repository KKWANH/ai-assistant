/**
 * SurfaceEditor — code editor for `.ariadne/surface.tsx`.
 *
 * Allows local users to edit and build the workspace surface code in-app.
 * Remote users see read-only view (403 on save → auto read-only).
 * Uses CodeMirror 6 with JavaScript/TypeScript highlighting.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Save, Hammer, AlertCircle, CheckCircle, Lock } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useSurface, useSaveSurface, useBuildSurface } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

export interface SurfaceEditorProps {
  workspaceId: string;
}

export function SurfaceEditor({ workspaceId }: SurfaceEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { toast } = useToast();
  const { t } = useT();

  const { data: surfaceData, isLoading } = useSurface(workspaceId);
  const saveSurface = useSaveSurface(workspaceId);
  const buildSurface = useBuildSurface(workspaceId);

  const [readOnly, setReadOnly] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildOk, setBuildOk] = useState(false);
  const [dirty, setDirty] = useState(false);

  const initialSource = surfaceData?.source ?? "";
  const state = surfaceData?.state;

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
        javascript({ typescript: true, jsx: true }),
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
      await saveSurface.mutateAsync(source);
      setDirty(false);
      setBuildError(null);
      toast({ title: t("surface.saved"), variant: "success" });
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) {
        setReadOnly(true);
        toast({
          title: t("surface.saveFailed"),
          description: t("surface.readOnlyNote"),
          variant: "error",
        });
      } else {
        toast({
          title: t("surface.saveFailed"),
          description: e.message,
          variant: "error",
        });
      }
    }
  };

  const handleBuild = async () => {
    setBuildError(null);
    setBuildOk(false);
    // Save first if dirty
    if (dirty) {
      const source = getSource();
      try {
        await saveSurface.mutateAsync(source);
        setDirty(false);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 403) {
          setReadOnly(true);
          toast({ title: t("surface.saveFailed"), variant: "error" });
          return;
        }
        toast({ title: t("surface.saveFailed"), description: (err as Error).message, variant: "error" });
        return;
      }
    }
    try {
      const result = await buildSurface.mutateAsync();
      if (result.ok) {
        setBuildOk(true);
        toast({ title: t("surface.buildSucceeded"), variant: "success" });
      } else {
        setBuildError(result.error ?? t("surface.buildFailed"));
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : t("surface.buildFailed"));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t("surface.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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
          variant="secondary"
          size="sm"
          leftIcon={<Save className="h-3.5 w-3.5" />}
          loading={saveSurface.isPending}
          disabled={readOnly || !dirty}
          onClick={() => void handleSave()}
        >
          {t("surface.save")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Hammer className="h-3.5 w-3.5" />}
          loading={buildSurface.isPending}
          disabled={readOnly}
          onClick={() => void handleBuild()}
        >
          {t("surface.build")}
        </Button>
      </div>

      {/* Surface state indicator */}
      {state && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {state.built ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle className="h-3.5 w-3.5" /> {t("surface.built")}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("surface.notBuilt")}</span>
          )}
          {state.updatedAt && (
            <span>{t("surface.savedAt", { date: new Date(state.updatedAt).toLocaleString() })}</span>
          )}
        </div>
      )}

      {/* Build error */}
      {buildError && (
        <Card className="flex items-start gap-2 px-4 py-3 border-destructive/30 bg-destructive/5">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-destructive">{t("surface.buildFailed")}</p>
            <pre className="mt-1 text-xs font-mono text-destructive/80 whitespace-pre-wrap">
              {buildError}
            </pre>
          </div>
        </Card>
      )}

      {buildOk && (
        <Card className="flex items-center gap-2 px-4 py-3 border-success/30 bg-success/5">
          <CheckCircle className="h-4 w-4 text-success shrink-0" />
          <p className="text-xs text-success">{t("surface.buildSucceededNote")}</p>
        </Card>
      )}

      {/* CodeMirror mount point */}
      <div
        ref={editorRef}
        className="rounded-xl border border-border overflow-hidden bg-[#282c34]"
        style={{ height: "500px" }}
      />

      <p className="text-xs text-muted-foreground">
        {t("surface.footerPrefix")}{" "}
        <code className="font-mono">.ariadne/surface.tsx</code>
        {" "}{t("surface.footerMid")}{" "}
        <code className="font-mono">window.ariadne</code>
        {" "}{t("surface.footerSuffix")}
      </p>
    </div>
  );
}
