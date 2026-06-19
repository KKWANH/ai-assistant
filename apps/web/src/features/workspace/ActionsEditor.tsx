/**
 * ActionsEditor — pipeline builder for workspace actions.
 *
 * Each action is an ordered pipeline of blocks (ask AI, web analysis, run
 * script, read file); block N's output feeds block N+1. The user assembles
 * blocks per action; everything serialises to `.ariadne/actions.yaml` and
 * saves through the existing endpoint. Remote users get 403 on save →
 * auto read-only.
 */
import { useState, useEffect, useRef } from "react";
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
  Sparkles,
  Search,
  Terminal,
  FileText,
  FilePlus,
  FileEdit,
  TestTube,
  Play,
  Code2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ActionDef, ActionBlock, ActionInput, BlockType } from "@ariadne/shared";
import type { TranslationKey } from "../../lib/i18n/en";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Dialog } from "../../components/ui/Dialog";
import { useActionDefs, useSaveActions, useRunAction } from "../../lib/queries";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";

// ── Per-block-type metadata ────────────────────────────────────────────────────

interface BlockMeta {
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  /** The single config key this block edits. */
  field: string;
  fieldLabelKey: TranslationKey;
  placeholder: string;
  multiline: boolean;
  icon: LucideIcon;
  strip: string;
  chip: string;
}

const BLOCK_META: Record<BlockType, BlockMeta> = {
  ask_ai: {
    labelKey: "actions.type.ask_ai",
    hintKey: "actions.type.ask_ai.hint",
    field: "prompt",
    fieldLabelKey: "actions.field.prompt",
    placeholder: "이전 단계 결과를 3줄로 요약해줘",
    multiline: true,
    icon: Sparkles,
    strip: "bg-accent",
    chip: "border-accent/40 bg-accent/15 text-accent",
  },
  web_analysis: {
    labelKey: "actions.type.web_analysis",
    hintKey: "actions.type.web_analysis.hint",
    field: "query",
    fieldLabelKey: "actions.field.query",
    placeholder: "latest pricing for …",
    multiline: false,
    icon: Search,
    strip: "bg-success",
    chip: "border-success/40 bg-success/15 text-success",
  },
  run_script: {
    labelKey: "actions.type.run_script",
    hintKey: "actions.type.run_script.hint",
    field: "script",
    fieldLabelKey: "actions.field.script",
    placeholder: "build-report.sh",
    multiline: false,
    icon: Terminal,
    strip: "bg-warning",
    chip: "border-warning/40 bg-warning/15 text-warning",
  },
  read_file: {
    labelKey: "actions.type.read_file",
    hintKey: "actions.type.read_file.hint",
    field: "path",
    fieldLabelKey: "actions.field.path",
    placeholder: "data/notes.md",
    multiline: false,
    icon: FileText,
    strip: "bg-info",
    chip: "border-info/40 bg-info/15 text-info",
  },
  write_file: {
    labelKey: "actions.type.write_file",
    hintKey: "actions.type.write_file.hint",
    // Primary field is the path — the body comes from the previous
    // block's output by default. Mode (append / replace) is set via
    // raw YAML for now to keep the v1 picker uncluttered.
    field: "path",
    fieldLabelKey: "actions.field.path",
    placeholder: "briefs/{date}.md",
    multiline: false,
    icon: FilePlus,
    strip: "bg-success",
    chip: "border-success/40 bg-success/15 text-success",
  },
  edit_file: {
    labelKey: "actions.type.edit_file",
    hintKey: "actions.type.edit_file.hint",
    // Primary field is the path; search/replace/content go via raw YAML
    // for v1 since the picker only models one text input per block.
    field: "path",
    fieldLabelKey: "actions.field.path",
    placeholder: "src/foo.ts",
    multiline: false,
    icon: FileEdit,
    strip: "bg-accent",
    chip: "border-accent/40 bg-accent/15 text-accent",
  },
  run_tests: {
    labelKey: "actions.type.run_tests",
    hintKey: "actions.type.run_tests.hint",
    field: "command",
    fieldLabelKey: "actions.field.command",
    placeholder: "npm test",
    multiline: false,
    icon: TestTube,
    strip: "bg-warning",
    chip: "border-warning/40 bg-warning/15 text-warning",
  },
};

