/**
 * Report review queue — admin only. The maintainer reviews user-submitted
 * reports (each carries an LLM auto-triage verdict) and either files one as a
 * GitHub issue or rejects it. Filing opens a pre-filled GitHub "new issue"
 * page — the issue is created by the admin on GitHub, never by the app.
 */
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Flag, ExternalLink, Check, X, Sparkles } from "lucide-react";
import type { Report, ReportType, ReportStatus } from "@ariadne/shared";
import { useMe, useReports, useDecideReport } from "../../lib/queries";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { useT, type TranslationKey } from "../../lib/i18n";

const STATUS_ORDER: ReportStatus[] = ["pending", "filed", "rejected"];

const STATUS_LABEL: Record<ReportStatus, TranslationKey> = {
  pending: "reports.status.pending",
  filed: "reports.status.filed",
  rejected: "reports.status.rejected",
};

const TYPE_LABEL: Record<ReportType, TranslationKey> = {
  bug: "report.type.bug",
  suggestion: "report.type.suggestion",
  other: "report.type.other",
};

const VERDICT_LABEL: Record<string, TranslationKey> = {
  file: "reports.verdict.file",
  review: "reports.verdict.review",
  discard: "reports.verdict.discard",
};

/** Verdict → text colour token. */
function verdictTone(verdict: string): string {
  if (verdict === "file") return "text-success";
  if (verdict === "discard") return "text-muted-foreground";
  return "text-warning";
}

export function ReportsQueueView() {
  const { data: me } = useMe();
  const { t } = useT();
  const { toast } = useToast();
  const [status, setStatus] = useState<ReportStatus>("pending");
  const { data: reports } = useReports(status);
  const decide = useDecideReport();

  if (me && me.account.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  async function act(report: Report, decision: "file" | "reject") {
    try {
      const updated = await decide.mutateAsync({ id: report.id, decision });
      if (decision === "file" && updated.githubUrl) {
        window.open(updated.githubUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast({
        title: t("reports.decideError"),
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  }

  const list = reports ?? [];

  return (
    <div className="flex flex-col gap-4 p-5 sm:p-6 w-full max-w-4xl mx-auto h-full overflow-y-auto">
      <PageHeader
        icon={<Flag className="h-5 w-5" />}
        title={t("reports.title")}
        description={t("reports.subtitle")}
      />

      <div className="flex gap-1.5">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={[
              "px-3 py-1 rounded-md text-xs font-medium transition-colors",
              status === s
                ? "bg-surface-3 text-foreground"
                : "text-muted-foreground hover:bg-surface-2",
            ].join(" ")}
          >
            {t(STATUS_LABEL[s])}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {t("reports.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((r) => (
            <ReportCard key={r.id} report={r} busy={decide.isPending} onAct={act} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  busy,
  onAct,
}: {
  report: Report;
  busy: boolean;
  onAct: (r: Report, decision: "file" | "reject") => void;
}) {
  const { t } = useT();
  const triage = report.triage;

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(TYPE_LABEL[report.type])}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground mt-0.5">{report.title}</h3>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 text-right">
          {report.createdByName ?? ""}
          <br />
          {new Date(report.createdAt).toLocaleString()}
        </span>
      </div>

      {/* Body */}
      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {report.description}
      </p>

      {/* Attachments — screenshots the reporter included */}
      {report.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {report.attachments.map((att) => (
            <a
              key={att.id}
              href={`/api/uploads/${att.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={`/api/uploads/${att.id}`}
                alt={att.name}
                className="h-20 w-20 rounded-lg border border-border object-cover transition-opacity hover:opacity-80"
              />
            </a>
          ))}
        </div>
      )}

      {/* Auto-triage */}
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
          <Sparkles className="h-3 w-3" />
          {t("reports.triage")}
        </div>
        {triage ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={"text-xs font-semibold " + verdictTone(triage.verdict)}>
                {t(VERDICT_LABEL[triage.verdict] ?? "reports.verdict.review")}
              </span>
              {triage.category && (
                <span className="text-[11px] text-muted-foreground">· {triage.category}</span>
              )}
            </div>
            {triage.reason && (
              <p className="text-xs text-muted-foreground leading-relaxed">{triage.reason}</p>
            )}
            {triage.suggestedTitle && (
              <p className="text-xs text-foreground/80">
                <span className="text-muted-foreground">{t("reports.suggestedTitle")}: </span>
                {triage.suggestedTitle}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("reports.triaging")}</p>
        )}
      </div>

      {/* Actions */}
      {report.status === "pending" ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => onAct(report, "reject")}
          >
            {t("reports.reject")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Check className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => onAct(report, "file")}
          >
            {t("reports.fileIssue")}
          </Button>
        </div>
      ) : report.status === "filed" && report.githubUrl ? (
        <a
          href={report.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-end inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("reports.viewOnGithub")}
        </a>
      ) : null}
    </div>
  );
}
