/**
 * WorkspaceFilePicker — modal for inserting workspace files into the chat
 * composer as attachments. Addresses the AK user complaint:
 *
 *   '프로젝트 내 챗에서 그냥 일반 챗이랑 너무 똑같이 보이면 어떻게 쓸지를
 *    모르겠음. 이 파일 구조를 보여주면서 파일을 쉽게 삽입하고 지정할 수
 *    있으면 좋겠음.'
 *
 * Strategy:
 *   - List the latest workspace snapshot's files (no new server API).
 *   - User can filter by typing.
 *   - Multi-select with checkboxes; the modal returns the selected file
 *     paths to the composer, which fetches each one's content via the
 *     existing GET /api/workspaces/:id/files/:path endpoint and converts
 *     them into composer attachments. Zero server changes.
 *
 * Why attachments (not a new `mentioned_files` payload field): the
 * existing chat-context pipeline already handles attachments cleanly
 * (parsed by file type, character-budgeted, prepended to the system
 * prompt). Routing workspace files through attachments inherits all of
 * that for free.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { useSnapshot } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Search, FileText, FileSpreadsheet, FileCode, File as FileIcon } from "lucide-react";

export interface WorkspaceFilePickerProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (paths: string[]) => void;
  /** Already-selected paths (so users can re-open the modal to add more). */
  initialSelected?: string[];
}

/** Tiny extension → icon map. Keeps the picker scannable without
 *  pulling a bigger filetype lib. */
function iconFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt"].includes(ext)) return FileText;
  if (["csv", "tsv", "xlsx"].includes(ext)) return FileSpreadsheet;
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "yaml", "yml", "json"].includes(ext)) return FileCode;
  return FileIcon;
}

export function WorkspaceFilePicker({
  workspaceId, open, onClose, onConfirm, initialSelected = [],
}: WorkspaceFilePickerProps) {
  const { t } = useT();
  const { data: snapshot } = useSnapshot(workspaceId, open);  // only fetch when open
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  // Reset selection when the modal reopens with a fresh initialSelected.
  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
  }, [open, initialSelected.join(",")]);  // eslint-disable-line react-hooks/exhaustive-deps

  const files = useMemo(() => {
    const list = snapshot?.files ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => f.path.toLowerCase().includes(q));
  }, [snapshot, query]);

  const toggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const confirm = () => {
    onConfirm(Array.from(selected));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("workspaceFilePicker.title")}
      description={t("workspaceFilePicker.subtitle", { n: String(snapshot?.files.length ?? 0) })}
      size="lg"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-surface-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("workspaceFilePicker.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* File list — virtualization not needed for the snapshot sizes we
            actually see in practice (<1000 files). */}
        <div className="max-h-[50vh] overflow-y-auto border border-border rounded">
          {!snapshot && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("workspaceFilePicker.notScanned")}
            </div>
          )}
          {snapshot && files.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("workspaceFilePicker.noMatch")}
            </div>
          )}
          {files.map((f) => {
            const Icon = iconFor(f.path);
            const isSelected = selected.has(f.path);
            return (
              <label
                key={f.path}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-3 ${
                  isSelected ? "bg-accent/10" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(f.path)}
                  className="accent-accent h-3.5 w-3.5"
                />
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate" title={f.path}>{f.path}</span>
                <span className="text-2xs text-muted-foreground">
                  {f.size != null ? `${Math.ceil(f.size / 1024)}kB` : ""}
                </span>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {t("workspaceFilePicker.selectedN", { n: String(selected.size) })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={selected.size === 0}
            >
              {t("workspaceFilePicker.insert", { n: String(selected.size) })}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
