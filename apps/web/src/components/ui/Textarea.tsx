import { forwardRef, type TextareaHTMLAttributes } from "react";
import styles from "./Textarea.module.css";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className={styles["root"]!}>
        {label && (
          <label htmlFor={inputId} className={styles["label"]!}>
            {label}
            {props.required && (
              <span className={styles["required"]!}>*</span>
            )}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={[
            styles["textarea"]!,
            error ? styles["hasError"]! : "",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          {...props}
        />
        {error && <p className={styles["error"]!}>{error}</p>}
        {hint && !error && <p className={styles["hint"]!}>{hint}</p>}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
