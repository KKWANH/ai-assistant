import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { IconButton } from "./IconButton";
import { useT } from "../../lib/i18n";
import styles from "./Toast.module.css";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const icons: Record<ToastVariant, ReactNode> = {
  default: null,
  success: <CheckCircle className="h-4 w-4 text-success shrink-0" />,
  error:   <AlertCircle className="h-4 w-4 text-destructive shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning shrink-0" />,
  info:    <Info className="h-4 w-4 text-info shrink-0" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...item, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((row) => row.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) =>
    setToasts((prev) => prev.filter((row) => row.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className={styles["container"]!}
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={styles["toast"]!}
            role="alert"
          >
            {icons[item.variant ?? "default"]}
            <div className={styles["content"]!}>
              <p className={styles["toastTitle"]!}>{item.title}</p>
              {item.description && (
                <p className={styles["toastDescription"]!}>{item.description}</p>
              )}
            </div>
            <IconButton label={t("common.close")} size="xs" onClick={() => dismiss(item.id)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
