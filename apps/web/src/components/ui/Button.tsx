import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "destructive"
  | "subtle";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// CSS Modules: values are always defined for the class names we author.
// The non-null assertions suppress noUncheckedIndexedAccess widening.
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const variantClass: Record<ButtonVariant, string> = {
  primary:     styles["primary"]!,
  secondary:   styles["secondary"]!,
  ghost:       styles["ghost"]!,
  outline:     styles["outline"]!,
  destructive: styles["destructive"]!,
  subtle:      styles["subtle"]!,
};

const sizeClass: Record<ButtonSize, string> = {
  xs:   styles["xs"]!,
  sm:   styles["sm"]!,
  md:   styles["md"]!,
  lg:   styles["lg"]!,
  icon: styles["icon"]!,
};
/* eslint-enable @typescript-eslint/no-non-null-assertion */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      className = "",
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={[
          styles["btn"]!,
          variantClass[variant],
          sizeClass[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          leftIcon && <span className={styles["iconSlot"]!}>{leftIcon}</span>
        )}
        {children}
        {!loading && rightIcon && (
          <span className={styles["iconSlot"]!}>{rightIcon}</span>
        )}
      </button>
    );
  }
);
Button.displayName = "Button";
