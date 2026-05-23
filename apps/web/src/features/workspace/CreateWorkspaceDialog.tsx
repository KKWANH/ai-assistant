import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileText, BarChart2, Wallet, BookOpen, Globe, Lock, ChefHat, Code2, ClipboardList, Microscope } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useCreateWorkspace } from "../../lib/queries";
import { useUIStore } from "../../lib/store";
import { useToast } from "../../components/ui/Toast";
import { useT } from "../../lib/i18n";
import { DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import { FolderPicker } from "./FolderPicker";
import type { WorkspaceVisibility } from "@ariadne/shared";

type Starter = "blank" | "portfolio" | "budget" | "reading" | "chefbook" | "code" | "decisions" | "papers";

/** Workspace templates shown in the picker — Blank plus ready-made example projects. */
const TEMPLATE_OPTIONS = [
  {
    id: "blank",
    icon: FileText,
    labelKey: "workspace.dialog.starterBlank",
    descKey: "workspace.dialog.starterBlankDesc",
  },
  {
    id: "portfolio",
    icon: BarChart2,
    labelKey: "workspace.dialog.starterPortfolio",
    descKey: "workspace.dialog.starterPortfolioDesc",
  },
  {
    id: "budget",
    icon: Wallet,
    labelKey: "workspace.dialog.starterBudget",
    descKey: "workspace.dialog.starterBudgetDesc",
  },
  {
    id: "reading",
    icon: BookOpen,
    labelKey: "workspace.dialog.starterReading",
    descKey: "workspace.dialog.starterReadingDesc",
  },
  {
    id: "chefbook",
    icon: ChefHat,
    labelKey: "workspace.dialog.starterChefbook",
    descKey: "workspace.dialog.starterChefbookDesc",
  },
  {
    id: "code",
    icon: Code2,
    labelKey: "workspace.dialog.starterCode",
    descKey: "workspace.dialog.starterCodeDesc",
  },
  {
    id: "decisions",
    icon: ClipboardList,
    labelKey: "workspace.dialog.starterDecisions",
    descKey: "workspace.dialog.starterDecisionsDesc",
  },
  {
    id: "papers",
    icon: Microscope,
    labelKey: "workspace.dialog.starterPapers",
    descKey: "workspace.dialog.starterPapersDesc",
  },
] as const;

export function CreateWorkspaceDialog() {
  const { createWorkspaceOpen, setCreateWorkspaceOpen, setActiveWorkspaceId } =
    useUIStore();
  const { toast } = useToast();
  const navigate = useNavigate();
  const mutation = useCreateWorkspace();
  const { t } = useT();

  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [include, setInclude] = useState(DEFAULT_INCLUDE.join("\n"));
  const [exclude, setExclude] = useState(DEFAULT_EXCLUDE.join("\n"));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [starter, setStarter] = useState<Starter>("blank");
  const [visibility, setVisibility] = useState<WorkspaceVisibility>("private");

  const errors: Record<string, string> = {};
  if (name.trim() === "") errors["name"] = t("workspace.dialog.nameRequired");
  if (rootPath.trim() === "") errors["rootPath"] = t("workspace.dialog.rootRequired");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(errors).length > 0) return;
    try {
      const ws = await mutation.mutateAsync({
        name: name.trim(),
        rootPath: rootPath.trim(),
        include: include.split("\n").filter(Boolean),
        exclude: exclude.split("\n").filter(Boolean),
        starter,
        visibility,
      });
      setCreateWorkspaceOpen(false);
      setActiveWorkspaceId(ws.id);
      navigate(`/workspaces/${ws.id}`);
      toast({ title: t("workspace.dialog.created"), variant: "success" });
      setName("");
      setRootPath("");
      setShowAdvanced(false);
      setStarter("blank");
      setVisibility("private");
    } catch (err) {
      toast({
        title: t("workspace.dialog.failed"),
        description: err instanceof Error ? err.message : t("common.unknown"),
        variant: "error",
      });
    }
  };

  return (
    <>
    <Dialog
      open={createWorkspaceOpen}
      onClose={() => setCreateWorkspaceOpen(false)}
      title={t("workspace.dialog.title")}
      description={t("workspace.dialog.description")}
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <Input
          label={t("workspace.dialog.nameLabel")}
          placeholder={t("workspace.dialog.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors["name"]}
          required
          autoFocus
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("workspace.dialog.rootLabel")}<span className="text-destructive ml-0.5">*</span>
          </label>
          <div className="flex items-stretch gap-2">
            <div className="flex-1">
              <Input
                placeholder={t("workspace.dialog.rootPlaceholder")}
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                leftElement={<FolderOpen className="h-3.5 w-3.5" />}
                className="font-mono text-xs"
              />
            </div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setFolderPickerOpen(true)}
            >
              {t("common.browse")}
            </Button>
          </div>
          {errors["rootPath"] && (
            <p className="text-xs text-destructive">{errors["rootPath"]}</p>
          )}
        </div>

        {/* Template choice */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("workspace.dialog.starterLabel")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATE_OPTIONS.map((tpl) => {
              const Icon = tpl.icon;
              const isSelected = starter === tpl.id;
              return (
                <Card
                  key={tpl.id}
                  interactive
                  selected={isSelected}
                  className="flex items-start gap-3 px-3 py-3 cursor-pointer"
                  onClick={() => setStarter(tpl.id)}
                >
                  <Icon
                    className={[
                      "h-4 w-4 shrink-0 mt-0.5",
                      isSelected ? "text-accent" : "text-muted-foreground",
                    ].join(" ")}
                  />
                  <div>
                    <p className="text-xs font-medium text-foreground">{t(tpl.labelKey)}</p>
                    <p className="text-2xs text-muted-foreground mt-0.5">{t(tpl.descKey)}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Visibility toggle */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("workspace.dialog.visibilityLabel")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Card
              interactive
              selected={visibility === "private"}
              className="flex items-start gap-3 px-3 py-3 cursor-pointer"
              onClick={() => setVisibility("private")}
            >
              <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-foreground">{t("workspace.visibility.private")}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {t("workspace.dialog.visibilityPrivateDesc")}
                </p>
              </div>
            </Card>
            <Card
              interactive
              selected={visibility === "public"}
              className="flex items-start gap-3 px-3 py-3 cursor-pointer"
              onClick={() => setVisibility("public")}
            >
              <Globe className="h-4 w-4 text-accent shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-foreground">{t("workspace.visibility.public")}</p>
                <p className="text-2xs text-muted-foreground mt-0.5">
                  {t("workspace.dialog.visibilityPublicDesc")}
                </p>
              </div>
            </Card>
          </div>
        </div>

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground text-left transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "▾" : "▸"} {t("workspace.dialog.patternsToggle")}
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("workspace.dialog.includeLabel")}
              </label>
              <p className="text-2xs leading-snug text-muted-foreground/80">
                {t("workspace.dialog.includeHelp")}
              </p>
              <textarea
                className="h-24 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-mono text-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={include}
                onChange={(e) => setInclude(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("workspace.dialog.excludeLabel")}
              </label>
              <p className="text-2xs leading-snug text-muted-foreground/80">
                {t("workspace.dialog.excludeHelp")}
              </p>
              <textarea
                className="h-24 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-mono text-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={exclude}
                onChange={(e) => setExclude(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            type="button"
            onClick={() => setCreateWorkspaceOpen(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={mutation.isPending}
            disabled={Object.keys(errors).length > 0}
          >
            {t("workspace.dialog.createBtn")}
          </Button>
        </div>
      </form>
    </Dialog>
    <FolderPicker
      open={folderPickerOpen}
      onClose={() => setFolderPickerOpen(false)}
      initialPath={rootPath.trim() || undefined}
      onSelect={(p) => {
        setRootPath(p);
        // Pre-fill the workspace name from the folder's basename.
        if (name.trim() === "") {
          const base = p.split("/").filter(Boolean).pop();
          if (base) setName(base);
        }
      }}
    />
    </>
  );
}
