import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./primitives.css";

export function Button({ className = "", variant = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  return <button className={`ui-button ${variant} ${className}`} {...props} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "local" | "cloud" | "danger" | "success" | "warning" }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card ${className}`} {...props} />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}
