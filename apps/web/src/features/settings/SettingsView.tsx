import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  CheckCircle,
  XCircle,
  TrendingUp,
  Loader2,
  Wifi,
  WifiOff,
  Star,
  Languages,
  Layers,
  Brain,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { PROVIDERS, PROVIDER_LABELS } from "@ariadne/shared";
import type { AccountMode } from "@ariadne/shared";
import {
  useSettings,
  useUsage,
  useProviderStatus,
  useMe,
  useUpdateMode,
  useUpdateContext,
  useSkills,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
} from "../../lib/queries";
import type { Skill } from "@ariadne/shared";
import { useT, LOCALES, type Locale } from "../../lib/i18n";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Textarea";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { McpServersPanel } from "../mcp/McpServersPanel";

/** Compact section heading shared by every block in the settings page. */
function SectionHeading({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
      {icon}
      {children}
    </h2>
  );
}

export function SettingsView() {
  const { data: settings, isLoading } = useSettings();
  const { toast } = useToast();
  const { data: usage } = useUsage();
  const { data: liveProviders, isLoading: statusLoading } = useProviderStatus();
  const { t, locale, setLocale } = useT();
  const { data: me } = useMe();
  const updateMode = useUpdateMode();
  const updateContext = useUpdateContext();
  const [contextDraft, setContextDraft] = useState("");
  // Sync the editable draft when the saved profile loads or changes.
  useEffect(() => {
    setContextDraft(me?.account.context ?? "");
  }, [me?.account.context]);

  const handleLocaleChange = async (next: Locale) => {
    try {
      await setLocale(next);
    } catch {
      toast({ title: t("settings.language.failed"), variant: "error" });
    }
  };

  const handleModeChange = async (next: AccountMode) => {
    try {
      await updateMode.mutateAsync(next);
      toast({ title: t("settings.mode.saved"), variant: "success" });
    } catch {
      toast({ title: t("settings.mode.failed"), variant: "error" });
    }
  };

  const handleContextSave = async () => {
    try {
      await updateContext.mutateAsync(contextDraft.trim());
      toast({ title: t("settings.context.saved"), variant: "success" });
    } catch {
      toast({ title: t("settings.context.failed"), variant: "error" });
    }
  };

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-5 sm:p-6 w-full max-w-4xl mx-auto overflow-y-auto h-full">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" />}
        title={t("settings.title")}
        description={t("settings.description")}
      />

      {/* Provider status overview — live. The active provider/model is
          chosen in the chat composer; this is a read-only status panel. */}
      <section>
        <SectionHeading>
          {t("settings.providers.heading")}
          {statusLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </SectionHeading>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.providers.pickInChat")}
        </p>
        <div className="flex flex-col gap-1.5">
          {PROVIDERS.map((pid) => {
            const live = liveProviders?.find((p) => p.id === pid);
            const fallback = settings.providers.find((p) => p.id === pid);
            const configured = live?.configured ?? fallback?.configured ?? false;
            const label = PROVIDER_LABELS[pid];
            const isActive = settings.provider === pid;
            const isOllama = pid === "ollama";
            const installedCount = live?.models?.length ?? 0;

            return (
              <Card
                key={pid}
                className={[
                  "flex items-center gap-3 px-4 py-2.5",
                  isActive ? "border-accent ring-1 ring-accent/20" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-1.5 flex-1 text-sm text-foreground">
                  {configured ? (
                    isOllama ? (
                      <Wifi className="h-3.5 w-3.5 text-success shrink-0" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                    )
                  ) : isOllama ? (
                    <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  {label}
                  {isActive && (
                    <Star
                      className="h-3 w-3 text-accent fill-accent shrink-0"
                      aria-label={t("settings.providers.active")}
                    />
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="text-xs font-medium text-accent">
                      {t("settings.providers.active")}
                    </span>
                  )}
                  {isOllama ? (
                    configured ? (
                      <span className="text-xs text-success">
                        {t("settings.providers.reachable", {
                          n: installedCount,
                          s: installedCount !== 1 ? "s" : "",
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("settings.providers.notRunning")}
                      </span>
                    )
                  ) : configured ? (
                    <span className="text-xs text-success">
                      {t("settings.providers.apiKeySet")}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("settings.providers.keyRequired")}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* MCP servers — external Model Context Protocol endpoints
          the agent can call as tools. Local-only management. Hidden
          in Simple/Easy mode — power-user feature, would confuse
          non-developers. */}
      {me?.account.mode !== "simple" && (
        <section>
          <SectionHeading>
            {t("mcp.panel.heading")}
          </SectionHeading>
          <McpServersPanel />
        </section>
      )}

      {/* Language / 언어 */}
      <section>
        <SectionHeading icon={<Languages className="h-3.5 w-3.5" />}>
          {t("settings.language.heading")}
        </SectionHeading>
        <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("settings.language.description")}</p>
          <SegmentedControl<Locale>
            ariaLabel={t("settings.language.heading")}
            value={locale}
            onChange={(loc) => void handleLocaleChange(loc)}
            options={LOCALES.map((loc) => ({
              value: loc,
              label: loc === "en" ? t("settings.language.en") : t("settings.language.ko"),
            }))}
          />
        </Card>
      </section>

      {/* UI Mode */}
      <section>
        <SectionHeading icon={<Layers className="h-3.5 w-3.5" />}>
          {t("settings.mode.heading")}
        </SectionHeading>
        <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("settings.mode.description")}</p>
          <SegmentedControl<AccountMode>
            ariaLabel={t("settings.mode.heading")}
            value={me?.account.mode ?? "standard"}
            disabled={updateMode.isPending}
            onChange={(m) => void handleModeChange(m)}
            options={[
              { value: "standard", label: t("settings.mode.standard") },
              { value: "simple", label: t("settings.mode.simple") },
            ]}
          />
        </Card>
      </section>

      {/* My profile — saved account context, auto-updated + manually editable */}
      <section>
        <SectionHeading icon={<Brain className="h-3.5 w-3.5" />}>
          {t("settings.context.heading")}
        </SectionHeading>
        <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("settings.context.description")}</p>
          <Textarea
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            placeholder={t("settings.context.placeholder")}
            rows={5}
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xs text-muted-foreground">
              {me?.account.contextUpdatedAt
                ? t("settings.context.autoNote", {
                    time: new Date(me.account.contextUpdatedAt).toLocaleString(),
                  })
                : t("settings.context.neverUpdated")}
            </p>
            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              onClick={() => void handleContextSave()}
              disabled={
                updateContext.isPending || contextDraft === (me?.account.context ?? "")
              }
              loading={updateContext.isPending}
            >
              {t("settings.context.save")}
            </Button>
          </div>
        </Card>
      </section>

      {/* Skills — account-scoped reusable prompt snippets */}
      <section>
        <SectionHeading icon={<Sparkles className="h-3.5 w-3.5" />}>
          {t("settings.skills.heading")}
        </SectionHeading>
        <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.skills.description")}
          </p>
          <SkillsManager />
        </Card>
      </section>

      {/* Usage & Cost */}
      <section>
        <SectionHeading icon={<TrendingUp className="h-3.5 w-3.5" />}>
          {t("settings.usage.heading")}
        </SectionHeading>
        {usage ? (
          <div className="flex flex-col gap-2">
            <Card className="px-4 py-3 flex flex-wrap gap-4 bg-surface-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">{t("settings.usage.tokensIn")}</p>
                <p className="font-mono text-sm text-foreground">{usage.total.inputTokens.toLocaleString()}</p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">{t("settings.usage.tokensOut")}</p>
                <p className="font-mono text-sm text-foreground">{usage.total.outputTokens.toLocaleString()}</p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">{t("settings.usage.totalCost")}</p>
                <p className="font-mono text-sm text-foreground">
                  {usage.total.costUsd === 0 ? "$0.00" : `$${usage.total.costUsd.toFixed(4)}`}
                </p>
              </div>
            </Card>

            {usage.byModel.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-2 border-b border-border">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">{t("settings.usage.model")}</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">{t("settings.usage.tokensInCol")}</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">{t("settings.usage.tokensOutCol")}</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">{t("settings.usage.cost")}</th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">{t("settings.usage.runs")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byModel.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono text-foreground">{row.model}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.inputTokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.outputTokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">
                          {row.costUsd === 0 ? "$0.00" : `$${row.costUsd.toFixed(4)}`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.runs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <Card className="px-4 py-3 bg-surface-2">
            <p className="text-xs text-muted-foreground">{t("settings.usage.empty")}</p>
          </Card>
        )}
      </section>

      {/* Info */}
      <Card className="px-4 py-3 bg-surface-2">
        <p className="text-xs text-muted-foreground">
          {t("settings.info.body", {
            anthropic: "ANTHROPIC_API_KEY",
            openai: "OPENAI_API_KEY",
            mock: "mock",
          }).split(/(ANTHROPIC_API_KEY|OPENAI_API_KEY|mock)/).map((part, i) =>
            ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "mock"].includes(part)
              ? <code key={i} className="font-mono text-foreground">{part}</code>
              : <span key={i}>{part}</span>
          )}
        </p>
      </Card>
    </div>
  );
}

/**
 * SkillsManager — inline CRUD for account-scoped skills. Kept small on
 * purpose: a list with edit-in-place and a single 'add' row at the
 * bottom. No modal, no separate page.
 */
function SkillsManager() {
  const { t } = useT();
  const { toast } = useToast();
  const { data: skills } = useSkills();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const remove = useDeleteSkill();

  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");

  const submitNew = async () => {
    const name = draftName.trim();
    const prompt = draftPrompt.trim();
    if (!name || !prompt) return;
    try {
      await create.mutateAsync({ name, prompt });
      setDraftName("");
      setDraftPrompt("");
    } catch {
      toast({ title: t("settings.skills.saveFailed"), variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {(skills ?? []).map((s) => (
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
