import { useEffect, type ReactNode, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";
import { useT } from "../../lib/i18n";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClass: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: styles["sm"]!,
  md: styles["md"]!,
  lg: styles["lg"]!,
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
  size = "md",
}: DialogProps) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles["overlay"]!}
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? "dialog-title" : undefined}
    >
      <div
        className={styles["backdrop"]!}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className={[
          styles["panel"]!,
          sizeClass[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {(title || description) && (
          <div className={styles["header"]!}>
            <div>
              {title && (
                <h2 id="dialog-title" className={styles["title"]!}>
                  {title}
                </h2>
              )}
              {description && (
                <p className={styles["description"]!}>{description}</p>
              )}
            </div>
            <IconButton label={t("common.close")} size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className={styles["body"]!}>{children}</div>
      </div>
    </div>
  );
}
