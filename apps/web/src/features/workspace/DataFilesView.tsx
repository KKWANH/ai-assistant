/**
 * DataFilesView — browse and edit a workspace's CSV data files as tables.
 *
 * Lists the CSV files from the latest snapshot; the selected file is loaded,
 * parsed into a grid and rendered in an editable TableSheet. Saving serialises
 * the grid back to CSV via the workspace file-write API (local access only).
 */
import { useEffect, useMemo, useState } from "react";
import { Database, FileSpreadsheet, Save } from "lucide-react";
import {
  useSnapshot,
  useScanWorkspace,
  useWorkspaceFile,
  useSaveWorkspaceFile,
  useMe,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { TableSheet } from "../chat/TableSheet";
import { parseCsv, toCsv, normalizeGrid } from "../../lib/tableData";

export function DataFilesView({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { data: me } = useMe();
  const isRemote = me?.accessContext === "remote";

  const { data: snapshot } = useSnapshot(workspaceId);
  const scan = useScanWorkspace();
  const saveFile = useSaveWorkspaceFile(workspaceId);

  const dataFiles = useMemo(
    () =>
      (snapshot?.files ?? [])
        .map((f) => f.path)
        .filter((p) => /\.csv$/i.test(p))
        .sort((a, b) => a.localeCompare(b)),
    [snapshot],
  );

  const [selected, setSelected] = useState("");
  const activePath = dataFiles.includes(selected) ? selected : "";
  const { data: fileData } = useWorkspaceFile(workspaceId, activePath);

  const [grid, setGrid] = useState<string[][]>([]);
  const [dirty, setDirty] = useState(false);

  // Keep the selection valid: pick the first file initially, and re-pick if a
  // re-scan removed the selected file.
  useEffect(() => {
    if (dataFiles.length > 0 && !dataFiles.includes(selected)) {
      setSelected(dataFiles[0]!);
    }
  }, [dataFiles, selected]);

  // Re-parse whenever a different file's content arrives.
  useEffect(() => {
    if (fileData) {
      setGrid(normalizeGrid(parseCsv(fileData.content)));
      setDirty(false);
    }
  }, [fileData]);

  const handleScan = async () => {
    try {
      await scan.mutateAsync(workspaceId);
      toast({ title: t("workspace.scanComplete"), variant: "success" });
    } catch {
      toast({ title: t("workspace.scanFailed"), variant: "error" });
    }
  };

  const handleSave = async () => {
    if (!activePath) return;
    try {
      await saveFile.mutateAsync({ path: activePath, content: toCsv(grid) });
      setDirty(false);
      toast({ title: t("workspace.data.saved"), variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("workspace.data.saveFailed");
      toast({ title: t("workspace.data.saveFailed"), description: msg, variant: "error" });
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-0.5">
          <Database className="h-4 w-4 text-accent" />
          {t("workspace.data.heading")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("workspace.data.description")}
          {isRemote && (
            <span className="ml-1 text-warning">— {t("workspace.data.readOnly")}</span>
          )}
        </p>
      </div>

      {!snapshot ? (
        <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">{t("workspace.data.scanPrompt")}</p>
          <Button
            variant="secondary"
            size="sm"
            loading={scan.isPending}
            onClick={() => void handleScan()}
          >
            {t("workspace.scanFiles")}
          </Button>
        </div>
      ) : dataFiles.length === 0 ? (
        <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{t("workspace.data.empty")}</p>
        </div>
      ) : (
        <>
          {/* File picker */}
          <div className="flex flex-wrap gap-1.5">
            {dataFiles.map((path) => (
              <button
                key={path}
                onClick={() => setSelected(path)}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  path === activePath
                    ? "bg-accent text-accent-foreground"
                    : "bg-surface-3 text-foreground hover:bg-surface-2",
                ].join(" ")}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                {path}
              </button>
            ))}
          </div>

          {/* Toolbar + table */}
          {activePath && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-foreground flex-1 truncate">
                  {activePath}
                </span>
                {dirty && !isRemote && (
                  <span className="text-xs text-muted-foreground">
                    {t("workspace.data.unsaved")}
                  </span>
                )}
                {!isRemote && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Save className="h-3.5 w-3.5" />}
                    disabled={!dirty}
                    loading={saveFile.isPending}
                    onClick={() => void handleSave()}
                  >
                    {t("common.save")}
                  </Button>
                )}
              </div>
              {fileData ? (
                <TableSheet
                  rows={grid}
                  editable={!isRemote}
                  onChange={(next) => {
                    setGrid(next);
                    setDirty(true);
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
