import { forwardRef, type ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "ghost" | "subtle" | "outline";
}

const sizeClass: Record<NonNullable<IconButtonProps["size"]>, string> = {
  xs: styles["xs"]!,
  sm: styles["sm"]!,
  md: styles["md"]!,
  lg: styles["lg"]!,
};

const variantClass: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  ghost:   styles["ghost"]!,
  subtle:  styles["subtle"]!,
  outline: styles["outline"]!,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      size = "md",
      variant = "ghost",
      className = "",
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={[
        styles["btn"]!,
        sizeClass[size],
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  )
);
IconButton.displayName = "IconButton";
