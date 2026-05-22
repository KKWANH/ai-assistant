import type { ReactNode, ButtonHTMLAttributes, MouseEventHandler } from "react";
import { Link } from "react-router-dom";
import styles from "./SidebarItem.module.css";

export interface SidebarItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  active?: boolean;
  label: string;
  meta?: ReactNode;
  depth?: number;
  /** When set, render as a react-router Link so middle/cmd-click opens a new tab. */
  to?: string;
}

export function SidebarItem({
  icon,
  active = false,
  label,
  meta,
  depth = 0,
  className = "",
  children,
  style,
  to,
  ...props
}: SidebarItemProps) {
  // Tailwind's dynamic `pl-${n}` can't be purged reliably, so we use an inline
  // padding-left for depth > 0 (the base padding is baked into the module).
  const depthStyle =
    depth > 0
      ? { paddingLeft: `${1 + depth * 0.75}rem`, ...style }
      : style;

  const cls = [
    styles["item"]!,
    active ? styles["active"]! : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      {icon && <span className={styles["icon"]!}>{icon}</span>}
      <span className={styles["labelText"]!}>{label}</span>
      {active && <span className={styles["activePill"]!} aria-hidden="true" />}
      {meta && <span className={styles["meta"]!}>{meta}</span>}
      {children}
    </>
  );

  // A real anchor — the browser then handles middle-click / cmd-click natively.
  if (to) {
    return (
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={cls}
        style={depthStyle}
        onClick={props.onClick as MouseEventHandler<HTMLAnchorElement> | undefined}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cls}
      style={depthStyle}
      {...props}
    >
      {inner}
    </button>
  );
}
