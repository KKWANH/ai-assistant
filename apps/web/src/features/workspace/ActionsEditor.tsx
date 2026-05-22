/**
 * ActionsEditor — visual block editor for workspace custom actions.
 *
 * Custom actions are agent tools defined per workspace. Instead of hand-writing
 * `.ariadne/actions.yaml`, the user assembles colour-coded blocks: pick a type,
 * fill a few fields, snap new blocks in between. Blocks serialise to YAML and
 * save through the existing endpoint; a read-only YAML preview shows the result.
 *
 * Remote users get 403 on save → auto read-only.
 */
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Zap,
  Save,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Lock,
  AlertCircle,
  Terminal,
  FileText,
  Search,
  Sparkles,
  Code2,
  Play,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { WorkspaceAction, ActionType } from "@ariadne/shared";
import type { TranslationKey } from "../../lib/i18n/en";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { useActions, useSaveActions, useRunAction } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

// ── Per-type metadata ─────────────────────────────────────────────────────────

interface TypeMeta {
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  field: "script" | "path" | "query" | "template";
  fieldLabelKey: TranslationKey;
  fieldPlaceholder: string;
  icon: LucideIcon;
  strip: string;
  chip: string;
}

const TYPE_META: Record<ActionType, TypeMeta> = {
  run_script: {
    labelKey: "actions.type.run_script",
    hintKey: "actions.type.run_script.hint",
    field: "script",
    fieldLabelKey: "actions.field.script",
    fieldPlaceholder: "build-report.sh",
    icon: Terminal,
    strip: "bg-warning",
    chip: "border-warning/40 bg-warning/15 text-warning",
  },
  read_file: {
    labelKey: "actions.type.read_file",
    hintKey: "actions.type.read_file.hint",
    field: "path",
    fieldLabelKey: "actions.field.path",
    fieldPlaceholder: "data/notes.md",
    icon: FileText,
    strip: "bg-info",
    chip: "border-info/40 bg-info/15 text-info",
  },
  web_search: {
    labelKey: "actions.type.web_search",
    hintKey: "actions.type.web_search.hint",
    field: "query",
    fieldLabelKey: "actions.field.query",
    fieldPlaceholder: "latest pricing for …",
    icon: Search,
    strip: "bg-success",
    chip: "border-success/40 bg-success/15 text-success",
  },
  format: {
    labelKey: "actions.type.format",
    hintKey: "actions.type.format.hint",
    field: "template",
    fieldLabelKey: "actions.field.template",
    fieldPlaceholder: "## Summary\n- bullet points",
    icon: Sparkles,
    strip: "bg-accent",
    chip: "border-accent/40 bg-accent/15 text-accent",
  },
};

const ACTION_TYPES: ActionType[] = ["run_script", "read_file", "web_search", "format"];

// ── YAML serialiser ────────────────────────────────────────────────────────────
// actions.yaml is a fixed, shallow structure with string-only values, so a
// double-quoted scalar (with \n / \" / \\ escapes) round-trips safely through
// the server's YAML parser — no YAML library needed on the client.

function yamlScalar(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t") +
    '"'
  );
}

function serializeActions(actions: WorkspaceAction[]): string {
  if (actions.length === 0) return "actions: []\n";
  const lines: string[] = ["actions:"];
  for (const a of actions) {
    lines.push("  - id: " + yamlScalar(a.id));
    lines.push("    name: " + yamlScalar(a.name));
    lines.push("    description: " + yamlScalar(a.description));
    lines.push("    type: " + yamlScalar(a.type));
    if (a.script) lines.push("    script: " + yamlScalar(a.script));
    if (a.path) lines.push("    path: " + yamlScalar(a.path));
    if (a.query) lines.push("    query: " + yamlScalar(a.query));
    if (a.template) lines.push("    template: " + yamlScalar(a.template));
    if (a.constraints) lines.push("    constraints: " + yamlScalar(a.constraints));
  }
  return lines.join("\n") + "\n";
}

