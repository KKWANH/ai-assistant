import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { IconButton } from "./IconButton";
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...item, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className={styles["container"]!}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={styles["toast"]!}
            role="alert"
          >
            {icons[t.variant ?? "default"]}
            <div className={styles["content"]!}>
              <p className={styles["toastTitle"]!}>{t.title}</p>
              {t.description && (
                <p className={styles["toastDescription"]!}>{t.description}</p>
              )}
            </div>
            <IconButton label="Dismiss" size="xs" onClick={() => dismiss(t.id)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
