/**
 * Code tab — a lightweight read-only file viewer for the active workspace.
 * Lists non-sensitive files; selecting one fetches its content and shows it in a
 * monospace pane, with a link to the full CodeMirror editor for highlighting +
 * editing. Sensitive files are never listed.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { useSnapshot, useWorkspaceFile } from "../../lib/queries";
import { useT } from "../../lib/i18n";

export function CodePane({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { data: snapshot } = useSnapshot(workspaceId);
  const [path, setPath] = useState<string | null>(null);
  const fileQuery = useWorkspaceFile(workspaceId, path ?? "");

  // ── List view ──────────────────────────────────────────────────────────
  if (!path) {
    const files = (snapshot?.files ?? []).filter((f) => !f.sensitive);
    if (files.length === 0) {
      return <div className="px-4 py-10 text-center text-xs text-muted-foreground">{t("sidePanel.code.empty")}</div>;
    }
    return (
      <div className="flex flex-col">
        {files.slice(0, 300).map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => setPath(f.path)}
            className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-foreground/5 border-b border-inspector-border/50"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{f.path}</span>
          </button>
        ))}
      </div>
    );
  }

  // ── Viewer ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-inspector-border">
        <button
          type="button"
          onClick={() => setPath(null)}
          className="p-1 rounded hover:bg-foreground/5 text-muted-foreground shrink-0"
          aria-label={t("sidePanel.code.back")}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-2xs font-mono text-foreground truncate flex-1">{path}</span>
        <Link
          to={`/workspaces/${workspaceId}/edit?path=${encodeURIComponent(path)}`}
          className="text-2xs text-muted-foreground hover:text-foreground shrink-0"
        >
          {t("sidePanel.code.open")}
        </Link>
      </div>
      <div className="flex-1 overflow-auto">
        {fileQuery.isLoading ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">…</div>
        ) : fileQuery.data ? (
          <pre className="text-2xs font-mono text-foreground whitespace-pre p-3 leading-relaxed">{fileQuery.data.content}</pre>
        ) : (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">{t("sidePanel.code.error")}</div>
        )}
      </div>
    </div>
  );
}
