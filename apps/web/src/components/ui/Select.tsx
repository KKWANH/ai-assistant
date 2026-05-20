import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, className = "", id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className={styles["root"]!}>
        {label && (
          <label htmlFor={selectId} className={styles["label"]!}>
            {label}
            {props.required && (
              <span className={styles["required"]!}>*</span>
            )}
          </label>
        )}
        <div className={styles["selectWrap"]!}>
          <select
            ref={ref}
            id={selectId}
            className={[
              styles["select"]!,
              error ? styles["hasError"]! : "",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            {...props}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className={styles["chevron"]!} />
        </div>
        {error && <p className={styles["error"]!}>{error}</p>}
        {hint && !error && <p className={styles["hint"]!}>{hint}</p>}
      </div>
    );
  }
);
Select.displayName = "Select";