const inputCls =
  "w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs text-foreground " +
  "placeholder:text-muted-foreground focus:outline-none focus:border-border-strong " +
  "focus:ring-1 focus:ring-ring transition-colors";

// ── Field row ──────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// ── Type picker menu ───────────────────────────────────────────────────────────

function TypeMenu({
  onPick,
  onClose,
  align = "left",
}: {
  onPick: (t: ActionType) => void;
  onClose: () => void;
  align?: "left" | "center";
}) {
  const { t } = useT();
  const pos = align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div className={`absolute ${pos} top-full mt-1 z-40 w-64 rounded-lg border border-border bg-card shadow-lg py-1`}>
        {ACTION_TYPES.map((ty) => {
          const m = TYPE_META[ty];
          const Icon = m.icon;
          return (
            <button
              key={ty}
              type="button"
              className="w-full flex items-start gap-2.5 px-3 py-1.5 text-left hover:bg-surface-3 transition-colors"
              onClick={() => {
                onPick(ty);
                onClose();
              }}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${m.chip}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-foreground">{t(m.labelKey)}</span>
                <span className="text-[11px] text-muted-foreground leading-snug">{t(m.hintKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── Insert bar — snap a new block in between ───────────────────────────────────

function InsertBar({ onInsert }: { onInsert: (t: ActionType) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center justify-center py-1">
      <div className="absolute inset-x-6 top-1/2 h-px bg-border" />
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("actions.insertAction")}
          title={t("actions.insertAction")}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border bg-background text-muted-foreground hover:text-accent hover:border-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
        </button>
        {open && <TypeMenu align="center" onPick={onInsert} onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}

// ── A single action block ──────────────────────────────────────────────────────

function ActionBlock({
  action,
  index,
  total,
  readOnly,
  invalid,
  runDisabled,
  onChange,
  onChangeType,
  onRemove,
  onMove,
  onRun,
}: {
  action: WorkspaceAction;
  index: number;
  total: number;
  readOnly: boolean;
  invalid: boolean;
  runDisabled: boolean;
  onChange: (patch: Partial<WorkspaceAction>) => void;
  onChangeType: (t: ActionType) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onRun: () => void;
}) {
  const { t } = useT();
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const meta = TYPE_META[action.type];
  const Icon = meta.icon;
  const typeFieldValue = (action[meta.field] ?? "") as string;

  function setTypeField(value: string) {
    const patch: Partial<WorkspaceAction> = {};
    patch[meta.field] = value;
    onChange(patch);
  }

  return (
    <div
      className={[
        "relative flex rounded-xl border bg-surface-1 overflow-hidden",
        invalid ? "border-destructive/50" : "border-border",
      ].join(" ")}
    >
      {/* Colour strip */}
      <div className={`w-1.5 shrink-0 ${meta.strip}`} />
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-2.5">
        {/* Header: type chip + name + controls */}
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setTypeMenuOpen((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border ${meta.chip} disabled:opacity-60`}
            >
              <Icon className="h-3 w-3" />
              {t(meta.labelKey)}
              <ChevronsUpDown className="h-3 w-3 opacity-70" />
            </button>
            {typeMenuOpen && (
              <TypeMenu onPick={(ty) => onChangeType(ty)} onClose={() => setTypeMenuOpen(false)} />
            )}
          </div>
          <input
            className={`${inputCls} flex-1 font-medium`}
            value={action.name}
            placeholder={t("actions.namePlaceholder")}
            disabled={readOnly}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <div className="flex items-center gap-0.5 shrink-0">
            <IconButton
              label={t("actions.run")}
              size="xs"
              disabled={runDisabled}
              onClick={onRun}
            >
              <Play className="h-3.5 w-3.5 text-accent" />
            </IconButton>
            <IconButton
              label={t("actions.moveUp")}
              size="xs"
              disabled={readOnly || index === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label={t("actions.moveDown")}
              size="xs"
              disabled={readOnly || index === total - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={t("actions.remove")} size="xs" disabled={readOnly} onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>

        {/* ID + description */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
          <div className="sm:w-44 shrink-0">
            <Field label={t("actions.field.id")} hint={t("actions.field.idHint")}>
              <input
                className={`${inputCls} font-mono`}
                value={action.id}
                disabled={readOnly}
                onChange={(e) => onChange({ id: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex-1 min-w-0">
            <Field label={t("actions.field.description")}>
              <input
                className={inputCls}
                value={action.description}
                placeholder={t("actions.descPlaceholder")}
                disabled={readOnly}
                onChange={(e) => onChange({ description: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/* Type-specific field */}
        <Field label={t(meta.fieldLabelKey)} hint={t(meta.hintKey)}>
          {action.type === "format" ? (
            <textarea
              rows={2}
              className={`${inputCls} font-mono resize-y`}
              value={typeFieldValue}
              placeholder={meta.fieldPlaceholder}
              disabled={readOnly}
              onChange={(e) => setTypeField(e.target.value)}
            />
          ) : (
            <input
              className={`${inputCls} font-mono`}
              value={typeFieldValue}
              placeholder={meta.fieldPlaceholder}
              disabled={readOnly}
              onChange={(e) => setTypeField(e.target.value)}
            />
          )}
        </Field>

        {/* Constraints */}
        <Field label={t("actions.field.constraints")}>
          <input
            className={inputCls}
            value={action.constraints ?? ""}
            placeholder={t("actions.constraintsPlaceholder")}
            disabled={readOnly}
            onChange={(e) => onChange({ constraints: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

// ── Add-action button (opens the type menu) ────────────────────────────────────

function AddActionButton({ onAdd }: { onAdd: (t: ActionType) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-accent hover:border-accent transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("actions.addAction")}
      </button>
      {open && <TypeMenu onPick={onAdd} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onAdd, readOnly }: { onAdd: (t: ActionType) => void; readOnly: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 flex flex-col items-center gap-3 text-center">
      <Zap className="h-7 w-7 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">{t("actions.empty.title")}</p>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">{t("actions.empty.body")}</p>
      </div>
      {!readOnly && (
        <div className="relative">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setOpen((v) => !v)}
          >
            {t("actions.addAction")}
          </Button>
          {open && <TypeMenu align="center" onPick={onAdd} onClose={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface ActionsEditorProps {
  workspaceId: string;
}

export function ActionsEditor({ workspaceId }: ActionsEditorProps) {
  const { t } = useT();
  const { toast } = useToast();
  const { data: actionsData, isLoading } = useActions(workspaceId);
  const saveActions = useSaveActions(workspaceId);
  const runAction = useRunAction();
  const navigate = useNavigate();

  const [blocks, setBlocks] = useState<WorkspaceAction[]>([]);
  const [dirty, setDirty] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);
  const initedRef = useRef(false);

  // Initialise the block list once, when the workspace's actions first load.
  useEffect(() => {
    if (!initedRef.current && actionsData) {
      setBlocks(actionsData.actions);
      setParseError(actionsData.error);
      initedRef.current = true;
    }
  }, [actionsData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {t("actions.loading")}
      </div>
    );
  }

  function commit(next: WorkspaceAction[]) {
    setBlocks(next);
    setDirty(true);
  }

  function updateBlock(i: number, patch: Partial<WorkspaceAction>) {
    commit(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function changeType(i: number, type: ActionType) {
    // Drop type-specific fields when switching type; keep constraints.
    commit(
      blocks.map((b, j) =>
        j === i
          ? { id: b.id, name: b.name, description: b.description, type, constraints: b.constraints }
          : b,
      ),
    );
  }

  function removeBlock(i: number) {
    commit(blocks.filter((_, j) => j !== i));
  }

  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    commit(next);
  }

  function insertBlock(index: number, type: ActionType) {
    const ids = new Set(blocks.map((b) => b.id));
    let n = blocks.length + 1;
    let id = "action_" + String(n);
    while (ids.has(id)) {
      n += 1;
      id = "action_" + String(n);
    }
    const fresh: WorkspaceAction = { id, name: t("actions.newActionName"), description: "", type };
    const next = [...blocks];
    next.splice(index, 0, fresh);
    commit(next);
  }

  async function handleSave() {
    try {
      const result = await saveActions.mutateAsync(serializeActions(blocks));
      setBlocks(result.actions);
      setParseError(result.error);
      setDirty(false);
      toast({ title: t("actions.saved"), variant: "success" });
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 403) {
        setReadOnly(true);
        toast({ title: t("actions.saveFailed"), description: t("surface.readOnlyNote"), variant: "error" });
      } else {
        toast({ title: t("actions.saveFailed"), description: e.message, variant: "error" });
      }
    }
  }

  async function handleRun(action: WorkspaceAction) {
    try {
      const run = await runAction.mutateAsync({ workspaceId, actionId: action.id });
      navigate(`/runs/${run.id}`);
    } catch (err) {
      const e = err as Error;
      toast({ title: t("actions.runFailed"), description: e.message, variant: "error" });
    }
  }

  const invalid = new Set<number>();
  blocks.forEach((b, i) => {
    if (!b.id.trim() || !b.name.trim()) invalid.add(i);
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Zap className="h-4 w-4 text-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t("actions.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("actions.description")}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {readOnly && (
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <Lock className="h-3.5 w-3.5" />
            {t("surface.readOnly")}
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Code2 className="h-3.5 w-3.5" />}
          onClick={() => setShowYaml((v) => !v)}
        >
          {showYaml ? t("actions.hideYaml") : t("actions.showYaml")}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">{t("surface.unsavedChanges")}</span>}
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Save className="h-3.5 w-3.5" />}
          loading={saveActions.isPending}
          disabled={readOnly || !dirty}
          onClick={() => void handleSave()}
        >
          {t("actions.save")}
        </Button>
      </div>

      {/* Parse error from a previously hand-edited file */}
      {parseError && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-destructive/30 bg-destructive/5">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-destructive">{t("actions.parseError")}</p>
            <p className="mt-0.5 text-xs text-destructive/80 whitespace-pre-wrap break-words">
              {parseError}
            </p>
          </div>
        </div>
      )}

      {/* Blocks */}
      {blocks.length === 0 ? (
        <EmptyState onAdd={(ty) => insertBlock(0, ty)} readOnly={readOnly} />
      ) : (
        <div className="flex flex-col">
          <InsertBar onInsert={(ty) => insertBlock(0, ty)} />
          {blocks.map((b, i) => (
            <div key={i}>
              <ActionBlock
                action={b}
                index={i}
                total={blocks.length}
                readOnly={readOnly}
                invalid={invalid.has(i)}
                runDisabled={invalid.has(i) || dirty || runAction.isPending}
                onChange={(patch) => updateBlock(i, patch)}
                onChangeType={(ty) => changeType(i, ty)}
                onRemove={() => removeBlock(i)}
                onMove={(dir) => moveBlock(i, dir)}
                onRun={() => void handleRun(b)}
              />
              <InsertBar onInsert={(ty) => insertBlock(i + 1, ty)} />
            </div>
          ))}
        </div>
      )}

      {/* Add action */}
      {blocks.length > 0 && !readOnly && (
        <AddActionButton onAdd={(ty) => insertBlock(blocks.length, ty)} />
      )}

      {/* Read-only YAML preview */}
      {showYaml && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-surface-2 border-b border-border text-[11px] font-mono text-muted-foreground">
            .ariadne/actions.yaml · {t("actions.yamlReadonly")}
          </div>
          <pre className="p-3 text-xs font-mono text-foreground bg-surface-1 overflow-x-auto whitespace-pre">
            {serializeActions(blocks)}
          </pre>
        </div>
      )}
    </div>
  );
}
