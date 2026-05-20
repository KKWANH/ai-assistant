import type { ReactNode, ButtonHTMLAttributes } from "react";
import styles from "./SidebarItem.module.css";

export interface SidebarItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  active?: boolean;
  label: string;
  meta?: ReactNode;
  depth?: number;
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
  ...props
}: SidebarItemProps) {
  // Tailwind's dynamic `pl-${n}` can't be purged reliably, so we use an inline
  // padding-left for depth > 0 (the base padding is baked into the module).
  const depthStyle =
    depth > 0
      ? { paddingLeft: `${1 + depth * 0.75}rem`, ...style }
      : style;

  return (
    <button
      aria-current={active ? "page" : undefined}
      className={[
        styles["item"]!,
        active ? styles["active"]! : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={depthStyle}
      {...props}
    >
      {icon && (
        <span className={styles["icon"]!}>{icon}</span>
      )}
      <span className={styles["labelText"]!}>{label}</span>
      {active && (
        <span className={styles["activePill"]!} aria-hidden="true" />
      )}
      {meta && <span className={styles["meta"]!}>{meta}</span>}
      {children}
    </button>
  );
}
