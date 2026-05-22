import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Terminal, Play, Plus, Save, FileCode } from "lucide-react";
import {
  useScripts,
  useScript,
  useSaveScript,
  useRunScript,
  useMe,
} from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import type { ScriptRunResult } from "@ariadne/shared";

export function ScriptsView() {
  const { id: workspaceId = "" } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const isRemote = me?.accessContext === "remote";
  const { t } = useT();

  const { data: scripts, isLoading } = useScripts(workspaceId);
  const saveScript = useSaveScript(workspaceId);
  const runScript = useRunScript(workspaceId);

  const [selectedScript, setSelectedScript] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [runResult, setRunResult] = useState<ScriptRunResult | null>(null);

  // New script dialog state
  const [newScriptOpen, setNewScriptOpen] = useState(false);
  const [newScriptName, setNewScriptName] = useState("");

  // Run confirmation dialog state
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [pendingRunName, setPendingRunName] = useState<string>("");

  const { toast } = useToast();

  // Load selected script content
  const { data: scriptContent } = useScript(workspaceId, selectedScript);

  useEffect(() => {
    if (scriptContent) {
      setEditorContent(scriptContent.content);
      setIsDirty(false);
    }
  }, [scriptContent]);

  const handleSelectScript = (name: string) => {
    setSelectedScript(name);
    setRunResult(null);
  };

  const handleSave = async () => {
    if (!selectedScript) return;
    try {
      await saveScript.mutateAsync({ name: selectedScript, content: editorContent });
      setIsDirty(false);
      toast({ title: t("scripts.saved"), variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("scripts.saveFailed");
      toast({ title: t("scripts.saveFailed"), description: msg, variant: "error" });
    }
  };

  const handleCreateScript = async () => {
    const name = newScriptName.trim();
    if (!name) return;
    const safeName = name.endsWith(".sh") ? name : `${name}.sh`;
    if (!/^[a-zA-Z0-9_\-]+\.sh$/.test(safeName)) {
      toast({ title: t("scripts.invalidName"), description: t("scripts.invalidNameDesc"), variant: "error" });
      return;
    }
    try {
      await saveScript.mutateAsync({ name: safeName, content: "#!/bin/bash\nset -e\n\n# Add your script here\n" });
      setNewScriptOpen(false);
      setNewScriptName("");
      setSelectedScript(safeName);
      toast({ title: t("scripts.created"), variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("scripts.createFailed");
      toast({ title: t("scripts.createFailed"), description: msg, variant: "error" });
    }
  };

  const handleRunConfirm = async () => {
    setRunConfirmOpen(false);
    if (!pendingRunName) return;
    setRunResult(null);
    try {
      const result = await runScript.mutateAsync(pendingRunName);
      setRunResult(result);
      if (result.timedOut) {
        toast({ title: t("scripts.timedOut"), variant: "error" });
      } else if (result.exitCode === 0) {
        toast({ title: t("scripts.completed"), variant: "success" });
      } else {
        toast({
          title: t("scripts.exitCode", { code: result.exitCode?.toString() ?? "null" }),
          variant: "error",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("scripts.runFailed");
      toast({ title: t("scripts.runFailed"), description: msg, variant: "error" });
    }
  };

  const handleRunRequest = (name: string) => {
    setPendingRunName(name);
    setRunConfirmOpen(true);
  };

  return (
    <div className="flex flex-col gap-5 p-5 max-w-4xl overflow-y-auto h-full">
      <PageHeader
        icon={<Terminal className="h-5 w-5" />}
        title={t("scripts.title")}
        description={
          <>
            {t("scripts.description", { path: ".ariadne/scripts/" })}
            {isRemote && (
              <span className="ml-2 text-warning">— {t("scripts.remoteNote")}</span>
            )}
          </>
        }
        action={
          !isRemote ? (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setNewScriptOpen(true)}
            >
              {t("scripts.newScript")}
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[400px]">
        {/* Script list */}
        <div className="w-48 shrink-0 flex flex-col gap-1">
          {isLoading ? (
            <p className="text-xs text-muted-foreground px-2">{t("common.loading")}</p>
          ) : scripts && scripts.length > 0 ? (
            scripts.map((s) => (
              <button
                key={s.name}
                className={[
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedScript === s.name
                    ? "bg-accent text-accent-foreground"
                    : "text-sidebar-foreground hover:bg-surface-3",
                ].join(" ")}
                onClick={() => handleSelectScript(s.name)}
              >
                <FileCode className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{s.name}</span>
              </button>
            ))
          ) : (
            <div className="rounded-lg border border-border border-dashed px-3 py-4 text-center">
              <p className="text-xs text-muted-foreground">{t("scripts.noScripts")}</p>
            </div>
          )}
        </div>

        {/* Editor + output */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {selectedScript ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-foreground flex-1">{selectedScript}</span>
                {isDirty && (
                  <span className="text-xs text-muted-foreground">{t("scripts.unsavedChanges")}</span>
                )}
                {!isRemote && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Save className="h-3.5 w-3.5" />}
                    disabled={!isDirty}
                    loading={saveScript.isPending}
                    onClick={() => void handleSave()}
                  >
                    {t("scripts.save")}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Play className="h-3.5 w-3.5" />}
                  loading={runScript.isPending}
                  onClick={() => handleRunRequest(selectedScript)}
                >
                  {t("common.run")}
                </Button>
              </div>

              {/* Code editor */}
              <Card className="flex-1 overflow-hidden p-0">
                <Textarea
                  className="w-full h-full resize-none font-mono text-xs bg-transparent border-0 rounded-xl p-3 focus-visible:ring-0"
                  value={editorContent}
                  onChange={(e) => {
                    setEditorContent(e.target.value);
                    setIsDirty(true);
                  }}
                  readOnly={isRemote}
                  spellCheck={false}
                />
              </Card>

              {/* Run output */}
              {runResult && (
                <Card className="p-3 font-mono text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{t("scripts.exitCodeLabel")}</span>
                    <span
                      className={
                        runResult.exitCode === 0
                          ? "text-success"
                          : "text-destructive"
                      }
                    >
                      {runResult.exitCode?.toString() ?? "null"}
                      {runResult.timedOut && " (timed out)"}
                    </span>
                  </div>
                  {runResult.stdout && (
                    <div>
                      <p className="text-muted-foreground mb-1">{t("scripts.stdout")}</p>
                      <pre className="whitespace-pre-wrap text-foreground bg-surface-2 rounded-md p-2 text-2xs max-h-40 overflow-y-auto">
                        {runResult.stdout}
                      </pre>
                    </div>
                  )}
                  {runResult.stderr && (
                    <div>
                      <p className="text-muted-foreground mb-1">{t("scripts.stderr")}</p>
                      <pre className="whitespace-pre-wrap text-warning bg-surface-2 rounded-md p-2 text-2xs max-h-40 overflow-y-auto">
                        {runResult.stderr}
                      </pre>
                    </div>
                  )}
                </Card>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center rounded-xl border border-border border-dashed">
              <div className="text-center">
                <Terminal className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t("scripts.selectPrompt")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Script Dialog */}
      <Dialog
        open={newScriptOpen}
        onClose={() => setNewScriptOpen(false)}
        title={t("scripts.newDialog.title")}
        description={t("scripts.newDialog.description")}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("scripts.newDialog.nameLabel")}{" "}
              <span className="text-foreground">{t("scripts.newDialog.nameHint")}</span>
            </label>
            <Input
              placeholder={t("scripts.newDialog.placeholder")}
              value={newScriptName}
              onChange={(e) => setNewScriptName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateScript(); }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setNewScriptOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saveScript.isPending}
              onClick={() => void handleCreateScript()}
            >
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Run Confirmation Dialog */}
      <Dialog
        open={runConfirmOpen}
        onClose={() => setRunConfirmOpen(false)}
        title={t("scripts.runDialog.title")}
        description={t("scripts.runDialog.description", { name: pendingRunName })}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("scripts.runDialog.body")}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRunConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              leftIcon={<Play className="h-3.5 w-3.5" />}
              onClick={() => void handleRunConfirm()}
            >
              {t("common.run")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
