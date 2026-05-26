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
  /** Push a new toast onto the stack. */
  toast: (item: Omit<ToastItem, "id">) => void;
  /** The current stack — read by <ToastList /> wherever it's mounted. */
  toasts: ToastItem[];
  /** Dismiss a specific toast by id. */
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  toasts: [],
  dismiss: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const icons: Record<ToastVariant, ReactNode> = {
  default: null,
  success: <CheckCircle className="h-4 w-4 text-success shrink-0" />,
  error:   <AlertCircle className="h-4 w-4 text-destructive shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning shrink-0" />,
  info:    <Info className="h-4 w-4 text-info shrink-0" />,
};

/**
 * ToastProvider — state only. Mounts above I18nProvider in main.tsx, so it
 * deliberately does NOT render any i18n-dependent JSX here. The toast UI
 * stack lives in <ToastList />, which the consumer mounts *inside*
 * <I18nProvider> (see App.tsx) so useT() resolves.
 *
 * The bug this guards against: if ToastList were rendered as a sibling of
 * `children` here, it would sit OUTSIDE the I18nProvider that lives inside
 * children — and the close-button aria-label's useT() call would crash the
 * whole app on first render. (See git log for the historic regressions:
 * 7da00e6 attempted to fix this by nesting ToastList under children, but
 * the sibling-vs-descendant distinction made that fix a no-op. AH is the
 * real fix.)
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...item, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((row) => row.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback(
    (id: string) => setToasts((prev) => prev.filter((row) => row.id !== id)),
    [],
  );

  return (
    <ToastContext.Provider value={{ toast, toasts, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

/**
 * ToastList — renders the toast stack. Mount this INSIDE <I18nProvider /> so
 * useT() in the close-button label resolves. Reads `toasts` + `dismiss` off
 * ToastContext, so it works anywhere below <ToastProvider />.
 */
export function ToastList() {
  const { toasts, dismiss } = useToast();
  const { t } = useT();
  return (
    <div aria-live="polite" className={styles["container"]!}>
      {toasts.map((item) => (
        <div key={item.id} className={styles["toast"]!} role="alert">
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
  );
}
