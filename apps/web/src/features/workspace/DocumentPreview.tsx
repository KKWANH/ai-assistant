/**
 * DocumentPreview — modal showing the markitdown-extracted markdown for
 * a binary doc (PDF / DOCX / PPTX / XLSX / HWP).
 *
 * Opened from the Documents row in DataFilesView; renders the markdown
 * via the existing vendor-markdown chunk and offers a "PDF page
 * screenshot" jumper when the file is a PDF.
 */
import { useEffect, useState } from "react";
import { X, FileText, RefreshCw, Image as ImageIcon } from "lucide-react";
import { useT } from "../../lib/i18n";
import { Spinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";

interface ExtractResponse {
  markdown: string;
  source: "cache" | "markitdown" | "pymupdf" | "fallback";
  backend: "markitdown" | "pymupdf";
  hash: string;
  bytes: number;
  truncated: boolean;
}

type BackendChoice = "auto" | "markitdown" | "pymupdf";

interface PreviewProps {
  workspaceId: string;
  path: string;
  onClose: () => void;
}

export function DocumentPreview({ workspaceId, path, onClose }: PreviewProps) {
  const { t } = useT();
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // AZ — extractor backend selector. "auto" lets the server dispatch
  // (pymupdf for Korean PDFs, markitdown otherwise). Manual override
  // forces a re-extract bypassing cache.
  const [backend, setBackend] = useState<BackendChoice>("auto");
  const [available, setAvailable] = useState<{ pymupdf: boolean; markitdown: boolean } | null>(null);
  const isPdf = /\.pdf$/i.test(path);
  // Only for PDFs: "Show page N" jumper. Page rendered via the screenshot
  // endpoint; total pages comes from the response header.
  const [shotPage, setShotPage] = useState<number>(1);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [shotPages, setShotPages] = useState<number | null>(null);

  // Lock body scroll while open (mirrors other modal behaviour).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // AZ — fetch available backends once so the UI greys out unavailable
  // choices (e.g. pymupdf when not installed). Polled on first open.
  useEffect(() => {
    void fetch("/api/files/markitdown-status")
      .then((r) => r.json() as Promise<{ available: boolean; pymupdfAvailable?: boolean }>)
      .then((s) => setAvailable({ markitdown: !!s.available, pymupdf: !!s.pymupdfAvailable }))
      .catch(() => setAvailable({ markitdown: true, pymupdf: false }));
  }, []);

  const load = async (overrideBackend?: BackendChoice) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/files/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, path, backend: overrideBackend ?? backend }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string; hint?: string };
        throw new Error(body.hint ? `${body.error ?? res.statusText} — ${body.hint}` : body.error ?? res.statusText);
      }
      const json = (await res.json()) as ExtractResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, path]);

  // Re-load whenever the user picks a different backend.
  const handleBackendChange = (next: BackendChoice) => {
    setBackend(next);
    void load(next);
  };

  const loadScreenshot = async (page: number) => {
    if (!isPdf) return;
    try {
      const url = `/api/files/pdf-screenshot?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}&page=${page}&scale=2`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      const blob = await res.blob();
      const totalHeader = res.headers.get("X-Pdf-Total-Pages");
      if (totalHeader) setShotPages(parseInt(totalHeader, 10));
      // Replace previous object URL to avoid leaks.
      setShotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Revoke the object URL on unmount.
  useEffect(() => {
    return () => {
      if (shotUrl) URL.revokeObjectURL(shotUrl);
    };
  }, [shotUrl]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-card shadow-elevation-3 animate-modal-in overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-accent shrink-0" />
            <h2 className="text-sm font-mono text-foreground truncate" title={path}>
              {path}
            </h2>
            {data && (
              <span className="text-2xs text-muted-foreground shrink-0">
                {data.source}
                {data.source === "cache" && ` · ${data.backend}`}
                {" · "}{(data.bytes / 1024).toFixed(1)} KB
                {data.truncated && ` · ${t("workspace.documents.truncated") ?? "truncated"}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* AZ — backend chooser: only relevant for PDFs since pymupdf
                is PDF-only. Auto is the smart default; manual override
                forces a re-extract via the selected backend. */}
            {isPdf && available && available.pymupdf && (
              <select
                value={backend}
                onChange={(e) => handleBackendChange(e.target.value as BackendChoice)}
                title="Extractor backend"
                className="text-2xs px-2 py-1 rounded border border-border bg-surface-2 text-foreground"
              >
                <option value="auto">auto</option>
                <option value="markitdown" disabled={!available.markitdown}>markitdown</option>
                <option value="pymupdf">pymupdf (KR)</option>
              </select>
            )}
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              loading={busy}
              onClick={() => void load()}
              title={t("workspace.documents.reextract") ?? "Re-extract"}
            >
              {t("workspace.documents.reextract") ?? "Re-extract"}
            </Button>
            {isPdf && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<ImageIcon className="h-3.5 w-3.5" />}
                onClick={() => void loadScreenshot(shotPage)}
              >
                {t("workspace.documents.screenshot") ?? "Page screenshot"}
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {busy && !data && (
            <div className="flex items-center justify-center py-10">
              <Spinner size="md" label="Loading" />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-foreground">
              <p className="font-medium text-destructive mb-1">
                {t("workspace.documents.extractFailed") ?? "Extraction failed"}
              </p>
              <p className="text-muted-foreground break-words">{error}</p>
            </div>
          )}

          {isPdf && shotUrl && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-muted-foreground">
                  Page {shotPage}{shotPages != null && ` / ${shotPages}`}
                </span>
                {shotPages != null && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(1, shotPage - 1);
                        setShotPage(next);
                        void loadScreenshot(next);
                      }}
                      disabled={shotPage <= 1}
                      className="px-2 py-0.5 rounded border border-border bg-surface-2 hover:bg-surface-3 disabled:opacity-40 transition-colors"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.min(shotPages, shotPage + 1);
                        setShotPage(next);
                        void loadScreenshot(next);
                      }}
                      disabled={shotPage >= shotPages}
                      className="px-2 py-0.5 rounded border border-border bg-surface-2 hover:bg-surface-3 disabled:opacity-40 transition-colors"
                    >
                      →
                    </button>
                  </>
                )}
              </div>
              <img
                src={shotUrl}
                alt={`Page ${shotPage}`}
                className="w-full max-h-[60vh] object-contain border border-border rounded-md bg-white"
              />
            </div>
          )}

          {data && (
            <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed text-foreground">
              {data.markdown}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
