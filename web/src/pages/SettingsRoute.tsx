import { SettingsSurface } from "../features/settings/SettingsSurface";
import type { AccountSummary } from "../entities/workspace/types";
import styles from "./SettingsRoute.module.css";

export type SettingsRouteProps = {
  account: AccountSummary;
  onSaved?: () => void | Promise<void>;
};

export function SettingsRoute({ account, onSaved }: SettingsRouteProps) {
  return (
    <section className={`center-pane ${styles.page}`}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">Workbench settings</p>
            <h1>Settings</h1>
            <p>Profile, models, costs, theme, local runtime, and privacy defaults for this local AI workbench.</p>
          </div>
        </header>
        <SettingsSurface account={account} onSaved={onSaved} />
      </div>
    </section>
  );
}
