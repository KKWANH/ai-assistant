import React, { forwardRef } from "react";
import "./primitives.css";

type BaseProps = { className?: string; children?: React.ReactNode };

function join(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "secondary", loading = false, disabled, children, ...props }, ref) {
  return (
    <button ref={ref} className={join("ui-button", `ui-button-${variant}`, className)} disabled={disabled || loading} {...props}>
      {loading && <Spinner compact />}
      {children}
    </button>
  );
});

export type IconButtonProps = ButtonProps & { label: string };

export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <Button className={join("ui-icon-button", className)} aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={join("ui-input", className)} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} className={join("ui-input", "ui-textarea", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={join("ui-input", className)} {...props} />;
});

export function Card({ className, children }: BaseProps) {
  return <section className={join("ui-card", className)}>{children}</section>;
}

export function Panel({ className, children }: BaseProps) {
  return <section className={join("ui-panel", className)}>{children}</section>;
}

export function Badge({ className, children }: BaseProps) {
  return <span className={join("ui-badge", className)}>{children}</span>;
}

export function StatusDot({ tone = "info" }: { tone?: "success" | "warning" | "error" | "info" }) {
  return <span className={`ui-status-dot ${tone}`} aria-hidden="true" />;
}

export function EmptyState({ title, body, action, className }: { title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={join("ui-empty-state", className)}>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="ui-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>×</IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Drawer({ title, open, side = "right", onClose, children }: { title: string; open: boolean; side?: "left" | "right" | "bottom"; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="ui-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className={`ui-drawer ${side}`} role="complementary" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>×</IconButton>
        </header>
        {children}
      </aside>
    </div>
  );
}

export function Tabs({ children, className }: BaseProps) {
  return <div className={join("ui-tabs", className)} role="tablist">{children}</div>;
}

export const PillTabs = Tabs;

export function Tooltip({ children }: BaseProps) {
  return <span className="ui-tooltip">{children}</span>;
}

export function CommandInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput className="ui-command-input" {...props} />;
}

export function SplitPane({ children, className }: BaseProps) {
  return <div className={join("ui-split-pane", className)}>{children}</div>;
}

export function ScrollArea({ children, className }: BaseProps) {
  return <div className={join("ui-scroll-area", className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={join("ui-skeleton", className)} />;
}

export function Spinner({ compact = false }: { compact?: boolean }) {
  return <span className={join("ui-spinner", compact && "compact")} aria-label="Loading" />;
}

export function Toast({ children, className }: BaseProps) {
  return <div className={join("ui-toast", className)} role="status">{children}</div>;
}

export function DropdownMenu({ children, className }: BaseProps) {
  return <div className={join("ui-dropdown-menu", className)} role="menu">{children}</div>;
}

export function Kbd({ children }: BaseProps) {
  return <kbd className="ui-kbd">{children}</kbd>;
}
