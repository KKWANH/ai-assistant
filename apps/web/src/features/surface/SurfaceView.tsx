/**
 * SurfaceView — embeds a workspace's custom surface in a sandboxed iframe.
 *
 * Security model:
 *  - iframe: sandbox="allow-scripts" — no allow-same-origin, so the surface
 *    code cannot access parent cookies, DOM, or localStorage.
 *  - Communication: postMessage bridge only. The surface requests data via
 *    { source:"ariadne-surface", reqId, method, args } and this component
 *    responds with { source:"ariadne-host", reqId, ok, result?, error? }.
 *  - All actual API calls are made by THIS component (authenticated via
 *    the existing session cookie). The surface never touches /api directly.
 */
import { useEffect, useRef, useCallback } from "react";
import * as api from "../../lib/api";
import { useSurface } from "../../lib/queries";
import { useUIStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "../../components/ui/Card";

// ── postMessage types ─────────────────────────────────────────────────────────

interface SurfaceRequest {
  source: "ariadne-surface";
  reqId: string;
  method: string;
  args?: unknown[];
}

interface HostReply {
  source: "ariadne-host";
  reqId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// ── CSV parser (lightweight, RFC 4180-ish) ────────────────────────────────────

function parseCsv(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        out.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
    out.push(field);
    return out;
  };
  const headers = parseRow(lines[0]!);
  // Rows are objects keyed by header — the surface SDK contract.
  const rows = lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

// ── Bridge handler ────────────────────────────────────────────────────────────

async function handleBridgeRequest(
  workspaceId: string,
  req: SurfaceRequest
): Promise<unknown> {
  const { method, args = [] } = req;

  switch (method) {
    case "listFiles": {
      const snap = await api.getSnapshot(workspaceId);
      return snap.files.map((f) => ({
        path: f.path,
        size: f.size,
        extension: f.extension,
        estimatedTokens: f.estimatedTokens,
      }));
    }

    case "readText": {
      const [path] = args as [string];
      const res = await api.getWorkspaceFile(workspaceId, path);
      return res.content;
    }

    case "readCsv": {
      const [path] = args as [string];
      const res = await api.getWorkspaceFile(workspaceId, path);
      return parseCsv(res.content);
    }

    case "listTemplates": {
      return api.getTemplates();
    }

    case "listRuns": {
      return api.getRuns(workspaceId);
    }

    case "runTemplate": {
      const [templateId, input] = args as [string, Record<string, string>];
      return api.createRun({ workspaceId, templateId, input: input ?? {} });
    }

    case "stageFile": {
      // Stage a data-file edit from inside a surface. Same shape as the
      // Data tab's Save → stage flow; returns { runId, added, removed }
      // so the surface can render its own "Review & apply" CTA.
      const [path, content] = args as [string, string];
      if (typeof path !== "string" || typeof content !== "string") {
        throw new Error("stageFile: path and content must be strings");
      }
      return api.stageWorkspaceFile(workspaceId, path, content);
    }

    case "getRun": {
      const [runId] = args as [string];
      return api.getRun(runId);
    }

    case "getQuotes": {
      const [symbols] = args as [string[]];
      const res = await api.getQuotes(symbols ?? []);
      return res.quotes;
    }

    case "getQuotesDetailed": {
      const [symbols] = args as [string[]];
      const res = await api.getQuotesDetailed(symbols ?? []);
      return res;
    }

    case "getFxRates": {
      const [base, currencies] = args as [string, string[]];
      const res = await api.getFxRates(base ?? "USD", currencies ?? []);
      return res.rates;
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SurfaceViewProps {
  workspaceId: string;
}

export function SurfaceView({ workspaceId }: SurfaceViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { data: surfaceData, isLoading } = useSurface(workspaceId);
  const { theme } = useUIStore();
  const { t } = useT();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data as SurfaceRequest | undefined;
      if (!data || data.source !== "ariadne-surface") return;
      // Only accept messages from the iframe
      if (event.source !== iframeRef.current?.contentWindow) return;

      const { reqId } = data;

      handleBridgeRequest(workspaceId, data)
        .then((result) => {
          const reply: HostReply = {
            source: "ariadne-host",
            reqId,
            ok: true,
            result,
          };
          iframeRef.current?.contentWindow?.postMessage(reply, "*");
        })
        .catch((err: unknown) => {
          const reply: HostReply = {
            source: "ariadne-host",
            reqId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
          iframeRef.current?.contentWindow?.postMessage(reply, "*");
        });
    },
    [workspaceId]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 text-accent animate-spin" />
      </div>
    );
  }

  const state = surfaceData?.state;

  if (!state?.exists) {
    return (
      <Card className="flex items-center gap-3 px-5 py-6">
        <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">{t("surface.view.noSurface.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("surface.view.noSurface.bodyPrefix") && `${t("surface.view.noSurface.bodyPrefix")} `}
            <strong>{t("surface.view.editScreenTab")}</strong>{" "}
            {t("surface.view.noSurface.bodyMid")}{" "}
            <code className="font-mono">.ariadne/surface.tsx</code>
            {t("surface.view.noSurface.bodySuffix") ? ` ${t("surface.view.noSurface.bodySuffix")}` : ""}
          </p>
        </div>
      </Card>
    );
  }

  if (!state.built) {
    return (
      <Card className="flex items-center gap-3 px-5 py-6">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">{t("surface.view.notBuilt.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("surface.view.notBuilt.bodyPrefix")}{" "}
            <strong>{t("surface.view.editScreenTab")}</strong>{" "}
            {t("surface.view.notBuilt.bodyMid")}{" "}
            <strong>{t("surface.build")}</strong>{" "}
            {t("surface.view.notBuilt.bodySuffix")}
          </p>
          {state.buildError && (
            <pre className="mt-2 text-xs text-destructive font-mono bg-destructive/5 rounded px-2 py-1 overflow-x-auto max-w-lg whitespace-pre-wrap">
              {state.buildError}
            </pre>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: "0", flex: "1 1 0" }}>
      <iframe
        key={theme}
        ref={iframeRef}
        src={`/surface/${workspaceId}/host?theme=${theme}`}
        sandbox="allow-scripts"
        title={t("surface.view.iframeTitle")}
        className="w-full h-full border-0 bg-background"
        style={{ minHeight: "480px" }}
      />
    </div>
  );
}
