/**
 * Right Inspector panel — context-aware metadata for the current route.
 * DESIGN_GUIDELINE §3.4: Workspace / Template / Context / Run details.
 */
import type { ReactNode } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { Info } from "lucide-react";
import {
  useWorkspace,
  useSnapshot,
  useTemplate,
  useRun,
  useRunContext,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Badge } from "../ui/Badge";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-inspector-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={[
          "text-foreground text-right break-all",
          mono ? "font-mono text-[11px]" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function Inspector() {
  const { pathname } = useLocation();
  const { t } = useT();

  const wsMatch = matchPath("/workspaces/:id", pathname);
  const tplMatch = matchPath("/templates/:id", pathname);
  const ctxMatch = matchPath("/runs/:id/context", pathname);
  const runMatch = matchPath("/runs/:id", pathname);

  const wsId = wsMatch?.params.id ?? "";
  const tplId = tplMatch?.params.id ?? "";
  const runId = runMatch?.params.id ?? ctxMatch?.params.id ?? "";

  // All hooks run unconditionally; `enabled` gates the actual fetch.
  const workspace = useWorkspace(wsId);
  const snapshot = useSnapshot(wsId);
  const template = useTemplate(tplId);
  const run = useRun(runId, { enabled: !!runId });
  const context = useRunContext(ctxMatch?.params.id ?? "", !!ctxMatch);

  let body: ReactNode = null;

  if (wsMatch && workspace.data) {
    const ws = workspace.data;
    const snap = snapshot.data;
    body = (
      <>
        <Section title={t("inspector.workspace")}>
          <Row label={t("inspector.row.name")} value={ws.name} />
          <Row label={t("inspector.row.rootPath")} value={ws.rootPath} mono />
          <Row label={t("inspector.row.files")} value={ws.fileCount} />
          <Row label={t("inspector.row.lastScan")} value={fmtDate(ws.lastScanAt)} />
        </Section>
        {snap && (
          <Section title={t("inspector.snapshot")}>
            <Row label={t("inspector.row.scannedFiles")} value={snap.fileCount} />
            <Row label={t("inspector.row.ignored")} value={snap.ignoredCount} />
            <Row
              label={t("inspector.row.sensitive")}
              value={
                snap.sensitiveCount > 0 ? (
                  <Badge variant="sensitive">{snap.sensitiveCount}</Badge>
                ) : (
                  0
                )
              }
            />
            <Row
              label={t("inspector.row.estTokens")}
              value={snap.totalEstimatedTokens.toLocaleString()}
              mono
            />
          </Section>
        )}
        <Section title={t("inspector.patterns")}>
          <Row label={t("inspector.row.include")} value={t("inspector.row.globs", { n: ws.include.length })} />
          <Row label={t("inspector.row.exclude")} value={t("inspector.row.globs", { n: ws.exclude.length })} />
        </Section>
      </>
    );
  } else if (tplMatch && template.data) {
    const tmpl = template.data;
    body = (
      <>
        <Section title={t("inspector.template")}>
          <Row label={t("inspector.row.name")} value={tmpl.name} />
          <Row label={t("inspector.row.inputs")} value={tmpl.inputs.length} />
          <Row
            label={t("inspector.row.evidence")}
            value={tmpl.evidenceRequired
              ? t("inspector.row.evidenceRequired")
              : t("inspector.row.evidenceOptional")}
          />
        </Section>
        <Section title={t("inspector.outputContract")}>
          {tmpl.outputContract.sections.map((s) => (
            <div key={s} className="text-xs font-mono text-foreground">
              {s}
            </div>
          ))}
        </Section>
      </>
    );
  } else if (ctxMatch && (context.data || run.data)) {
    const ctx = context.data;
    body = (
      <Section title={t("inspector.contextPick")}>
        {run.data && <Row label={t("inspector.run")} value={run.data.id} mono />}
        {ctx && <Row label={t("inspector.row.candidateFiles")} value={ctx.files.length} />}
        {ctx && (
          <Row
            label={t("inspector.row.estTokens")}
            value={ctx.totalTokens.toLocaleString()}
            mono
          />
        )}
        {ctx && ctx.skippedLarge.length > 0 && (
          <Row label={t("inspector.row.skippedLarge")} value={ctx.skippedLarge.length} />
        )}
      </Section>
    );
  } else if (runMatch && run.data) {
    const r = run.data;
    body = (
      <>
        <Section title={t("inspector.run")}>
          <Row label={t("inspector.row.id")} value={r.id} mono />
          <Row label={t("inspector.row.status")} value={<Badge variant={r.status} dot />} />
          <Row label={t("inspector.row.template")} value={r.templateName} />
          <Row label={t("inspector.row.model")} value={`${r.provider} · ${r.model}`} mono />
          <Row
            label={t("inspector.row.duration")}
            value={duration(r.startedAt, r.completedAt)}
            mono
          />
        </Section>
        <Section title={t("inspector.trace")}>
          <Row label={t("inspector.row.selectedFiles")} value={r.selectedFiles.length} />
          <Row label={t("inspector.row.evidenceClaims")} value={r.evidenceCount} />
          <Row
            label={t("inspector.row.unsupported")}
            value={
              r.unsupportedCount > 0 ? (
                <Badge variant="unsupported">{r.unsupportedCount}</Badge>
              ) : (
                0
              )
            }
          />
          <Row label={t("inspector.row.estTokens")} value={r.tokenEstimate.toLocaleString()} mono />
        </Section>
        {(r.artifacts.brief || r.artifacts.evidence) && (
          <Section title={t("inspector.artifacts")}>
            {r.artifacts.brief && <Row label={t("inspector.row.brief")} value={r.artifacts.brief} mono />}
            {r.artifacts.evidence && (
              <Row label={t("inspector.row.evidence")} value={r.artifacts.evidence} mono />
            )}
            {r.artifacts.diff && <Row label={t("inspector.row.diff")} value={r.artifacts.diff} mono />}
          </Section>
        )}
      </>
    );
  }

  return (
    <aside
      className="w-64 shrink-0 border-l border-inspector-border bg-inspector overflow-y-auto"
      aria-label={t("inspector.title")}
    >
      <div className="h-10 shrink-0 flex items-center px-3 border-b border-inspector-border">
        <span className="text-xs font-semibold text-foreground">{t("inspector.title")}</span>
      </div>
      {body ?? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <Info className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {t("inspector.empty")}
          </p>
        </div>
      )}
    </aside>
  );
}
