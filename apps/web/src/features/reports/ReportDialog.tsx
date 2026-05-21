/**
 * Report-a-problem dialog — any signed-in user can submit a bug report or a
 * suggestion. It lands in the admin review queue, is auto-triaged by the LLM,
 * and may then be filed as a GitHub issue by the maintainer.
 */
import { useState } from "react";
import type { ReportType } from "@ariadne/shared";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { Select } from "../../components/ui/Select";
import { useToast } from "../../components/ui/Toast";
import { useUIStore } from "../../lib/store";
import { useCreateReport } from "../../lib/queries";
import { useT } from "../../lib/i18n";

export function ReportDialog() {
  const { reportDialogOpen, setReportDialogOpen } = useUIStore();
  const { t } = useT();
  const { toast } = useToast();
  const createReport = useCreateReport();

  const [type, setType] = useState<ReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function close() {
    setReportDialogOpen(false);
  }

  const canSubmit =
    title.trim().length >= 3 && description.trim().length >= 10 && !createReport.isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      await createReport.mutateAsync({
        type,
        title: title.trim(),
        description: description.trim(),
      });
      toast({
        title: t("report.submitted"),
        description: t("report.submittedHint"),
        variant: "success",
      });
      setType("bug");
      setTitle("");
      setDescription("");
      close();
    } catch (e) {
      toast({
        title: t("report.submitError"),
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  }

  return (
    <Dialog
      open={reportDialogOpen}
      onClose={close}
      title={t("report.title")}
      description={t("report.subtitle")}
      size="md"
    >
      <div className="flex flex-col gap-3">
        <Select
          label={t("report.type")}
          value={type}
          onChange={(e) => setType(e.target.value as ReportType)}
          options={[
            { value: "bug", label: t("report.type.bug") },
            { value: "suggestion", label: t("report.type.suggestion") },
            { value: "other", label: t("report.type.other") },
          ]}
        />
        <Input
          label={t("report.titleField")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("report.titlePlaceholder")}
          maxLength={160}
        />
        <Textarea
          label={t("report.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("report.descriptionPlaceholder")}
          rows={6}
          maxLength={4000}
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("report.privacyNote")}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            loading={createReport.isPending}
          >
            {t("report.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
