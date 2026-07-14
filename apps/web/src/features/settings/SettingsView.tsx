import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
  KeyRound,
  Palette,
  ExternalLink,
} from "lucide-react";
import { PROVIDERS, SELECTABLE_PROVIDERS, PROVIDER_LABELS, PROVIDER_REGISTRY } from "@ariadne/shared";
import type { AccountMode, ProviderId } from "@ariadne/shared";
import {
  useSettings,
  useUsage,
  useProviderStatus,
  useMe,
  useUpdateMode,
  useUpdateContext,
  useSetProviderKey,
  useAccountLimits,
} from "../../lib/queries";
import { RegisteredSettings } from "./RegisteredSettings";
import { SkillsManager } from "./SkillsManager";
import { useT, LOCALES, type Locale } from "../../lib/i18n";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { PageHeader } from "../../components/layout/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { McpServersPanel } from "../mcp/McpServersPanel";
import { useUIStore } from "../../lib/store";
import { WALLPAPERS } from "../../lib/wallpaper";

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

/** One provider's API-key field. Write-only — we never read the key back, only
 *  the `configured` flag. Saving an empty value clears it (reverts to env). */
function ApiKeyRow({ id, label, configured }: { id: ProviderId; label: string; configured: boolean }) {
  const { t } = useT();
  const { toast } = useToast();
  const setKey = useSetProviderKey();
  const [value, setValue] = useState("");

  const submit = async (key: string) => {
    try {
      await setKey.mutateAsync({ id, key });
      setValue("");
      toast({ title: key ? t("settings.apiKeys.saved") : t("settings.apiKeys.cleared"), variant: "success" });
    } catch (err) {
      toast({
        title: t("settings.apiKeys.failed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  const keyUrl = PROVIDER_REGISTRY[id]?.keyUrl;
  return (
    <Card className="flex items-center gap-3 px-4 py-2.5">
      <div className="w-40 shrink-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm text-foreground">
          {configured ? (
            <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
          ) : (
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          {label}
        </span>
        {keyUrl && !configured && (
          <a
            href={keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={keyUrl}
            className="ml-5 inline-flex w-fit items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-2xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            {t("settings.apiKeys.getKey")} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={configured ? t("settings.apiKeys.placeholderSet") : t("settings.apiKeys.placeholder")}
        className="flex-1 font-mono text-xs"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void submit(value)}
        disabled={!value.trim() || setKey.isPending}
        loading={setKey.isPending}
      >
        {t("settings.apiKeys.save")}
      </Button>
      {configured && (
        <Button variant="ghost" size="sm" onClick={() => void submit("")} disabled={setKey.isPending}>
          {t("settings.apiKeys.clear")}
        </Button>
      )}
    </Card>
  );
}

/** A single token-budget bar (used / limit), turning red when over. */
function LimitBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = used >= limit;
  return (
    <div>
      <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="font-mono">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div className={`h-full ${over ? "bg-destructive" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SettingsView() {
  const { data: settings, isLoading } = useSettings();
  const { toast } = useToast();
  const { data: usage } = useUsage();
  const { data: liveProviders, isLoading: statusLoading } = useProviderStatus();
  const { data: limits } = useAccountLimits();
  const { t, locale, setLocale } = useT();
  const { data: me } = useMe();
  const updateMode = useUpdateMode();
  const updateContext = useUpdateContext();
  const wallpaper = useUIStore((s) => s.wallpaper);
  const setWallpaper = useUIStore((s) => s.setWallpaper);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
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
          {SELECTABLE_PROVIDERS.map((pid) => {
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

      {/* API keys — paste a provider key in-app; no shell env var needed.
          Saved to the local settings table and used over the env var. */}
      <section>
        <SectionHeading icon={<KeyRound className="h-3.5 w-3.5" />}>
          {t("settings.apiKeys.heading")}
        </SectionHeading>
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.apiKeys.subtitle")}{" "}
          <Link to="/developers/api-keys" className="text-accent hover:underline">
            {t("settings.apiKeys.guide")} →
          </Link>
        </p>
        <div className="flex flex-col gap-1.5">
          {PROVIDERS.filter((pid) => PROVIDER_REGISTRY[pid].envKey).map((pid) => {
            const live = liveProviders?.find((p) => p.id === pid);
            const fallback = settings.providers.find((p) => p.id === pid);
            const configured = live?.configured ?? fallback?.configured ?? false;
            return (
              <ApiKeyRow key={pid} id={pid} label={PROVIDER_LABELS[pid]} configured={configured} />
            );
          })}
        </div>
      </section>

      {/* Usage limits — only shown for accounts that actually have a cap
          (the test account, the guest). Unlimited accounts see nothing. */}
      {limits && (limits.dailyTokenLimit != null || limits.weeklyTokenLimit != null) && (
        <section>
          <SectionHeading>{t("settings.limits.heading")}</SectionHeading>
          <p className="text-xs text-muted-foreground mb-2">{t("settings.limits.subtitle")}</p>
          <Card className="px-4 py-3 flex flex-col gap-3">
            {limits.dailyTokenLimit != null && (
              <LimitBar
                label={t("settings.limits.daily")}
                used={limits.dailyTokensUsed}
                limit={limits.dailyTokenLimit}
              />
            )}
            {limits.weeklyTokenLimit != null && (
              <LimitBar
                label={t("settings.limits.weekly")}
                used={limits.weeklyTokensUsed}
                limit={limits.weeklyTokenLimit}
              />
            )}
          </Card>
        </section>
      )}

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

      {/* Appearance — theme + liquid-glass wallpaper */}
      <section>
        <SectionHeading icon={<Palette className="h-3.5 w-3.5" />}>
          {locale === "ko" ? "화면" : "Appearance"}
        </SectionHeading>
        <Card className="px-4 py-3 bg-surface-2 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">{locale === "ko" ? "테마" : "Theme"}</p>
              <p className="text-2xs text-muted-foreground">{locale === "ko" ? "다크 / 라이트" : "Dark / light"}</p>
            </div>
            <SegmentedControl<"dark" | "light">
              ariaLabel={locale === "ko" ? "테마" : "Theme"}
              value={theme}
              onChange={(next) => setTheme(next)}
              options={[
                { value: "dark", label: locale === "ko" ? "다크" : "Dark" },
                { value: "light", label: locale === "ko" ? "라이트" : "Light" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-2xs text-muted-foreground">
              {locale === "ko"
                ? "배경 — 유리 패널(사이드바·상단바·입력창)이 이 위에서 빛을 머금어요 (다크 모드)"
                : "Background — the glass panels (sidebar, top bar, composer) frost over this (dark mode)"}
            </p>
            <div className="flex flex-wrap gap-2">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  onClick={() => setWallpaper(w.key)}
                  title={w.label}
                  aria-label={w.label}
                  aria-pressed={wallpaper === w.key}
                  className={`h-9 w-9 rounded-lg border transition-transform hover:scale-110 ${
                    wallpaper === w.key ? "border-accent ring-2 ring-accent" : "border-border"
                  }`}
                  style={{ background: w.swatch }}
                />
              ))}
            </div>
          </div>
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

      {/* Info — Simple/Easy users don't need to know about env vars
          and provider keys. Hide for them. */}
      {me?.account.mode !== "simple" && (
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
      )}

      {/* Preferences contributed via the settings registry (P2 configurability). */}
      <RegisteredSettings />
    </div>
  );
}
