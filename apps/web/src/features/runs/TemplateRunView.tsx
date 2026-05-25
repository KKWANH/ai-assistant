import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Play, FileText, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { useTemplate, useCreateRun, useSettings, useWorkspace } from "../../lib/queries";
import { costOf } from "@ariadne/shared";
import { useT } from "../../lib/i18n";
import { templateName, templateDescription } from "../../lib/templateLabels";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useUIStore } from "../../lib/store";

/** Step indicator for the run flow: Step 1 of 3 */
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

export function TemplateRunView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { activeWorkspaceId, setActiveRunId } = useUIStore();
  const workspaceId = searchParams.get("workspaceId") ?? activeWorkspaceId ?? "";
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useT();
  const createRun = useCreateRun();

  const { data: template, isLoading } = useTemplate(id ?? "");
  const { data: settings } = useSettings();
  const { data: workspace } = useWorkspace(workspaceId);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (isLoading || !template) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) {
      toast({
        title: t("runs.template.noWorkspaceTitle"),
        description: t("runs.template.noWorkspaceDesc"),
        variant: "error",
      });
      return;
    }
    const resolvedInput: Record<string, string> = {};
    for (const inp of template.inputs) {
      resolvedInput[inp.key] = inputValues[inp.key] ?? inp.default ?? "";
    }
    try {
      const run = await createRun.mutateAsync({
        workspaceId,
        templateId: template.id,
        input: resolvedInput,
      });
      setActiveRunId(run.id);
      navigate(`/runs/${run.id}/context`);
    } catch (err) {
      toast({
        title: t("runs.template.failed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  const missingRequired = template.inputs
    .filter((inp) => inp.required && !inputValues[inp.key] && !inp.default)
    .map((inp) => inp.key);

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto h-full">
      {/* Step indicator + back nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {workspaceId && (
            <button
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {workspace?.name ?? t("common.back")}
            </button>
          )}
          <StepBadge step={1} total={3} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {t("runs.stepSetup")}
        </div>
      </div>

      {/* Context banner */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-2">
        <Play className="h-3.5 w-3.5 text-accent shrink-0" />
        <span className="text-xs text-muted-foreground">
          {workspace
            ? t("runs.youAreCreatingIn", { template: templateName(template, t), workspace: workspace.name })
            : t("runs.youAreCreating", { template: templateName(template, t) })}
        </span>
      </div>

      <PageHeader
        icon={<Play className="h-5 w-5" />}
        title={templateName(template, t)}
        description={templateDescription(template, t)}
      />

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 -mt-3">
        {template.builtin && (
          <Badge variant="default">{t("runs.template.builtIn")}</Badge>
        )}
        {template.evidenceRequired && (
          <Badge variant="supported">{t("runs.template.evidenceRequired")}</Badge>
        )}
        {template.unsupportedClaimsRequired && (
          <Badge variant="inferred">{t("runs.template.unsupportedTracked")}</Badge>
        )}
        {template.rerunDiffRequired && (
          <Badge variant="default">{t("runs.template.rerunDiff")}</Badge>
        )}
      </div>

      {/* Input form */}
      <form onSubmit={(e) => void handleRun(e)} className="flex flex-col gap-4">
        {template.inputs.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">
              {t("runs.template.inputs")}
            </h2>
            <div className="flex flex-col gap-3">
              {template.inputs.map((inp) => {
                const value = inputValues[inp.key] ?? "";
                const onChange = (v: string) =>
                  setInputValues((prev) => ({ ...prev, [inp.key]: v }));

                if (inp.type === "text") {
                  return (
                    <Textarea
                      key={inp.key}
                      label={inp.label}
                      placeholder={inp.placeholder}
                      required={inp.required}
                      value={value}
                      onChange={(e) => onChange(e.target.value)}
                    />
                  );
                }
                return (
                  <Input
                    key={inp.key}
                    label={inp.label}
                    placeholder={inp.placeholder}
                    required={inp.required}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                  />
                );
              })}
            </div>
          </section>
        ) : (
          <Card className="px-4 py-3 text-xs text-muted-foreground">
            {t("runs.template.noInputs")}
          </Card>
        )}

        {/* Output contract preview */}
        <section>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {t("runs.template.outputContract")}
          </button>
          {showAdvanced && (
            <Card className="px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {t("runs.template.expectedSections")}
              </p>
              <ul className="flex flex-col gap-1">
                {template.outputContract.sections.map((s) => (
                  <li
                    key={s}
                    className="text-xs text-foreground flex items-center gap-2"
                  >
                    <span className="h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        {/* Token estimate */}
        <Card className="px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground flex-1">
            {t("runs.template.tokenEstimate")}
            {settings && (
              <span className="font-mono ml-1">
                {" "}
                {(() => {
                  const est = 10_000;
                  const c = costOf(settings.model, est, Math.round(est * 0.3));
                  return c === 0
                    ? t("runs.template.costLocal")
                    : t("runs.template.costPer", { cost: `$${c.toFixed(4)}` });
                })()}
              </span>
            )}
          </span>
          <Badge variant="estimated">Estimated</Badge>
        </Card>

        {!workspaceId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warning/30 bg-warning/5 text-xs text-warning">
            {t("runs.template.noWorkspace")}
          </div>
        )}

        {/* Next step CTA */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t("runs.template.nextHint")}
          </p>
          <Button
            variant="primary"
            type="submit"
            size="md"
            loading={createRun.isPending}
            disabled={missingRequired.length > 0 || !workspaceId}
            leftIcon={<Play className="h-3.5 w-3.5" />}
          >
            {t("runs.template.runBtn")}
          </Button>
        </div>
      </form>
    </div>
  );
}
