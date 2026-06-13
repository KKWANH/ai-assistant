/**
 * WorkspaceFileEditor — full-screen CodeMirror editor for any workspace file.
 *
 * Route: /workspaces/:id/edit?path=<relPath>
 *
 * Reads the file via GET /workspaces/:id/file, edits it in CodeMirror with
 * language-appropriate syntax highlighting + line numbers + active-line +
 * Vim-ish keymap basics. Save stages the edit through POST /file/stage
 * (same flow the AI's edit_file and the Data tab use), then shows a
 * Review & apply CTA that links to /runs/:runId/diff.
 *
 * Languages: C/C++/Python/JavaScript/TypeScript/Rust/Go are highlighted;
 * everything else falls back to plain text (line numbers still active).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { ArrowLeft, Save, FileDiff, FileText, AlertCircle, X } from "lucide-react";
import { useWorkspace, useSnapshot } from "../../lib/queries";
import { getWorkspaceFile, stageWorkspaceFile } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { NotFoundRedirect } from "../../components/NotFoundRedirect";
import { FileTree } from "./FileTree";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "rgb(var(--background))",
    color: "rgb(var(--foreground))",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { caretColor: "rgb(var(--foreground))", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--foreground))" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgb(var(--muted) / 0.4)",
  },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--surface-2))",
    color: "rgb(var(--muted-foreground))",
    borderRight: "1px solid rgb(var(--border))",
    paddingRight: "8px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 12px", minWidth: "32px" },
  ".cm-activeLine": { backgroundColor: "rgb(var(--surface-2) / 0.6)" },
  ".cm-activeLineGutter": { backgroundColor: "rgb(var(--surface-3))" },
  ".cm-matchingBracket": { backgroundColor: "rgb(var(--accent) / 0.25)", outline: "1px solid rgb(var(--accent))" },
  ".cm-foldPlaceholder": { backgroundColor: "rgb(var(--surface-3))", color: "rgb(var(--muted-foreground))", border: "none", padding: "0 4px" },
  // Find/replace panel — themed to Ariadne tokens so it isn't a light-mode
  // island in the dark editor.
  ".cm-panels": { backgroundColor: "rgb(var(--surface-2))", color: "rgb(var(--foreground))" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid rgb(var(--border))" },
  ".cm-panel.cm-search": { padding: "6px 8px", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
  ".cm-panel.cm-search label": { fontSize: "11px", color: "rgb(var(--muted-foreground))" },
  ".cm-panel.cm-search input[type=text]": {
    backgroundColor: "rgb(var(--background))",
    color: "rgb(var(--foreground))",
    border: "1px solid rgb(var(--border))",
    borderRadius: "4px",
    padding: "2px 6px",
    fontSize: "12px",
  },
  ".cm-panel.cm-search button": {
    backgroundColor: "rgb(var(--surface-3))",
    color: "rgb(var(--foreground))",
    border: "1px solid rgb(var(--border))",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  },
  ".cm-panel.cm-search button:hover": { backgroundColor: "rgb(var(--surface-2))" },
  ".cm-searchMatch": { backgroundColor: "rgb(var(--warning) / 0.3)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(var(--accent) / 0.45)" },
});

/**
 * Syntax tokens mapped to Ariadne's semantic colour tokens — readable in
 * both light and dark, no per-theme recompile. Keep these tied to the
 * surface editor's palette so the look is consistent across both editors.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "rgb(var(--info))" },
  { tag: tags.controlKeyword, color: "rgb(var(--info))", fontWeight: "600" },
  { tag: tags.operatorKeyword, color: "rgb(var(--info))" },
  { tag: tags.string, color: "rgb(var(--success))" },
  { tag: tags.regexp, color: "rgb(var(--success))" },
  { tag: tags.comment, color: "rgb(var(--muted-foreground))", fontStyle: "italic" },
  { tag: tags.lineComment, color: "rgb(var(--muted-foreground))", fontStyle: "italic" },
  { tag: tags.blockComment, color: "rgb(var(--muted-foreground))", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null], color: "rgb(var(--warning))" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "rgb(var(--info))" },
  { tag: tags.tagName, color: "rgb(var(--info))" },
  { tag: tags.attributeName, color: "rgb(var(--warning))" },
  { tag: tags.function(tags.variableName), color: "rgb(var(--accent))" },
  { tag: tags.definition(tags.function(tags.variableName)), color: "rgb(var(--accent))", fontWeight: "600" },
  { tag: tags.macroName, color: "rgb(var(--warning))", fontWeight: "600" },
  { tag: tags.propertyName, color: "rgb(var(--foreground))" },
  { tag: tags.variableName, color: "rgb(var(--foreground))" },
  { tag: tags.heading, color: "rgb(var(--info))", fontWeight: "700" },
  { tag: tags.link, color: "rgb(var(--accent))", textDecoration: "underline" },
]);

function languageExtension(filePath: string): Extension | null {
  const lower = filePath.toLowerCase();
  if (/\.(c|h|cc|cpp|hpp|cxx|hxx)$/.test(lower)) return cpp();
  if (/\.(py|pyi)$/.test(lower)) return python();
  if (/\.(ts|tsx|cts|mts)$/.test(lower)) return javascript({ typescript: true, jsx: lower.endsWith(".tsx") });
  if (/\.(jsx)$/.test(lower)) return javascript({ jsx: true });
  if (/\.(js|cjs|mjs)$/.test(lower)) return javascript();
  if (/\.rs$/.test(lower)) return rust();
  if (/\.go$/.test(lower)) return go();
  return null;
}

function languageLabel(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (/\.(c|h)$/.test(lower)) return "C";
  if (/\.(cc|cpp|hpp|cxx|hxx)$/.test(lower)) return "C++";
  if (/\.(py|pyi)$/.test(lower)) return "Python";
  if (/\.(ts|tsx|cts|mts)$/.test(lower)) return "TypeScript";
  if (/\.(jsx|js|cjs|mjs)$/.test(lower)) return "JavaScript";
  if (/\.rs$/.test(lower)) return "Rust";
  if (/\.go$/.test(lower)) return "Go";
  if (/\.md$/.test(lower)) return "Markdown";
  if (/\.(json|yaml|yml|toml)$/.test(lower)) return lower.split(".").pop()?.toUpperCase() ?? "Text";
  if (/(^|\/)Makefile$/i.test(filePath)) return "Makefile";
  return "Text";
}

export function WorkspaceFileEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get("path") ?? "";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const { confirm } = useConfirm();
  const { data: snapshot } = useSnapshot(id ?? "");

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Open tabs (P3 multi-tab) + a per-tab buffer cache. The cache holds each
  // open file's current buffer + a dirty flag so switching tabs restores the
  // exact unsaved buffer instead of reloading from disk.
  const [openPaths, setOpenPaths] = useState<string[]>(filePath ? [filePath] : []);
  const bufferCacheRef = useRef<Map<string, { buffer: string; dirty: boolean }>>(new Map());

  // Whenever a new file becomes active (via tree click or a deep link), make
  // sure it has a tab.
  useEffect(() => {
    if (!filePath) return;
    setOpenPaths((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  }, [filePath]);

  const { data: ws, isLoading: wsLoading } = useWorkspace(id ?? "");
  const fileQuery = useQuery({
    queryKey: ["workspace-file", id, filePath],
    queryFn: () => getWorkspaceFile(id ?? "", filePath),
    enabled: !!id && !!filePath,
  });

  const [dirty, setDirty] = useState(false);
  const [staging, setStaging] = useState(false);
  const [staged, setStaged] = useState<{ runId: string; added: number; removed: number } | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const langExt = useMemo(() => languageExtension(filePath), [filePath]);
  const langLabel = useMemo(() => languageLabel(filePath), [filePath]);

  // Initialise CodeMirror once the file content arrives. Re-init on file
  // change so opening a different file replaces the buffer cleanly.
  useEffect(() => {
    if (!editorRef.current || !fileQuery.data) return;

    // Restore this tab's cached buffer (preserving unsaved edits across tab
    // switches); fall back to on-disk content the first time a file is opened.
    const cached = bufferCacheRef.current.get(filePath);
    const doc = cached?.buffer ?? fileQuery.data.content;
    const initialDirty = cached?.dirty ?? false;
    bufferCacheRef.current.set(filePath, { buffer: doc, dirty: initialDirty });

    const extensions: Extension[] = [
      editorTheme,
      syntaxHighlighting(highlightStyle),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      bracketMatching(),
      indentOnInput(),
      history(),
      // Find/replace (P3): ⌘F opens the search panel at the top; matches are
      // highlighted, ⌘⌥F / the panel's Replace handle replace.
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          bufferCacheRef.current.set(filePath, { buffer: u.state.doc.toString(), dirty: true });
          setDirty(true);
          // Stale CTA — a new edit invalidates the prior staged manifest's diff.
          setStaged(null);
        }
      }),
    ];
    if (langExt) extensions.push(langExt);

    const state = EditorState.create({ doc, extensions });

    if (viewRef.current) viewRef.current.destroy();
    viewRef.current = new EditorView({ state, parent: editorRef.current });
    setDirty(initialDirty);
    setStaged(null);
    setStageError(null);

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileQuery.data?.content, filePath, langExt]);

  async function handleStage() {
    if (!viewRef.current || !id) return;
    setStaging(true);
    setStageError(null);
    try {
      const content = viewRef.current.state.doc.toString();
      const result = await stageWorkspaceFile(id, filePath, content);
      // The staged buffer is the new clean baseline for this tab.
      bufferCacheRef.current.set(filePath, { buffer: content, dirty: false });
      setStaged({ runId: result.runId, added: result.added, removed: result.removed });
      setDirty(false);
      toast({
        title: t("workspace.fileEditor.staged"),
        description: t("workspace.data.stagedDetail", {
          added: result.added.toString(),
          removed: result.removed.toString(),
        }),
        variant: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStageError(msg);
      toast({ title: t("workspace.fileEditor.stageFailed"), description: msg, variant: "error" });
    } finally {
      setStaging(false);
    }
  }

  // Open / switch to a file (from the tree or a tab). Unsaved edits live in the
  // per-tab buffer cache, so switching never loses work — no guard needed.
  function handleOpenFile(path: string) {
    if (!path || path === filePath) return;
    navigate(`/workspaces/${id}/edit?path=${encodeURIComponent(path)}`);
  }

  // Close a tab. Confirm if it has unsaved edits (closing drops its cached
  // buffer). When closing the active tab, fall back to an adjacent one.
  async function handleCloseTab(path: string) {
    if (bufferCacheRef.current.get(path)?.dirty) {
      const ok = await confirm({
        message: t("workspace.fileEditor.discardConfirm"),
        confirmLabel: t("workspace.fileEditor.discardConfirmBtn"),
        danger: true,
      });
      if (!ok) return;
    }
    bufferCacheRef.current.delete(path);
    const idx = openPaths.indexOf(path);
    const next = openPaths.filter((p) => p !== path);
    setOpenPaths(next);
    if (path === filePath) {
      const nextActive = next[idx] ?? next[idx - 1] ?? "";
      navigate(
        nextActive
          ? `/workspaces/${id}/edit?path=${encodeURIComponent(nextActive)}`
          : `/workspaces/${id}/edit`,
      );
    }
  }

  // Cmd/Ctrl+S → stage (without leaving the editor for File→Save reflex).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !staging) void handleStage();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, staging]);

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!ws) return <NotFoundRedirect />;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border bg-background">
        <PageHeader
          icon={<FileText className="h-5 w-5" />}
          title={
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-sm truncate">{filePath || "(no path)"}</span>
              <span className="text-2xs text-muted-foreground px-1.5 py-0.5 rounded bg-surface-3">
                {langLabel}
              </span>
              {dirty && <span className="text-2xs text-accent">●</span>}
            </span>
          }
          description={
            <span className="flex items-center gap-2 text-xs">
              <Link to={`/workspaces/${ws.id}`} className="text-muted-foreground hover:text-foreground">
                ← {ws.name}
              </Link>
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
                onClick={() => navigate(`/workspaces/${ws.id}`)}
              >
                {t("common.back")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Save className="h-3.5 w-3.5" />}
                disabled={!dirty || staging || !filePath}
                loading={staging}
                onClick={() => void handleStage()}
              >
                {t("workspace.fileEditor.stage")}
              </Button>
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* IDE file tree (P3 editing core) — browse + open the workspace's files
            without leaving the editor. Reads the latest snapshot; a click loads
            the file via ?path= (guarding unsaved edits first). */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface-2/40">
          <FileTree
            files={snapshot?.files ?? []}
            activePath={filePath}
            onSelect={(p) => void handleOpenFile(p)}
          />
        </aside>

        <div className="flex-1 min-h-0 flex flex-col">
        {/* Open-file tabs (P3 multi-tab). Per-tab buffers are preserved, so
            switching is lossless; the dot marks unsaved edits. */}
        {openPaths.length > 0 && (
          <div className="shrink-0 flex items-stretch overflow-x-auto border-b border-border bg-surface-2/30">
            {openPaths.map((path) => {
              const isActive = path === filePath;
              const name = path.split("/").pop() ?? path;
              const tabDirty = bufferCacheRef.current.get(path)?.dirty ?? false;
              return (
                <div
                  key={path}
                  onClick={() => handleOpenFile(path)}
                  title={path}
                  className={[
                    "group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs border-r border-border cursor-pointer max-w-[180px] shrink-0",
                    isActive
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-surface-3",
                  ].join(" ")}
                >
                  <span className="truncate font-mono">{name}</span>
                  {tabDirty && <span className="text-accent text-[9px] leading-none">●</span>}
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCloseTab(path);
                    }}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      {!filePath && (
        <Card className="m-5 p-6">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {t("workspace.fileEditor.noPath")}
          </p>
        </Card>
      )}

      {filePath && fileQuery.isLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      )}

      {filePath && fileQuery.error && (
        <Card className="m-5 p-6">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {fileQuery.error instanceof Error ? fileQuery.error.message : t("workspace.fileEditor.loadFailed")}
          </p>
        </Card>
      )}

      {filePath && fileQuery.data && (
        <>
          {staged && (
            <div className="shrink-0 mx-5 mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <FileDiff className="h-3.5 w-3.5 text-accent" />
                <span className="text-foreground">
                  {t("workspace.data.stagedShort", {
                    added: staged.added.toString(),
                    removed: staged.removed.toString(),
                  })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setStaged(null)}>
                  {t("workspace.data.stageDismiss")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/runs/${staged.runId}/diff`)}
                >
                  {t("workspace.data.review")}
                </Button>
              </div>
            </div>
          )}
          {stageError && (
            <div className="shrink-0 mx-5 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {stageError}
            </div>
          )}
          {/* CodeMirror host — fills the remaining height. */}
          <div ref={editorRef} className="flex-1 min-h-0 overflow-hidden" />
        </>
      )}
        </div>
      </div>
    </div>
  );
}
