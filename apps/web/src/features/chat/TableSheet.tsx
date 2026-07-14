/**
 * TableSheet — a CSV-backed table grid.
 *
 * Read-only by default; `editable` turns every cell into an input and adds
 * row / column add + delete controls. Row 0 is the header.
 *
 * TableEditorModal wraps an editable TableSheet in a wide portal modal — the
 * chat composer uses it to edit a pending table attachment before sending.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { useT } from "../../lib/i18n";
import { parseCsv, toCsv, normalizeGrid } from "../../lib/tableData";

/** Cap on rendered rows — keeps a huge sheet from freezing the browser.
 *  Rows beyond the cap stay in the data, they are just not rendered. */
const MAX_ROWS = 500;

export function TableSheet({
  rows,
  editable = false,
  onChange,
}: {
  rows: string[][];
  editable?: boolean;
  onChange?: (rows: string[][]) => void;
}) {
  const { t } = useT();
  const grid = rows.length > 0 ? rows : [[""]];
  const header = grid[0] ?? [""];
  const body = grid.slice(1);
  const shownBody = body.slice(0, MAX_ROWS);
  const truncated = body.length > MAX_ROWS;

  const emit = (next: string[][]) => onChange?.(next);
  const setCell = (r: number, c: number, val: string) => {
    const next = grid.map((row) => row.slice());
    const target = next[r];
    if (target) target[c] = val;
    emit(next);
  };
  const addRow = () => emit([...grid, header.map(() => "")]);
  const deleteRow = (r: number) => emit(grid.filter((_, i) => i !== r));
  const addCol = () => emit(grid.map((row) => [...row, ""]));
  const deleteCol = (c: number) => emit(grid.map((row) => row.filter((_, i) => i !== c)));

  const inputCls =
    "w-full min-w-[7rem] max-w-[18rem] bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:bg-accent/10";

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-auto border border-border rounded-lg">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              {editable && <th className="w-8 bg-surface-3 border border-border" />}
              {header.map((h, c) => (
                <th key={c} className="bg-surface-3 border border-border">
                  <div className="flex items-center">
                    {editable ? (
                      <input
                        className={inputCls + " font-semibold"}
                        value={h}
                        onChange={(e) => setCell(0, c, e.target.value)}
                      />
                    ) : (
                      <span className="block min-w-[7rem] px-2 py-1 font-semibold">{h}</span>
                    )}
                    {editable && header.length > 1 && (
                      <button
                        type="button"
                        className="px-1 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteCol(c)}
                        aria-label={t("table.deleteColumn")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              {editable && (
                <th className="bg-surface-3 border border-border px-1">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={addCol}
                    aria-label={t("table.addColumn")}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shownBody.map((row, ri) => {
              const r = ri + 1;
              return (
                <tr key={r}>
                  {editable && (
                    <td className="w-8 border border-border text-center">
                      <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteRow(r)}
                        aria-label={t("table.deleteRow")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                  {header.map((_, c) => (
                    <td key={c} className="border border-border align-top">
                      {editable ? (
                        <input
                          className={inputCls}
                          value={row[c] ?? ""}
                          onChange={(e) => setCell(r, c, e.target.value)}
                        />
                      ) : (
                        <span className="block min-w-[7rem] px-2 py-1 text-foreground/90">
                          {row[c] ?? ""}
                        </span>
                      )}
                    </td>
                  ))}
                  {editable && <td className="border border-border" />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {truncated && (
        <p className="text-2xs text-muted-foreground">
          {t("table.truncated", { shown: MAX_ROWS, total: body.length })}
        </p>
      )}

      {editable && (
        <button
          type="button"
          className="self-start flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={addRow}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("table.addRow")}
        </button>
      )}
    </div>
  );
}

export function TableEditorModal({
  title,
  initialCsv,
  onSave,
  onClose,
}: {
  title: string;
  initialCsv: string;
  onSave: (csv: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [grid, setGrid] = useState<string[][]>(() => normalizeGrid(parseCsv(initialCsv)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[min(95vw,1100px)] flex-col overflow-hidden rounded-xl border border-border bg-card/85 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.1] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-4">
          <TableSheet rows={grid} editable onChange={setGrid} />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-3"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(toCsv(grid));
              onClose();
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
          >
            {t("table.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
