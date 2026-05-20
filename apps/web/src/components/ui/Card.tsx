import { type HTMLAttributes, forwardRef } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, selected, className = "", children, ...props }, ref) => (
    <div
      ref={ref}
      className={[
        styles["card"]!,
        interactive ? styles["interactive"]! : "",
        selected ? styles["selected"]! : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  )
);
Card.displayName = "Card";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: 1 | 2 | 3;
}

const surfaceClass: Record<1 | 2 | 3, string> = {
  1: styles["surface1"]!,
  2: styles["surface2"]!,
  3: styles["surface3"]!,
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ level = 1, className = "", children, ...props }, ref) => (
    <div
      ref={ref}
      className={[surfaceClass[level], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  )
);
Surface.displayName = "Surface";