const BLOCK_TYPES: BlockType[] = [
  "ask_ai", "web_analysis", "run_script", "read_file",
  "write_file", "edit_file", "run_tests",
];

// ── YAML serialiser ────────────────────────────────────────────────────────────
// actions.yaml is a shallow, string-only structure, so a double-quoted scalar
// (with \n / \" / \\ escapes) round-trips safely through the server's parser.

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

function serializeActionDefs(actions: ActionDef[]): string {
  if (actions.length === 0) return "actions: []\n";
  const lines: string[] = ["actions:"];
  for (const a of actions) {
    lines.push("  - id: " + yamlScalar(a.id));
    lines.push("    name: " + yamlScalar(a.name));
    lines.push("    description: " + yamlScalar(a.description));
    if (a.category) lines.push("    category: " + yamlScalar(a.category));
    // Serialize declared inputs BEFORE blocks (the empty-blocks branch below
    // `continue`s, which would otherwise skip them).
    if (a.inputs && a.inputs.length > 0) {
      lines.push("    inputs:");
      for (const inp of a.inputs) {
        lines.push("      - key: " + yamlScalar(inp.key));
        lines.push("        type: " + yamlScalar(inp.type));
        lines.push("        label: " + yamlScalar(inp.label));
        lines.push("        required: " + (inp.required ? "true" : "false"));
        if (inp.default != null) lines.push("        default: " + yamlScalar(inp.default));
        if (inp.placeholder != null) lines.push("        placeholder: " + yamlScalar(inp.placeholder));
      }
    }
    if (a.blocks.length === 0) {
      lines.push("    blocks: []");
      continue;
    }
    lines.push("    blocks:");
    for (const b of a.blocks) {
      lines.push("      - type: " + yamlScalar(b.type));
      const keys = Object.keys(b.config);
      if (keys.length === 0) {
        lines.push("        config: {}");
      } else {
        lines.push("        config:");
        for (const k of keys) {
          lines.push("          " + k + ": " + yamlScalar(b.config[k] ?? ""));
        }
      }
    }
  }
  return lines.join("\n") + "\n";
}

let blockSeq = 0;
function freshBlock(type: BlockType): ActionBlock {
  blockSeq += 1;
  return { id: `b${Date.now().toString(36)}${blockSeq.toString(36)}`, type, config: {} };
}

const inputCls =
  "w-full bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs text-foreground " +
  "placeholder:text-muted-foreground focus:outline-none focus:border-border-strong " +
  "focus:ring-1 focus:ring-ring transition-colors";

// ── Block-type picker menu ─────────────────────────────────────────────────────

