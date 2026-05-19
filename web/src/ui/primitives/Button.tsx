import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "primary" | "ghost" | "danger";
}

export function Button({ children, icon, variant = "ghost", ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]}`} {...props}>
      {icon}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
