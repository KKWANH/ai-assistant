import { forwardRef, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  description?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <label
        htmlFor={inputId}
        className={[
          styles["root"]!,
          props.disabled ? styles["disabled"]! : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={styles["control"]!}>
          <input
            ref={ref}
            type="checkbox"
            id={inputId}
            className={styles["nativeInput"]!}
            {...props}
          />
          <div className={styles["box"]!} />
          <Check className={styles["checkIcon"]!} aria-hidden="true" />
        </div>
        {(label || description) && (
          <div className={styles["textStack"]!}>
            {label && (
              <span className={styles["labelText"]!}>{label}</span>
            )}
            {description && (
              <span className={styles["description"]!}>{description}</span>
            )}
          </div>
        )}
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";
