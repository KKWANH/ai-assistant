import { useEffect, useState, type FormEvent } from "react";
import { copyForAccount } from "../../shared/copy/copy";
import { csrfHeader, fetchJson } from "../../lib/api";
import { isThemeName, themeNames } from "../../ui/theme/tokens";
import { themes } from "../../ui/theme/themes";
import { useTheme } from "../../ui/theme/useTheme";
import type { AccountSummary } from "../../entities/workspace/types";
import styles from "./SettingsSurface.module.css";

type UsageProvider = { provider: string; usd?: number; calls?: number };
type UsageSummary = {
  month_usd?: number;
  projected_month_usd?: number;
  providers?: UsageProvider[];
};
type UsageDetail = {
  user?: UsageSummary;
  all_accounts?: UsageSummary;
};

export type SettingsSurfaceProps = {
  account: AccountSummary;
  onClose?: () => void;
  onSaved?: () => void | Promise<void>;
};

export function SettingsSurface({ account, onClose, onSaved }: SettingsSurfaceProps) {
  const [saving, setSaving] = useState(false);
  const [usageDetail, setUsageDetail] = useState<UsageDetail | null>(null);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const profile = (account.profile || {}) as Record<string, string>;
  const copy = copyForAccount(account);
  const usage = (account.usage || {}) as Record<string, unknown>;
  const costUsage = account.cost_usage || {};
  const costMonthly = recordValue(costUsage.monthly);
  const monthly = usageDetail?.user || recordValue(costMonthly.user);
  const allMonthly = usageDetail?.all_accounts || recordValue(costMonthly.all_accounts);

  useEffect(() => {
    fetchJson<UsageDetail>("/api/model-usage").then(setUsageDetail).catch(() => {});
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/profile", { method: "POST", body: form });
      await onSaved?.();
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST", headers: csrfHeader() });
    window.location.href = "/login";
  }

  return (
    <section className={styles.surface}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Settings</p>
          <h2>{copy.settings.title}</h2>
          <p>Profile, model costs, theme, local runtime, and privacy defaults.</p>
        </div>
        <button className="danger-button compact" type="button" onClick={logout}>Logout</button>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          <h3>Usage / cost</h3>
          <span className="soft-pill">estimate</span>
        </div>
        <div className={styles.grid}>
          <Stat value={String(usage.messages || 0)} label={copy.settings.savedMessages} />
          <Stat value={String(usage.asks || 0)} label={copy.settings.aiRequests} />
          <Stat value={`$${Number(monthly.month_usd ?? costUsage.month_usd ?? 0).toFixed(4)}`} label={copy.settings.monthlyApiCost} />
          <Stat value={`$${Number(monthly.projected_month_usd ?? 0).toFixed(4)}`} label={copy.settings.monthlyApiForecast || "Month forecast"} />
          {account.admin && <Stat value={`$${Number(allMonthly.projected_month_usd ?? costUsage.all_month_usd ?? 0).toFixed(4)}`} label={copy.settings.allAccountForecast || "All accounts forecast"} />}
        </div>
        <p className="muted">{String(costUsage.basis || "Estimated token cost. Provider billing is source of truth.")}</p>
        {Array.isArray(monthly.providers) && monthly.providers.length > 0 && (
          <div className="settings-cost-breakdown">
            {(monthly.providers as UsageProvider[]).map((item) => (
              <span key={item.provider}>{item.provider}: ${Number(item.usd || 0).toFixed(4)} · {item.calls} calls</span>
            ))}
          </div>
        )}
      </section>

      <form className={styles.surface} onSubmit={submit}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h3>{copy.settings.profile}</h3></div>
          <label className={styles.row}><span>{copy.settings.avatar}</span><input name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></label>
          <div className={styles.grid}>
            <label className={styles.row}><span>{copy.settings.name}</span><input name="name" defaultValue={profile.name || account.display_name || ""} /></label>
            <label className={styles.row}><span>{copy.settings.age}</span><input name="age" defaultValue={profile.age || ""} /></label>
            <label className={styles.row}><span>{copy.settings.role}</span><input name="job" defaultValue={profile.job || ""} /></label>
            <label className={styles.row}><span>{copy.settings.language}</span><select name="language" defaultValue={profile.language || "en"}><option value="en">English</option><option value="ko">한국어</option></select></label>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><h3>{copy.settings.personalContext}</h3></div>
          <label className={styles.row}><span>{copy.settings.situation}</span><textarea name="situation" defaultValue={profile.situation || ""} /></label>
          <label className={styles.row}><span>{copy.settings.addMemory}</span><textarea name="memory" placeholder={copy.settings.memoryPlaceholder} /></label>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><h3>{copy.settings.interface}</h3></div>
          <div className={styles.grid}>
            <label className={styles.row}><span>{copy.settings.uiMode}</span><select name="ui_mode" defaultValue={profile.ui_mode || (account.admin ? "power" : "easy")}><option value="easy">{copy.settings.easyMode}</option><option value="power">{copy.settings.powerMode}</option></select></label>
            <label className={styles.row}>
              <span>Design theme</span>
              <select value={theme} onChange={(event) => {
                if (isThemeName(event.target.value)) setTheme(event.target.value);
              }}>
                {themeNames.map((item) => (
                  <option key={item} value={item}>{item === "system" ? `System (${themes[resolvedTheme].label})` : themes[item].label}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">{theme === "system" ? "OS 설정을 따라감." : themes[theme].description}</p>
        </section>

        <div className={styles.actions}>
          {onClose && <button type="button" onClick={onClose}>{copy.settings.close}</button>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : copy.settings.saveProfile}</button>
        </div>
      </form>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className={styles.stat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
