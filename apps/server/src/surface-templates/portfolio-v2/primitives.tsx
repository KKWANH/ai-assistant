/**
 * Surface primitive components — Section / KpiCard / Chart / Table /
 * Badge / SortHead / ActionCard / AnalysisColumn — plus the shared
 * inline-style objects (tdLeft / tdRight / inputStyle / subHead).
 *
 * Each is one small dumb component; sections.tsx wires them into the
 * page-level layout.
 */

import type { ReactNode } from "react";

export function Section({ title, icon, children }: { title: string; icon?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "8px 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span>{icon}</span>}{title}
      </h3>
      {children}
    </section>
  );
}

export function ActionCard({ icon, title, detail, accent }: { icon: string; title: string; detail: string; accent: "destructive" | "warning" | "info" | "muted" }) {
  const borderColor = accent === "destructive" ? "rgb(var(--destructive))"
    : accent === "warning" ? "rgb(var(--warning))"
    : accent === "info" ? "rgb(var(--info))"
    : "rgb(var(--border))";
  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, padding: "8px 12px", background: "rgb(var(--card))" }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{icon} {title}</div>
      <div style={{ fontSize: 12, color: "rgb(var(--muted-foreground))", marginTop: 2 }}>{detail}</div>
    </div>
  );
}

export function KpiCard({ label, value, muted }: { label: string; value: string; muted?: string }) {
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: "8px 12px", background: "rgb(var(--card))" }}>
      <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {muted && <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))" }}>{muted}</div>}
    </div>
  );
}

export function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: 8, background: "rgb(var(--card))" }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "rgb(var(--muted-foreground))" }}>{title}</div>
      {children}
    </div>
  );
}

export function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid rgb(var(--border))", background: "rgb(var(--surface-2))" }}>
          {headers.map((h, i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500, color: "rgb(var(--muted-foreground))" }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function SortHead({ label, onClick, active, dir }: { label: string; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <span onClick={onClick} style={{ cursor: "pointer", userSelect: "none", color: active ? "rgb(var(--foreground))" : undefined }}>
      {label} {active ? (dir === "asc" ? "▲" : "▼") : ""}
    </span>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone: "destructive" | "warning" | "info" | "muted" | "success" }) {
  const bg = tone === "destructive" ? "rgb(var(--destructive))"
    : tone === "warning" ? "rgb(var(--warning))"
    : tone === "info" ? "rgb(var(--info))"
    : tone === "success" ? "rgb(var(--success))"
    : "rgb(var(--surface-3))";
  const fg = tone === "muted" ? "rgb(var(--muted-foreground))" : "rgb(var(--background))";
  return <span style={{ background: bg, color: fg, padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 500 }}>{children}</span>;
}

export function AnalysisColumn({ title, files }: { title: string; files: string[] }) {
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: 8, background: "rgb(var(--card))" }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{title}</div>
      {files.length === 0 ? <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))" }}>아직 없음</div> : (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>
          {files.map((f) => <li key={f} style={{ color: "rgb(var(--muted-foreground))" }}>{f.replace(/^analysis\/[^/]+\//, "")}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Shared inline style objects ───────────────────────────────────────────

export const tdLeft: any = { padding: "5px 8px", textAlign: "left" };
export const tdRight: any = { padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" };
export const inputStyle: any = {
  padding: "4px 8px", fontSize: 12, border: "1px solid rgb(var(--border))",
  background: "rgb(var(--background))", color: "rgb(var(--foreground))", borderRadius: 4,
};
export const subHead: any = { fontSize: 12, fontWeight: 500, margin: "12px 0 6px", color: "rgb(var(--muted-foreground))" };
export const mutedDot: any = { color: "rgb(var(--muted-foreground))" };
