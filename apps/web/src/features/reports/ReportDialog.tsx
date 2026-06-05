/**
 * Report-a-problem dialog — any signed-in user can submit a bug report or a
 * suggestion, optionally with screenshots. It lands in the admin review queue,
 * is auto-triaged by the LLM, and may then be filed as a GitHub issue.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
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

interface PendingImage {
  name: string;
  mediaType: string;
  dataBase64: string;
  previewUrl: string;
}

const MAX_IMAGES = 6;

/** Read a file to a base64 string (data-URL prefix stripped). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ReportDialog() {
  const { reportDialogOpen, setReportDialogOpen } = useUIStore();
  const { t } = useT();
  const { toast } = useToast();
  const createReport = useCreateReport();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  function close() {
    images.forEach((im) => URL.revokeObjectURL(im.previewUrl));
    setType("bug");
    setTitle("");
    setDescription("");
    setImages([]);
    setError(null);
    setReportDialogOpen(false);
  }

  async function addFiles(files: FileList) {
    const next: PendingImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (images.length + next.length >= MAX_IMAGES) break;
      next.push({
        name: file.name,
        mediaType: file.type,
        dataBase64: await fileToBase64(file),
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length > 0) setImages((prev) => [...prev, ...next]);
  }

  // Drop an image anywhere while the report dialog is open to attach it — the
  // chat composer's window dropzone bails when a [role=dialog] is open, so the
  // modal owns drops here.
  useEffect(() => {
    if (!reportDialogOpen) return;
    const hasFiles = (dt: DataTransfer | null): boolean =>
      !!dt && Array.from(dt.types).includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDialogOpen]);

  function removeImage(i: number) {
    setImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(i, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function submit() {
    if (createReport.isPending) return;
    // Validate on submit (rather than silently disabling the button) so the
    // user always gets a clear reason when a report can't be sent.
    if (title.trim().length < 3 || description.trim().length < 10) {
      setError(t("report.validation"));
      return;
    }
    setError(null);
    try {
      await createReport.mutateAsync({
        type,
        title: title.trim(),
        description: description.trim(),
        attachments: images.map((im) => ({
          name: im.name,
          mediaType: im.mediaType,
          dataBase64: im.dataBase64,
        })),
      });
      toast({
        title: t("report.submitted"),
        description: t("report.submittedHint"),
        variant: "success",
      });
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
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          placeholder={t("report.titlePlaceholder")}
          maxLength={160}
        />
        <Textarea
          label={t("report.description")}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          placeholder={t("report.descriptionPlaceholder")}
          rows={6}
          maxLength={4000}
        />

        {/* Screenshots / image attachments */}
        <div className="flex flex-col gap-2">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((im, i) => (
                <div key={im.previewUrl} className="relative group">
                  <img
                    src={im.previewUrl}
                    alt={im.name}
                    className="h-16 w-16 rounded-lg border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={t("report.removeImage")}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 self-start rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {t("report.addImage")}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("report.privacyNote")}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={createReport.isPending}
            loading={createReport.isPending}
          >
            {t("report.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