function BlockTypeMenu({
  onPick,
  onClose,
  align = "left",
}: {
  onPick: (t: BlockType) => void;
  onClose: () => void;
  align?: "left" | "center";
}) {
  const { t } = useT();
  const pos = align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div className={`absolute ${pos} top-full mt-1 z-40 w-64 rounded-lg border border-border bg-card shadow-lg py-1`}>
        {BLOCK_TYPES.map((ty) => {
          const m = BLOCK_META[ty];
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
                <span className="text-2xs text-muted-foreground leading-snug">{t(m.hintKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── A single block row inside an action's pipeline ─────────────────────────────

function BlockRow({
  block,
  index,
  total,
  readOnly,
  onChangeType,
  onChangeConfig,
  onMove,
  onRemove,
}: {
  block: ActionBlock;
  index: number;
  total: number;
  readOnly: boolean;
  onChangeType: (t: BlockType) => void;
  onChangeConfig: (key: string, value: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = BLOCK_META[block.type];
  const Icon = meta.icon;
  const value = block.config[meta.field] ?? "";

  return (
    <div className="flex rounded-lg border border-border bg-surface-1 overflow-hidden">
      <div className={`w-1 shrink-0 ${meta.strip}`} />
      <div className="flex-1 min-w-0 p-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-muted-foreground shrink-0">
            {(index + 1).toString()}
          </span>
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setMenuOpen((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-semibold border ${meta.chip} disabled:opacity-60`}
            >
              <Icon className="h-3 w-3" />
              {t(meta.labelKey)}
              <ChevronsUpDown className="h-3 w-3 opacity-70" />
            </button>
            {menuOpen && (
              <BlockTypeMenu onPick={onChangeType} onClose={() => setMenuOpen(false)} />
            )}
          </div>
          <span className="text-2xs text-muted-foreground truncate flex-1">
            {t(meta.hintKey)}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
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
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-semibold text-foreground">{t(meta.fieldLabelKey)}</span>
          {meta.multiline ? (
            <textarea
              rows={2}
              className={`${inputCls} resize-y`}
              value={value}
              placeholder={meta.placeholder}
              disabled={readOnly}
              onChange={(e) => onChangeConfig(meta.field, e.target.value)}
            />
          ) : (
            <input
              className={`${inputCls} font-mono`}
              value={value}
              placeholder={meta.placeholder}
              disabled={readOnly}
              onChange={(e) => onChangeConfig(meta.field, e.target.value)}
            />
          )}
        </label>
      </div>
    </div>
  );
}

// ── Add-block button ───────────────────────────────────────────────────────────

function AddBlockButton({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-dashed border-border text-2xs font-medium text-muted-foreground hover:text-accent hover:border-accent transition-colors"
      >
        <Plus className="h-3 w-3" />
        {t("actions.addBlock")}
      </button>
      {open && <BlockTypeMenu onPick={onAdd} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── A single action card (name + description + block pipeline) ─────────────────

function ActionCard({
  action,
  readOnly,
  invalid,
  running,
  onChange,
  onRemove,
  onRun,
  onBlocksChange,
}: {
  action: ActionDef;
  readOnly: boolean;
  invalid: boolean;
  running: boolean;
  onChange: (patch: Partial<ActionDef>) => void;
  onRemove: () => void;
  onRun: () => void;
  onBlocksChange: (blocks: ActionBlock[]) => void;
}) {
  const { t } = useT();

  function setBlock(i: number, next: ActionBlock) {
    onBlocksChange(action.blocks.map((b, j) => (j === i ? next : b)));
  }
  function changeType(i: number, type: BlockType) {
    setBlock(i, { ...action.blocks[i]!, type, config: {} });
  }
  function changeConfig(i: number, key: string, value: string) {
    const b = action.blocks[i]!;
    setBlock(i, { ...b, config: { ...b.config, [key]: value } });
  }
  function moveBlock(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= action.blocks.length) return;
    const next = [...action.blocks];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onBlocksChange(next);
  }
  function removeBlock(i: number) {
    onBlocksChange(action.blocks.filter((_, j) => j !== i));
  }
  function addBlock(type: BlockType) {
    onBlocksChange([...action.blocks, freshBlock(type)]);
  }

  const inputs = action.inputs ?? [];
  function setInput(k: number, patch: Partial<ActionInput>) {
    onChange({ inputs: inputs.map((inp, j) => (j === k ? { ...inp, ...patch } : inp)) });
  }
  function removeInput(k: number) {
    onChange({ inputs: inputs.filter((_, j) => j !== k) });
  }
  function addInput() {
    onChange({ inputs: [...inputs, { key: "", type: "string", label: "", required: false }] });
  }

  return (
    <div
      className={[
        "rounded-xl border bg-surface-1 p-3.5 flex flex-col gap-3",
        invalid ? "border-destructive/50" : "border-border",
      ].join(" ")}
    >
      {/* Action header */}
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-accent shrink-0" />
        <input
          className={`${inputCls} flex-1 font-medium`}
          value={action.name}
          placeholder={t("actions.namePlaceholder")}
          disabled={readOnly}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <IconButton
          label={t("actions.run")}
          size="sm"
          disabled={running}
          onClick={onRun}
        >
          <Play className="h-4 w-4 text-accent" />
        </IconButton>
        <IconButton
          label={t("actions.deleteAction")}
          size="sm"
          disabled={readOnly}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      <input
        className={inputCls}
        value={action.description}
        placeholder={t("actions.descPlaceholder")}
        disabled={readOnly}
        onChange={(e) => onChange({ description: e.target.value })}
      />

      {/* Declared inputs — prompted for on run, interpolated as {{key}}. */}
      <div className="flex flex-col gap-1.5 pl-1 border-l-2 border-border">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground pl-2">
          {t("actions.inputs")}
        </span>
        <div className="flex flex-col gap-1.5 pl-2">
          {inputs.map((inp, k) => (
            <div key={k} className="flex items-center gap-1.5">
              <input
                className={`${inputCls} w-24 font-mono`}
                value={inp.key}
                placeholder="key"
                disabled={readOnly}
                onChange={(e) => setInput(k, { key: e.target.value })}
              />
              <select
                className={`${inputCls} w-20 shrink-0`}
                value={inp.type}
                disabled={readOnly}
                title={t("actions.inputType")}
                onChange={(e) => setInput(k, { type: e.target.value === "text" ? "text" : "string" })}
              >
                <option value="string">{t("actions.inputTypeLine")}</option>
                <option value="text">{t("actions.inputTypeMulti")}</option>
              </select>
              <input
                className={`${inputCls} flex-1`}
                value={inp.label}
                placeholder={t("actions.inputLabel")}
                disabled={readOnly}
                onChange={(e) => setInput(k, { label: e.target.value })}
              />
              <input
                className={`${inputCls} w-28`}
                value={inp.default ?? ""}
                placeholder={t("actions.inputDefault")}
                disabled={readOnly}
                onChange={(e) => setInput(k, { default: e.target.value })}
              />
              <label className="flex items-center gap-1 text-2xs text-muted-foreground shrink-0 select-none">
                <input
                  type="checkbox"
                  checked={inp.required}
                  disabled={readOnly}
                  onChange={(e) => setInput(k, { required: e.target.checked })}
                />
                {t("actions.inputRequired")}
              </label>
              <IconButton label={t("actions.removeInput")} size="sm" disabled={readOnly} onClick={() => removeInput(k)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          <Button variant="ghost" size="sm" disabled={readOnly} onClick={addInput} className="self-start">
            + {t("actions.addInput")}
          </Button>
        </div>
      </div>

      {/* Block pipeline */}
      <div className="flex flex-col gap-1.5 pl-1 border-l-2 border-border">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground pl-2">
          {t("actions.blockPipeline")}
        </span>
        <div className="flex flex-col gap-1.5 pl-2">
          {action.blocks.length === 0 ? (
            <p className="text-2xs text-muted-foreground">{t("actions.noBlocks")}</p>
          ) : (
            action.blocks.map((b, i) => (
              <BlockRow
                key={b.id}
                block={b}
                index={i}
                total={action.blocks.length}
                readOnly={readOnly}
                onChangeType={(ty) => changeType(i, ty)}
                onChangeConfig={(k, v) => changeConfig(i, k, v)}
                onMove={(dir) => moveBlock(i, dir)}
                onRemove={() => removeBlock(i)}
              />
            ))
          )}
          {!readOnly && <AddBlockButton onAdd={addBlock} />}
        </div>
      </div>
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
  const navigate = useNavigate();
  const { data: defs, isLoading } = useActionDefs(workspaceId);
  const saveActions = useSaveActions(workspaceId);
  const runAction = useRunAction();

  const [actions, setActions] = useState<ActionDef[]>([]);
  const [dirty, setDirty] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);
  const [runForm, setRunForm] = useState<ActionDef | null>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    if (!initedRef.current && defs) {
      setActions(defs.actions);
      setParseError(defs.error);
      initedRef.current = true;
    }
  }, [defs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {t("actions.loading")}
      </div>
    );
  }

  function commit(next: ActionDef[]) {
    setActions(next);
    setDirty(true);
  }

  function updateAction(i: number, patch: Partial<ActionDef>) {
    commit(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }
  function setBlocks(i: number, blocks: ActionBlock[]) {
    commit(actions.map((a, j) => (j === i ? { ...a, blocks } : a)));
  }
  function removeAction(i: number) {
    commit(actions.filter((_, j) => j !== i));
  }
  function addAction() {
    const ids = new Set(actions.map((a) => a.id));
    let n = actions.length + 1;
    let id = "action-" + n.toString();
    while (ids.has(id)) {
      n += 1;
      id = "action-" + n.toString();
    }
    commit([
      ...actions,
      { id, name: t("actions.newActionName"), description: "", category: "", blocks: [freshBlock("ask_ai")] },
    ]);
  }

  async function handleSave() {
    try {
      await saveActions.mutateAsync(serializeActionDefs(actions));
      setDirty(false);
      setParseError(null);
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

  function handleRun(action: ActionDef) {
    if (dirty) {
      toast({ title: t("actions.saveBeforeRun"), variant: "error" });
      return;
    }
    // Declared inputs → prompt for them first; otherwise run straight away.
    if (action.inputs && action.inputs.length > 0) {
      setRunForm(action);
      return;
    }
    void doRun(action, {});
  }

  async function doRun(action: ActionDef, input: Record<string, string>) {
    setRunForm(null);
    try {
      const run = await runAction.mutateAsync({ workspaceId, actionId: action.id, input });
      navigate(`/runs/${run.id}`);
    } catch (err) {
      toast({ title: t("actions.runFailed"), description: (err as Error).message, variant: "error" });
    }
  }

  const invalid = new Set<number>();
  actions.forEach((a, i) => {
    if (!a.id.trim() || !a.name.trim()) invalid.add(i);
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

      {/* Parse error from a hand-edited file */}
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

      {/* Action cards */}
      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 flex flex-col items-center gap-3 text-center">
          <Zap className="h-7 w-7 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("actions.empty.title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">{t("actions.empty.body")}</p>
          </div>
          {!readOnly && (
            <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addAction}>
              {t("actions.addAction")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {actions.map((a, i) => (
            <ActionCard
              key={a.id}
              action={a}
              readOnly={readOnly}
              invalid={invalid.has(i)}
              running={runAction.isPending}
              onChange={(patch) => updateAction(i, patch)}
              onRemove={() => removeAction(i)}
              onRun={() => void handleRun(a)}
              onBlocksChange={(blocks) => setBlocks(i, blocks)}
            />
          ))}
        </div>
      )}

      {/* Add action */}
      {actions.length > 0 && !readOnly && (
        <div className="self-start">
          <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addAction}>
            {t("actions.addAction")}
          </Button>
        </div>
      )}

      {/* Read-only YAML preview */}
      {showYaml && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-1.5 bg-surface-2 border-b border-border text-2xs font-mono text-muted-foreground">
            .ariadne/actions.yaml · {t("actions.yamlReadonly")}
          </div>
          <pre className="p-3 text-xs font-mono text-foreground bg-surface-1 overflow-x-auto whitespace-pre">
            {serializeActionDefs(actions)}
          </pre>
        </div>
      )}

      {runForm && (
        <ActionRunDialog
          action={runForm}
          pending={runAction.isPending}
          onClose={() => setRunForm(null)}
          onRun={(input) => void doRun(runForm, input)}
        />
      )}
    </div>
  );
}

/** Prompt for an action's declared inputs before running it. Pre-fills
 *  defaults, blocks submit until required fields are filled, then runs. */
function ActionRunDialog({
  action,
  pending,
  onClose,
  onRun,
}: {
  action: ActionDef;
  pending: boolean;
  onClose: () => void;
  onRun: (input: Record<string, string>) => void;
}) {
  const { t } = useT();
  const inputs: ActionInput[] = action.inputs ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const inp of inputs) init[inp.key] = inp.default ?? "";
    return init;
  });
  const missingRequired = inputs.some((i) => i.required && !(values[i.key] ?? "").trim());
  return (
    <Dialog open onClose={onClose} title={action.name}>
      <div className="flex flex-col gap-3">
        {action.description && (
          <p className="text-xs text-muted-foreground">{action.description}</p>
        )}
        {inputs.map((inp) => (
          <label key={inp.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground">
              {inp.label}
              {inp.required && <span className="text-destructive"> *</span>}
            </span>
            {inp.type === "text" ? (
              <textarea
                className={`${inputCls} resize-y min-h-[64px]`}
                value={values[inp.key] ?? ""}
                placeholder={inp.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
              />
            ) : (
              <input
                className={inputCls}
                value={values[inp.key] ?? ""}
                placeholder={inp.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
              />
            )}
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            disabled={missingRequired}
            onClick={() => onRun(values)}
          >
            {t("actions.run")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
