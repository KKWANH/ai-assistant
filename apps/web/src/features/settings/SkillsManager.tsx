/**
 * SkillsManager — inline CRUD for skills. Kept small on purpose: a list with
 * edit-in-place and a single 'add' row at the bottom. No modal, no separate
 * page.
 *
 * Scope: with no `workspaceId` it manages the account-global skills (and shows
 * the read-only built-ins), as in the global Settings view. With a
 * `workspaceId` it manages ONLY that workspace's own scoped skills — the
 * global + built-in skills are still usable there, just managed elsewhere.
 */
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Skill } from "@ariadne/shared";
import { useSkills, useCreateSkill, useUpdateSkill, useDeleteSkill } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { useToast } from "../../components/ui/Toast";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Textarea";

export function SkillsManager({ workspaceId }: { workspaceId?: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { data: skills } = useSkills(workspaceId);
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const remove = useDeleteSkill();

  // Workspace scope manages only its own skills; global scope shows everything
  // the account list returns (account-global skills + read-only built-ins).
  const visible = workspaceId
    ? (skills ?? []).filter((s) => s.workspaceId === workspaceId)
    : (skills ?? []);

  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  const submitNew = async () => {
    const name = draftName.trim();
    const prompt = draftPrompt.trim();
    if (!name || !prompt) return;
    try {
      await create.mutateAsync({ name, prompt, ...(workspaceId ? { workspaceId } : {}) });
      setDraftName("");
      setDraftPrompt("");
    } catch {
      toast({ title: t("settings.skills.saveFailed"), variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {visible.map((s) => (
        <SkillRow
          key={s.id}
          skill={s}
          onSave={(input) =>
            update
              .mutateAsync({ id: s.id, input })
              .catch(() =>
                toast({ title: t("settings.skills.saveFailed"), variant: "error" }),
              )
          }
          onDelete={() => void remove.mutateAsync(s.id)}
        />
      ))}
      {/* New-skill row */}
      <div className="rounded-md border border-dashed border-border bg-background px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground shrink-0">/</span>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("settings.skills.namePlaceholder")}
            maxLength={40}
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            variant="primary"
            size="xs"
            disabled={!draftName.trim() || !draftPrompt.trim() || create.isPending}
            loading={create.isPending}
            onClick={() => void submitNew()}
            leftIcon={<Plus className="h-3 w-3" />}
          >
            {t("settings.skills.add")}
          </Button>
        </div>
        <Textarea
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          placeholder={t("settings.skills.promptPlaceholder")}
          rows={2}
          maxLength={4000}
        />
      </div>
    </div>
  );
}

/** One row in the SkillsManager — view/edit/delete. */
function SkillRow({
  skill,
  onSave,
  onDelete,
}: {
  skill: Skill;
  onSave: (input: { name?: string; prompt?: string }) => Promise<unknown>;
  onDelete: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(skill.name);
  const [prompt, setPrompt] = useState(skill.prompt);

  const commit = async () => {
    const next = { name: name.trim(), prompt: prompt.trim() };
    if (!next.name || !next.prompt) {
      setEditing(false);
      setName(skill.name);
      setPrompt(skill.prompt);
      return;
    }
    if (next.name !== skill.name || next.prompt !== skill.prompt) {
      await onSave(next);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border border-accent bg-surface-2 px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground shrink-0">/</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="flex-1 bg-transparent text-xs font-medium text-foreground focus:outline-none"
          />
          <Button variant="ghost" size="xs" onClick={() => { setEditing(false); setName(skill.name); setPrompt(skill.prompt); }}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="xs" onClick={() => void commit()}>
            {t("common.save")}
          </Button>
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={4000}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 flex items-start gap-2 group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
          /{skill.name}
          {skill.builtin && (
            <span className="text-2xs text-muted-foreground font-normal">· {t("runs.template.builtIn")}</span>
          )}
          {(skill.variables?.length ?? 0) > 0 && (
            <span className="text-2xs text-accent font-normal">
              · {t("skills.inputCount", { n: skill.variables?.length ?? 0 })}
            </span>
          )}
        </div>
        {skill.description && (
          <div className="text-2xs text-muted-foreground mt-0.5">{skill.description}</div>
        )}
        <div className="text-2xs text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-wrap">
          {skill.prompt}
        </div>
      </div>
      {/* Built-in skills aren't editable — the row stays read-only. */}
      {!skill.builtin && (
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t("common.edit")}
          title={t("common.edit")}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("common.delete")}
          title={t("common.delete")}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-surface-3 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      )}
    </div>
  );
}
