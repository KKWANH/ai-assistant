import { forwardRef, type ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Optional second line shown in a rich Tooltip on hover/focus. */
  description?: string;
  /** Side the Tooltip opens on (only used when `description` is set). */
  tooltipSide?: "top" | "bottom" | "left" | "right";
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
      description,
      tooltipSide = "bottom",
      size = "md",
      variant = "ghost",
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    const btn = (
      <button
        ref={ref}
        aria-label={label}
        title={description ? undefined : label}
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
    );

    if (!description) return btn;
    return (
      <Tooltip
        side={tooltipSide}
        delay={250}
        rich
        content={
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{label}</span>
            <span className="text-muted-foreground">{description}</span>
          </div>
        }
      >
        {btn}
      </Tooltip>
    );
  }
);
IconButton.displayName = "IconButton";
