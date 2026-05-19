import type { AdminAnalysis, AdminStatus } from "../../domain/types";
import styles from "./AdminDashboard.module.css";

interface AdminDashboardProps {
  status: AdminStatus | null;
  analysis: AdminAnalysis | null;
  logs: string[];
}

export function AdminDashboard({ status, analysis, logs }: AdminDashboardProps) {
  return (
    <div className={styles.dashboard}>
      <section className={styles.header}>
        <div>
          <h1>Administrator</h1>
          <p>Local daemon, logs, errors, and quick operational analysis.</p>
        </div>
        <div className={styles.pid}>PID {status?.pid ?? "offline"}</div>
      </section>

      <section className={styles.grid}>
        <article className={styles.metric}>
          <span>Projects</span>
          <strong>{status?.project_count ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Sessions</span>
          <strong>{status?.session_count ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Errors</span>
          <strong>{analysis?.error_count ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Warnings</span>
          <strong>{analysis?.warning_count ?? 0}</strong>
        </article>
      </section>

      <section className={styles.analysis}>
        <h2>Analysis</h2>
        {(analysis?.findings ?? ["No analysis loaded."]).map((finding) => (
          <p key={finding}>{finding}</p>
        ))}
      </section>

      <section className={styles.logs}>
        <h2>Daemon Log</h2>
        <pre>{logs.length ? logs.join("\n") : "No logs yet."}</pre>
      </section>
    </div>
  );
}
