/**
 * WorkspaceSettings — one place to manage a workspace's behavior, instead of
 * the controls being scattered across the header (rename, visibility), the
 * chat composer's model picker, and the custom-screen tab ("set as main").
 * Reached via the gear in the workspace header (/workspaces/:id/settings),
 * matching the existing /search and /screen sub-route pattern.
 *
 * v1 sections:
 *  - General      → name, visibility
 *  - Chat & model → per-workspace default model (+ reset to account default),
 *                   floating-chat open behavior
 *  - Home screen  → open the custom screen fullscreen by default (homeView)
 *  - Files        → include/exclude globs (until now only set at creation)
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon, Cpu, Layout, FolderTree, Sparkles, TrendingUp, Users, Trash2 } from "lucide-react";
import { SELECTABLE_PROVIDERS, PROVIDER_LABELS, MODEL_CHOICES, DEFAULT_MODELS, isBuiltinWorkspace } from "@ariadne/shared";
import type { ProviderId, Workspace } from "@ariadne/shared";
import { useWorkspace, useUpdateWorkspace, useSettings, useSurface, useSkills, useWorkspaceUsage, useMe, useWorkspaceAccess, useSetWorkspaceAccess } from "../../lib/queries";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { useT } from "../../lib/i18n";
import { useToast } from "../../components/ui/Toast";
import { useUIStore, type FloatingChatMode } from "../../lib/store";
import { resolveProjectHomeScreen } from "../../projects";
import { SkillsManager } from "../settings/SkillsManager";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { Select } from "../../components/ui/Select";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { PageHeader } from "../../components/layout/PageHeader";
import { NotFoundRedirect } from "../../components/NotFoundRedirect";

export function WorkspaceSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { data: ws, isLoading } = useWorkspace(id ?? "");
  const { data: surfaceData } = useSurface(id ?? "");
  const surfaceExists = surfaceData?.state?.exists ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!ws) return <NotFoundRedirect />;

  // A "screen" exists if the workspace has an authored surface or a project
  // home (e.g. lecture) — only then is the fullscreen-default toggle meaningful.
  const hasScreen = surfaceExists || resolveProjectHomeScreen(ws) != null;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border bg-background">
        <PageHeader
          icon={<SettingsIcon className="h-5 w-5" />}
          title={t("workspaceSettings.title")}
          description={
            <span className="flex items-center gap-2">
              <Link to={`/workspaces/${ws.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                ← {ws.name}
              </Link>
              <span className="text-2xs text-muted-foreground font-mono">{ws.rootPath}</span>
            </span>
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/workspaces/${ws.id}`)}
            >
              {t("common.back")}
            </Button>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto px-5 py-6 flex flex-col gap-6">
          <GeneralSection ws={ws} />
          <ChatModelSection ws={ws} />
          <SkillsSection ws={ws} />
          {hasScreen && <HomeScreenSection ws={ws} />}
          <AccessSection ws={ws} />
          <UsageSection ws={ws} />
          <FilesSection ws={ws} />
          <DangerSection ws={ws} />
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
      {icon}
      {children}
    </h2>
  );
}

/** Label + helper text above a control, repeated across sections. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-2xs text-muted-foreground leading-relaxed">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ── General ──────────────────────────────────────────────────────────────────
function GeneralSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateWorkspace();
  const [name, setName] = useState(ws.name);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === ws.name) return;
    try {
      await update.mutateAsync({ id: ws.id, input: { name: next } });
    } catch {
      toast({ title: t("workspaceSettings.saveFailed"), variant: "error" });
    }
  };

  const setVisibility = (v: string) =>
    update
      .mutateAsync({ id: ws.id, input: { visibility: v as "private" | "public" } })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  return (
    <section>
      <SectionHeading icon={<SettingsIcon className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.general.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
        <Field label={t("workspaceSettings.general.nameLabel")}>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <Button
              variant="primary"
              size="sm"
              className="shrink-0"
              disabled={update.isPending || !name.trim() || name.trim() === ws.name}
              loading={update.isPending}
              onClick={() => void saveName()}
            >
              {t("common.save")}
            </Button>
          </div>
        </Field>
        <Field label={t("workspaceSettings.general.visibilityLabel")} hint={t("workspaceSettings.general.visibilityHint")}>
          <SegmentedControl
            value={ws.visibility}
            onChange={setVisibility}
            disabled={update.isPending}
            ariaLabel={t("workspaceSettings.general.visibilityLabel")}
            options={[
              { value: "private", label: t("workspace.visibility.private") },
              { value: "public", label: t("workspace.visibility.public") },
            ]}
          />
        </Field>
      </Card>
    </section>
  );
}

// ── Chat & model ─────────────────────────────────────────────────────────────
function ChatModelSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateWorkspace();
  const { data: settings } = useSettings();
  const floatingMode = useUIStore((s) => s.floatingChatModeById[ws.id] ?? "recent");
  const setFloatingMode = useUIStore((s) => s.setFloatingChatModeFor);

  // When the workspace pins its own provider+model, the pickers edit THAT;
  // otherwise they show the account default (inherited) until the user changes
  // one, which sets the override. The two fields are set/cleared together.
  const hasOverride = !!(ws.defaultProvider && ws.defaultModel);
  const provider = (ws.defaultProvider ?? settings?.provider ?? "mock") as ProviderId;
  const model = ws.defaultModel ?? settings?.model ?? "mock";
  const modelChoices = (MODEL_CHOICES as Record<string, string[]>)[provider] ?? [];

  const onError = () => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" });

  const changeProvider = (p: string) => {
    const next = p as ProviderId;
    const firstModel = (MODEL_CHOICES as Record<string, string[]>)[next]?.[0] ?? DEFAULT_MODELS[next] ?? next;
    update
      .mutateAsync({ id: ws.id, input: { defaultProvider: next, defaultModel: firstModel } })
      .catch(onError);
  };
  const changeModel = (m: string) =>
    update.mutateAsync({ id: ws.id, input: { defaultProvider: provider, defaultModel: m } }).catch(onError);
  const resetModel = () =>
    update.mutateAsync({ id: ws.id, input: { defaultProvider: null, defaultModel: null } }).catch(onError);

  return (
    <section>
      <SectionHeading icon={<Cpu className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.chat.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
        <Field label={t("workspaceSettings.chat.modelLabel")} hint={t("workspaceSettings.chat.modelHint")}>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              className="min-w-[8rem]"
              value={provider}
              onChange={(e) => changeProvider(e.target.value)}
              options={SELECTABLE_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
            />
            <Select
              className="min-w-[10rem] flex-1"
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              options={
                modelChoices.length
                  ? modelChoices.map((m) => ({ value: m, label: m }))
                  : [{ value: model, label: model }]
              }
            />
            {hasOverride && (
              <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => void resetModel()}>
                {t("workspaceSettings.chat.reset")}
              </Button>
            )}
          </div>
          {!hasOverride && (
            <span className="text-2xs text-muted-foreground">{t("workspaceSettings.chat.usingAccountDefault")}</span>
          )}
        </Field>
        <Field label={t("workspaceSettings.chat.floatingLabel")} hint={t("workspaceSettings.chat.floatingHint")}>
          <SegmentedControl
            value={floatingMode}
            onChange={(v) => setFloatingMode(ws.id, v as FloatingChatMode)}
            ariaLabel={t("workspaceSettings.chat.floatingLabel")}
            options={[
              { value: "recent", label: t("workspaceSettings.chat.floatingRecent") },
              { value: "new", label: t("workspaceSettings.chat.floatingNew") },
            ]}
          />
        </Field>
      </Card>
    </section>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────
function SkillsSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateWorkspace();
  // Global + this workspace's scoped skills + built-ins — any can be the default.
  const { data: skills } = useSkills(ws.id);

  const setDefault = (id: string) =>
    update
      .mutateAsync({ id: ws.id, input: { defaultSkillId: id || null } })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  const options = [
    { value: "", label: t("workspaceSettings.skills.defaultNone") },
    ...(skills ?? []).map((s) => ({ value: s.id, label: `/${s.name}` })),
  ];

  return (
    <section>
      <SectionHeading icon={<Sparkles className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.skills.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
        <Field label={t("workspaceSettings.skills.defaultLabel")} hint={t("workspaceSettings.skills.defaultHint")}>
          <Select
            className="max-w-xs"
            value={ws.defaultSkillId ?? ""}
            onChange={(e) => void setDefault(e.target.value)}
            options={options}
          />
        </Field>
        <Field label={t("workspaceSettings.skills.manageLabel")} hint={t("workspaceSettings.skills.manageHint")}>
          <SkillsManager workspaceId={ws.id} />
        </Field>
      </Card>
    </section>
  );
}

// ── Home screen ──────────────────────────────────────────────────────────────
function HomeScreenSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateWorkspace();

  const setHomeView = (v: string) =>
    update
      .mutateAsync({ id: ws.id, input: { homeView: v as "overview" | "surface" } })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  const setFocus = (v: string) =>
    update
      .mutateAsync({ id: ws.id, input: { focusMode: v === "on" } })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  return (
    <section>
      <SectionHeading icon={<Layout className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.home.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
        <Field label={t("workspaceSettings.home.openLabel")} hint={t("workspaceSettings.home.openHint")}>
          <SegmentedControl
            value={ws.homeView === "surface" ? "surface" : "overview"}
            onChange={setHomeView}
            disabled={update.isPending}
            ariaLabel={t("workspaceSettings.home.openLabel")}
            options={[
              { value: "overview", label: t("workspaceSettings.home.overview") },
              { value: "surface", label: t("workspaceSettings.home.fullscreen") },
            ]}
          />
        </Field>
        <Field label={t("workspaceSettings.home.focusLabel")} hint={t("workspaceSettings.home.focusHint")}>
          <SegmentedControl
            value={ws.focusMode ? "on" : "off"}
            onChange={setFocus}
            disabled={update.isPending}
            ariaLabel={t("workspaceSettings.home.focusLabel")}
            options={[
              { value: "off", label: t("workspaceSettings.home.focusOff") },
              { value: "on", label: t("workspaceSettings.home.focusOn") },
            ]}
          />
        </Field>
      </Card>
    </section>
  );
}

// ── Usage ────────────────────────────────────────────────────────────────────
function UsageSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { data: usage } = useWorkspaceUsage(ws.id);
  const total = usage?.total;
  const hasUsage = !!total && (total.inputTokens > 0 || total.outputTokens > 0);

  return (
    <section>
      <SectionHeading icon={<TrendingUp className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.usage.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-3">
        <p className="text-2xs text-muted-foreground leading-relaxed">{t("workspaceSettings.usage.desc")}</p>
        {hasUsage && total ? (
          <>
            <div className="flex flex-wrap gap-5">
              <div className="flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground">{t("settings.usage.tokensIn")}</span>
                <span className="font-mono text-sm text-foreground">{total.inputTokens.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground">{t("settings.usage.tokensOut")}</span>
                <span className="font-mono text-sm text-foreground">{total.outputTokens.toLocaleString()}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-2xs text-muted-foreground">{t("settings.usage.totalCost")}</span>
                <span className="font-mono text-sm text-foreground">
                  {total.costUsd === 0 ? "$0.00" : `$${total.costUsd.toFixed(4)}`}
                </span>
              </div>
            </div>
            {usage.byModel.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-2xs">
                  <thead>
                    <tr className="bg-surface-3 border-b border-border text-muted-foreground">
                      <th className="px-2.5 py-1.5 text-left font-medium">{t("settings.usage.model")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("settings.usage.tokensInCol")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("settings.usage.tokensOutCol")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("settings.usage.cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byModel.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-2.5 py-1.5 font-mono text-foreground">{row.model}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-muted-foreground">{row.inputTokens.toLocaleString()}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-muted-foreground">{row.outputTokens.toLocaleString()}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono text-foreground">
                          {row.costUsd === 0 ? "$0.00" : `$${row.costUsd.toFixed(4)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("workspaceSettings.usage.empty")}</p>
        )}
      </Card>
    </section>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────
function FilesSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const update = useUpdateWorkspace();
  const [include, setInclude] = useState((ws.include ?? []).join("\n"));
  const [exclude, setExclude] = useState((ws.exclude ?? []).join("\n"));

  const toLines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const dirty = toLines(include).join("\n") !== (ws.include ?? []).join("\n") ||
    toLines(exclude).join("\n") !== (ws.exclude ?? []).join("\n");

  const save = async () => {
    try {
      await update.mutateAsync({ id: ws.id, input: { include: toLines(include), exclude: toLines(exclude) } });
    } catch {
      toast({ title: t("workspaceSettings.saveFailed"), variant: "error" });
    }
  };

  return (
    <section>
      <SectionHeading icon={<FolderTree className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.files.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
        <p className="text-2xs text-muted-foreground leading-relaxed">{t("workspaceSettings.files.hint")}</p>
        <Field label={t("workspaceSettings.files.includeLabel")}>
          <Textarea
            value={include}
            onChange={(e) => setInclude(e.target.value)}
            rows={3}
            placeholder={t("workspaceSettings.files.includePlaceholder")}
            className="font-mono text-2xs"
          />
        </Field>
        <Field label={t("workspaceSettings.files.excludeLabel")}>
          <Textarea
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            rows={3}
            placeholder={t("workspaceSettings.files.excludePlaceholder")}
            className="font-mono text-2xs"
          />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={update.isPending || !dirty}
            loading={update.isPending}
            onClick={() => void save()}
          >
            {t("common.save")}
          </Button>
        </div>
      </Card>
    </section>
  );
}

// ── Access (per-user roles) ────────────────────────────────────────────────────
// Admin/owner only — a user table assigning each account a role on this
// workspace (Owner / Editor / Viewer / Non-Viewer). Grants open a private
// workspace to specific people (e.g. share 강의 준비 with a family account).
function AccessSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const { toast } = useToast();
  const { data: me } = useMe();
  const canManage = me?.account.role === "admin" || ws.createdBy === me?.account.id;
  const { data, isLoading } = useWorkspaceAccess(ws.id, canManage);
  const setAccess = useSetWorkspaceAccess(ws.id);
  if (!canManage) return null;

  const change = (accountId: string, role: string) =>
    void setAccess
      .mutateAsync({ accountId, role })
      .catch(() => toast({ title: t("workspaceSettings.saveFailed"), variant: "error" }));

  return (
    <section>
      <SectionHeading icon={<Users className="h-3.5 w-3.5" />}>
        {t("workspaceSettings.access.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-2">
        <p className="text-2xs text-muted-foreground leading-relaxed mb-1">
          {t("workspaceSettings.access.hint")}
        </p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {(data?.entries ?? []).map((e) => (
              <div key={e.accountId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{e.displayName}</div>
                  <div className="text-2xs text-muted-foreground font-mono truncate">@{e.username}</div>
                </div>
                {e.isOwner ? (
                  <span className="text-2xs font-medium text-accent px-2 shrink-0">
                    {t("workspaceSettings.access.owner")}
                  </span>
                ) : e.isAdmin ? (
                  <span className="text-2xs text-muted-foreground px-2 shrink-0">
                    {t("workspaceSettings.access.admin")}
                  </span>
                ) : (
                  <Select
                    value={e.role ?? "none"}
                    onChange={(ev) => change(e.accountId, ev.target.value)}
                    disabled={setAccess.isPending}
                    className="w-36 shrink-0"
                    options={[
                      { value: "none", label: t("workspaceSettings.access.none") },
                      { value: "viewer", label: t("workspaceSettings.access.viewer") },
                      { value: "editor", label: t("workspaceSettings.access.editor") },
                      { value: "owner", label: t("workspaceSettings.access.ownerRole") },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

// ── Danger zone (delete) ───────────────────────────────────────────────────────
function DangerSection({ ws }: { ws: Workspace }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [confirming, setConfirming] = useState(false);
  const canManage = me?.account.role === "admin" || ws.createdBy === me?.account.id;
  // Built-ins can't be deleted; only owner/admin see the control.
  if (isBuiltinWorkspace(ws.id) || !canManage) return null;

  return (
    <section>
      <SectionHeading icon={<Trash2 className="h-3.5 w-3.5 text-destructive" />}>
        {t("workspaceSettings.danger.heading")}
      </SectionHeading>
      <Card className="px-4 py-3 border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t("workspaceSettings.danger.deleteLabel")}</p>
          <p className="text-2xs text-muted-foreground">{t("workspaceSettings.danger.deleteHint")}</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => setConfirming(true)}
          className="shrink-0"
        >
          {t("workspaceSettings.danger.deleteBtn")}
        </Button>
      </Card>
      <DeleteWorkspaceDialog
        workspace={confirming ? ws : null}
        onClose={() => setConfirming(false)}
        onDeleted={() => navigate("/")}
      />
    </section>
  );
}
