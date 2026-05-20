import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftElement?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftElement, className = "", id, ...props }, ref) => {
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
        <div className={styles["inputWrap"]!}>
          {leftElement && (
            <span className={styles["leftSlot"]!}>{leftElement}</span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              styles["input"]!,
              leftElement ? styles["withLeft"]! : "",
              error ? styles["hasError"]! : "",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            {...props}
          />
        </div>
        {error && <p className={styles["error"]!}>{error}</p>}
        {hint && !error && <p className={styles["hint"]!}>{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
