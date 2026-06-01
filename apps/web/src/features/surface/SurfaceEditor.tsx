/**
 * SurfaceEditor — code editor for `.ariadne/surface.tsx`.
 *
 * Allows local users to edit and build the workspace surface code in-app.
 * Remote users see read-only view (403 on save → auto read-only).
 * Uses CodeMirror 6 with JavaScript/TypeScript highlighting.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Save, Hammer, AlertCircle, CheckCircle, Lock, FileCode, Plus, Trash2, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useSurface, useSaveSurface, useBuildSurface } from "../../lib/queries";
import * as api from "../../lib/api";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { SurfaceView } from "./SurfaceView";

const LIVE_KEY = "ariadne.surfaceLivePreview";
const LIVE_DEBOUNCE_MS = 900;

// BJ5 — small starter scaffolds so a builder begins from a working example,
// not a blank file (or a 4K-line flagship). Inserted into the empty editor.
const SCAFFOLDS: Array<{ id: string; label: string; source: string }> = [
  {
    id: "minimal",
    label: "Minimal",
    source: `import { React } from "@ariadne/surface";

export default function App() {
  return (
    <div style={{ padding: 24, color: "rgb(var(--foreground))" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Hello from your surface</h1>
      <p style={{ color: "rgb(var(--muted-foreground))" }}>
        Edit this in the Edit screen — with Live on it rebuilds as you type.
      </p>
    </div>
  );
}
`,
  },
  {
    id: "data",
    label: "Data + chart",
    source: `import { React, useState, useEffect, useAriadne, BarChart } from "@ariadne/surface";

export default function App() {
  const ariadne = useAriadne();
  const [bars, setBars] = useState<Array<{ label: string; value: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Point this at a CSV in your workspace (header row, then columns).
      const { rows } = await ariadne.readCsv("data.csv");
      const data = rows.map((r) => ({ label: r.name ?? "", value: Number(r.value) || 0 }));
      if (!cancelled) setBars(data);
    })().catch(() => { /* missing file etc. — leave empty */ });
    return () => { cancelled = true; };
  }, [ariadne]);

  return (
    <div style={{ padding: 24, color: "rgb(var(--foreground))" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>My data</h1>
      <BarChart data={bars} title="From data.csv" />
    </div>
  );
}
`,
  },
];

export interface SurfaceEditorProps {
  workspaceId: string;
}

/**
 * Token-driven CodeMirror chrome — every colour is a CSS custom property, so
 * the editor follows Ariadne's light/dark theme automatically (no recreation).
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "rgb(var(--surface-2))",
    color: "rgb(var(--foreground))",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
  ".cm-content": { caretColor: "rgb(var(--foreground))" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--foreground))" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgb(var(--muted))",
  },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--surface-2))",
    color: "rgb(var(--muted-foreground))",
    borderRight: "1px solid rgb(var(--border))",
  },
  ".cm-activeLine": { backgroundColor: "rgb(var(--surface-3))" },
  ".cm-activeLineGutter": { backgroundColor: "rgb(var(--surface-3))" },
});

/** Syntax highlighting in semantic theme tokens — readable in light and dark. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "rgb(var(--info))" },
  { tag: tags.string, color: "rgb(var(--success))" },
  { tag: tags.comment, color: "rgb(var(--muted-foreground))", fontStyle: "italic" },
  { tag: [tags.number, tags.bool], color: "rgb(var(--warning))" },
  { tag: [tags.typeName, tags.tagName, tags.className], color: "rgb(var(--info))" },
]);

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

  // BJ3 — live preview: debounce-auto-save+build on edit + an embedded preview
  // that reloads on each successful build, so the surface dev loop is type →
  // pause → see, with no manual Save/Build/tab-switch.
  const [livePreview, setLivePreview] = useState<boolean>(() => {
    try { return localStorage.getItem(LIVE_KEY) !== "0"; } catch { return true; }
  });
  const [buildNonce, setBuildNonce] = useState(0);   // bumped on each ok build → reloads preview
  const [changeSeq, setChangeSeq] = useState(0);     // bumped on each edit → drives the debounce
  const autoBuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AK — multi-file folder support. When .ariadne/surface/ exists, the
  // editor switches into 'folder mode': a small tab strip across the
  // top, click-to-swap between files. Saving routes to the new
  // PUT /surface/folder/file endpoint with the active file's path.
  const qc = useQueryClient();
  const { data: folderData } = useQuery({
    queryKey: ["surface-folder", workspaceId],
    queryFn: () => api.getSurfaceFolder(workspaceId),
    enabled: !!workspaceId,
  });
  const folderFiles = useMemo(() => folderData?.files ?? [], [folderData]);
  const folderMode = !!folderData?.folderExists && folderFiles.length > 0;
  // Active file path within the folder (relative). Single-file mode uses null.
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // Per-file dirty tracking so switching tabs doesn't silently drop changes.
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, string>>({});

  // Default the active file to index.tsx when folder mode kicks in.
  useEffect(() => {
    if (folderMode && activeFile === null) {
      setActiveFile(folderFiles[0]?.path ?? null);
    }
  }, [folderMode, activeFile, folderFiles]);

  const initialSource = folderMode && activeFile
    ? (dirtyFiles[activeFile] ?? folderFiles.find((f) => f.path === activeFile)?.content ?? "")
    : (surfaceData?.source ?? "");
  const state = surfaceData?.state;

  // Initialise / recreate CodeMirror when source loads — also re-runs
  // when activeFile changes (folder mode tab switch), so the editor
  // surfaces the newly-selected file's content. Per-file dirty state
  // is preserved in dirtyFiles so an unsaved file isn't silently lost.
  useEffect(() => {
    if (!editorRef.current || isLoading) return;

    const editorState = EditorState.create({
      doc: initialSource,
      extensions: [
        editorTheme,
        syntaxHighlighting(highlightStyle),
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        javascript({ typescript: true, jsx: true }),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDirty(true);
            setChangeSeq((s) => s + 1); // BJ3 — drives the live-mode debounce
            // In folder mode, also persist the in-memory edit per-file
            // so the user can tab-hop without losing changes.
            if (folderMode && activeFile) {
              setDirtyFiles((prev) => ({
                ...prev,
                [activeFile]: update.state.doc.toString(),
              }));
            }
          }
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
    // Re-init when workspace, loading, OR the active file changes
    // (folder mode tab switch). initialSource is derived above, so we
    // depend on its inputs explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, isLoading, activeFile, folderMode]);

  const getSource = useCallback(() => {
    return viewRef.current?.state.doc.toString() ?? "";
  }, []);

  const handleSave = async () => {
    const source = getSource();
    try {
      if (folderMode && activeFile) {
        // AK — save active file via the folder-file endpoint.
        await api.saveSurfaceFolderFile(workspaceId, activeFile, source);
        setDirtyFiles((prev) => {
          const next = { ...prev };
          delete next[activeFile];
          return next;
        });
      } else {
        await saveSurface.mutateAsync(source);
      }
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

  const handleBuild = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    setBuildError(null);
    setBuildOk(false);
    // Save current source first (folder mode → the active file).
    if (dirty) {
      const source = getSource();
      try {
        if (folderMode && activeFile) {
          await api.saveSurfaceFolderFile(workspaceId, activeFile, source);
        } else {
          await saveSurface.mutateAsync(source);
        }
        setDirty(false);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 403) {
          setReadOnly(true);
          if (!silent) toast({ title: t("surface.saveFailed"), variant: "error" });
          return;
        }
        if (!silent) toast({ title: t("surface.saveFailed"), description: (err as Error).message, variant: "error" });
        return;
      }
    }
    try {
      const result = await buildSurface.mutateAsync();
      if (result.ok) {
        setBuildNonce((n) => n + 1); // BJ3 — reload the embedded live preview
        // In live mode the refreshing preview IS the feedback — skip the
        // success banner/toast so a pause-triggered build isn't noisy. Errors
        // still surface below regardless.
        if (!silent) {
          setBuildOk(true);
          toast({ title: t("surface.buildSucceeded"), variant: "success" });
        }
      } else {
        setBuildError(result.error ?? t("surface.buildFailed"));
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : t("surface.buildFailed"));
    }
  };

  // BJ3 — debounced auto-save+build while live preview is on. Re-runs on each
  // edit (changeSeq); the trailing timer wins so we build once edits settle.
  useEffect(() => {
    if (!livePreview || readOnly || changeSeq === 0) return;
    if (autoBuildTimer.current) clearTimeout(autoBuildTimer.current);
    autoBuildTimer.current = setTimeout(() => { void handleBuild({ silent: true }); }, LIVE_DEBOUNCE_MS);
    return () => { if (autoBuildTimer.current) clearTimeout(autoBuildTimer.current); };
    // handleBuild is captured fresh each render; the effect re-runs on changeSeq.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeSeq, livePreview, readOnly]);

  const toggleLive = () => {
    setLivePreview((prev) => {
      const next = !prev;
      try { localStorage.setItem(LIVE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // BJ5 — drop a starter scaffold into the empty editor. The CodeMirror change
  // listener picks it up (dirty + changeSeq) so Live mode builds it immediately.
  const applyScaffold = (source: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    view.focus();
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
          variant={livePreview ? "primary" : "outline"}
          size="sm"
          leftIcon={<Zap className="h-3.5 w-3.5" />}
          disabled={readOnly}
          onClick={toggleLive}
          title={t("surface.livePreviewHint")}
        >
          {t("surface.livePreview")}
        </Button>
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

      {/* AK + AL3 — File tab strip (folder mode only) with new/delete. */}
      {folderMode && folderFiles.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-xs border-b border-border pb-1">
          <span className="text-muted-foreground mr-2 shrink-0 flex items-center gap-1">
            <FileCode className="h-3.5 w-3.5" />
            {t("surface.folderFiles")}
          </span>
          {folderFiles.map((f) => {
            const isActive = activeFile === f.path;
            const isDirty = dirtyFiles[f.path] !== undefined;
            return (
              <div
                key={f.path}
                className={[
                  "flex items-center rounded-md font-mono overflow-hidden",
                  isActive ? "bg-accent text-accent-foreground" : "bg-surface-2 hover:bg-surface-3 text-foreground",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => setActiveFile(f.path)}
                  className="px-2 py-1"
                  title={`${f.path} (${Math.ceil(f.size / 1024)} kB)`}
                >
                  {f.path}
                  {isDirty && <span className="ml-1 text-warning">●</span>}
                </button>
                {f.path !== "index.tsx" && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (readOnly) return;
                      const ok = window.confirm(t("surface.deleteFileConfirm", { path: f.path }));
                      if (!ok) return;
                      try {
                        await api.deleteSurfaceFolderFile(workspaceId, f.path);
                        await qc.invalidateQueries({ queryKey: ["surface-folder", workspaceId] });
                        if (activeFile === f.path) {
                          // Switch to index.tsx if we just deleted the active file.
                          setActiveFile("index.tsx");
                        }
                        setDirtyFiles((prev) => {
                          const next = { ...prev };
                          delete next[f.path];
                          return next;
                        });
                        toast({ title: t("surface.fileDeleted", { path: f.path }), variant: "success" });
                      } catch (err) {
                        toast({ title: t("surface.fileDeleteFailed"), description: (err as Error).message, variant: "error" });
                      }
                    }}
                    disabled={readOnly}
                    className="px-1.5 py-1 hover:bg-destructive/20 text-current opacity-60 hover:opacity-100"
                    title={t("surface.deleteFile")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {/* + New file */}
          <button
            type="button"
            onClick={async () => {
              if (readOnly) return;
              const raw = window.prompt(t("surface.newFilePrompt"));
              if (!raw) return;
              const rel = raw.trim();
              if (!rel) return;
              try {
                await api.createSurfaceFolderFile(workspaceId, rel, "");
                await qc.invalidateQueries({ queryKey: ["surface-folder", workspaceId] });
                setActiveFile(rel);
                toast({ title: t("surface.fileCreated", { path: rel }), variant: "success" });
              } catch (err) {
                toast({ title: t("surface.fileCreateFailed"), description: (err as Error).message, variant: "error" });
              }
            }}
            disabled={readOnly}
            className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-3 flex items-center gap-1"
            title={t("surface.newFile")}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t("surface.newFile")}</span>
          </button>
        </div>
      )}

      {/* BJ5 — starter scaffolds for an empty surface (skip in folder mode). */}
      {(surfaceData?.source ?? "").trim() === "" && !readOnly && !folderMode && (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-xs font-medium text-foreground mr-1">{t("surface.scaffold.title")}</span>
          {SCAFFOLDS.map((s) => (
            <Button key={s.id} variant="outline" size="sm" onClick={() => applyScaffold(s.source)}>
              {s.label}
            </Button>
          ))}
        </Card>
      )}

      {/* BJ3 — editor + live preview split. Stacks on narrow screens. */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* CodeMirror mount point */}
        <div
          ref={editorRef}
          className="rounded-xl border border-border overflow-hidden bg-surface-2 min-w-0 lg:flex-1"
          style={{ height: "500px" }}
        />
        {livePreview && (
          <div className="min-w-0 lg:flex-1 flex flex-col" style={{ height: "500px" }}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Zap className="h-3 w-3 text-accent" />
              {t("surface.preview")}
              {state?.built === false && <span className="text-warning">· {t("surface.notBuilt")}</span>}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <SurfaceView workspaceId={workspaceId} reloadKey={buildNonce} />
            </div>
          </div>
        )}
      </div>

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
