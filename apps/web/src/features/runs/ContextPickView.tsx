import { useParams, useNavigate } from "react-router-dom";
import { AlertTriangle, FileText, ChevronRight, ShieldAlert, DollarSign, ArrowLeft, Play } from "lucide-react";
import { useRun, useRunContext, useConfirmContext, useSettings, useWorkspace } from "../../lib/queries";
import { costOf } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Badge } from "../../components/ui/Badge";
import { TokenEstimate } from "../../components/ui/TokenEstimate";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/layout/PageHeader";
import { useUIStore } from "../../lib/store";
import { useToast } from "../../components/ui/Toast";

/** Step indicator */
function StepBadge({ step, total }: { step: number; total: number }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={[
            "h-1.5 rounded-full transition-all",
            i < step
              ? "w-4 bg-accent"
              : i === step - 1
                ? "w-5 bg-accent"
                : "w-1.5 bg-border-strong",
          ].join(" ")}
        />
      ))}
      <span className="text-xs font-mono text-muted-foreground ml-1">
        {t("runs.step", { step, total })}
      </span>
    </div>
  );
}

export function ContextPickView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const { contextExcludes, contextIncludes, toggleContextExclude, toggleContextInclude, resetContextToggles } =
    useUIStore();
  const confirmContext = useConfirmContext();

  const { data: run } = useRun(id ?? "", { enabled: !!id });
  const { data: context, isLoading } = useRunContext(
    id ?? "",
    !!id
  );
  const { data: settings } = useSettings();
  const { data: workspace } = useWorkspace(run?.workspaceId ?? "");

  if (isLoading || !context) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">
          {t("runs.context.selecting")}
        </p>
      </div>
    );
  }

  const effectiveFiles = context.files.map((f) => ({
    ...f,
    included:
      contextIncludes.has(f.path)
        ? true
        : contextExcludes.has(f.path)
          ? false
          : f.included,
  }));

  const selectedFiles = effectiveFiles.filter((f) => f.included);
  const totalTokens = selectedFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);
  const sensitiveCount = selectedFiles.filter((f) => f.sensitive).length;
  const oversizedCount = context.skippedLarge.length;

  const handleContinue = async () => {
    try {
      resetContextToggles();
      await confirmContext.mutateAsync({
        runId: id!,
        selected: selectedFiles.map((f) => f.path),
      });
      navigate(`/runs/${id}`);
    } catch (err) {
      toast({
        title: t("runs.context.failed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto h-full">
      {/* Step indicator + back nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {run && (
            <button
              onClick={() => navigate(`/templates/${run.templateId}?workspaceId=${run.workspaceId}`)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("runs.context.backToSetup")}
            </button>
          )}
          <StepBadge step={2} total={3} />
        </div>
        {run && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <FileText className="h-3.5 w-3.5" />
            {run.id.slice(0, 8)}
          </div>
        )}
      </div>

      {/* Context banner */}
      {run && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-2">
          <Play className="h-3.5 w-3.5 text-accent shrink-0" />
          <span className="text-xs text-muted-foreground">
            {workspace
              ? t("runs.youAreCreatingIn", { template: run.templateName, workspace: workspace.name })
              : t("runs.youAreCreating", { template: run.templateName })}
          </span>
        </div>
      )}

      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title={t("runs.context.title")}
        description={t("runs.context.description")}
      />

      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border border-border bg-surface-2">
        <span className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{selectedFiles.length}</span>{" "}
          {t("runs.context.filesSelected", { n: selectedFiles.length })}
        </span>
        <span className="text-border-strong">|</span>
        <TokenEstimate tokens={totalTokens} />
        {settings && totalTokens > 0 && (
          <>
            <span className="text-border-strong">|</span>
            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              {(() => {
                const c = costOf(settings.model, totalTokens, Math.round(totalTokens * 0.3));
                return c === 0
                  ? t("runs.context.costLocal")
                  : t("runs.context.costEst", { cost: `$${c.toFixed(4)}` });
              })()}
            </span>
          </>
        )}
        {sensitiveCount > 0 && (
          <>
            <span className="text-border-strong">|</span>
            <span className="flex items-center gap-1 text-xs text-warning">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t("runs.context.sensitive", { n: sensitiveCount })}
            </span>
          </>
        )}
        {oversizedCount > 0 && (
          <>
            <span className="text-border-strong">|</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("runs.context.skipped", { n: oversizedCount })}
            </span>
          </>
        )}
      </div>

      {/* Warnings */}
      {sensitiveCount > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-warning/30 bg-warning/5">
          <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-warning">
              {t("runs.context.sensitiveWarning", {
                n: sensitiveCount,
                s: sensitiveCount > 1 ? "s" : "",
              })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("runs.context.sensitiveBody")}
            </p>
          </div>
        </div>
      )}

      {/* File list */}
      <section>
        <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
          {t("runs.context.candidateFiles")}
        </h2>
        <div className="flex flex-col gap-1">
          {effectiveFiles.map((f) => (
            <Card
              key={f.path}
              className="flex items-start gap-3 px-4 py-3"
              selected={f.included}
            >
              <Checkbox
                checked={f.included}
                onChange={() => {
                  if (f.included) {
                    toggleContextExclude(f.path);
                  } else {
                    toggleContextInclude(f.path);
                  }
                }}
                aria-label={f.included
                  ? t("runs.context.excludeFile", { path: f.path })
                  : t("runs.context.includeFile", { path: f.path })}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-foreground truncate">
                    {f.path}
                  </span>
                  {f.sensitive && <Badge variant="sensitive" dot>{t("badge.sensitive")}</Badge>}
                  {f.oversized && <Badge variant="large-file" dot>{t("badge.largeFile")}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {f.reason}
                </p>
              </div>
              <TokenEstimate
                tokens={f.estimatedTokens}
                className="shrink-0 mt-0.5"
              />
            </Card>
          ))}
        </div>
      </section>

      {/* Skipped files */}
      {context.skippedLarge.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t("runs.context.skippedTitle")}
          </h2>
          <div className="flex flex-col gap-1">
            {context.skippedLarge.map((path) => (
              <div
                key={path}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface-2 opacity-60"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-muted-foreground truncate">
                  {path}
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {t("runs.context.skippedNote")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Continue */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {selectedFiles.length === 0 ? (
            <span className="text-warning">{t("runs.context.selectAtLeast")}</span>
          ) : (
            t("runs.context.selectedCount", {
              n: selectedFiles.length,
              tokens: totalTokens.toLocaleString(),
            })
          )}
        </p>
        <Button
          variant="primary"
          size="md"
          loading={confirmContext.isPending}
          onClick={() => void handleContinue()}
          disabled={selectedFiles.length === 0}
        >
          {t("runs.context.generateOutput")}
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
