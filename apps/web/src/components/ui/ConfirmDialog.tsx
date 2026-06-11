/**
 * In-app confirm / prompt dialogs — a Promise-based replacement for the
 * browser's blocking window.confirm() / window.prompt(). Those native dialogs
 * are unstyled, thread-blocking, and (the reason this exists) broken on mobile
 * — a phone shows them cramped and the prompt's text field is unusable.
 *
 * Usage:
 *   const { confirm, promptText } = useConfirm();
 *   if (await confirm({ message: t("…"), danger: true })) { … }
 *   const name = await promptText({ title: t("…"), placeholder: "…" });
 *   if (name) { … }   // null = cancelled
 *
 * Mirrors the Toast provider pattern: <ConfirmProvider> holds the request +
 * renders the dialog; it must mount INSIDE <I18nProvider> because the default
 * button labels call useT().
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { useT } from "../../lib/i18n";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (delete / discard flows). */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmContextValue {
  /** Resolves true on confirm, false on cancel/backdrop/Esc. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolves the entered string on confirm, null on cancel. */
  promptText: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
  promptText: () => Promise.resolve(null),
});

export function useConfirm(): ConfirmContextValue {
  return useContext(ConfirmContext);
}

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ kind: "confirm", opts, resolve })),
    [],
  );

  const promptText = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setRequest({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  // Cancel path: backdrop click, Esc, or the Cancel button.
  const handleClose = useCallback(() => {
    if (!request) return;
    if (request.kind === "prompt") request.resolve(null);
    else request.resolve(false);
    setRequest(null);
  }, [request]);

  // Confirm path: the primary button (or Enter inside the prompt input).
  const handleConfirm = useCallback(() => {
    if (!request) return;
    if (request.kind === "prompt") request.resolve(value);
    else request.resolve(true);
    setRequest(null);
  }, [request, value]);

  const danger = request?.kind === "confirm" && request.opts.danger === true;

  return (
    <ConfirmContext.Provider value={{ confirm, promptText }}>
      {children}
      <Dialog open={request !== null} onClose={handleClose} title={request?.opts.title} size="sm">
        {request && (
          <div className="flex flex-col gap-4">
            {request.opts.message != null && (
              <div className="text-sm text-muted-foreground whitespace-pre-line">
                {request.opts.message}
              </div>
            )}
            {request.kind === "prompt" && (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirm();
                  }
                }}
                placeholder={request.opts.placeholder}
                // text-base (16px) so iOS Safari doesn't auto-zoom on focus.
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                {request.opts.cancelLabel ?? t("common.cancel")}
              </Button>
              <Button variant={danger ? "destructive" : "primary"} size="sm" onClick={handleConfirm}>
                {request.opts.confirmLabel ?? (danger ? t("common.delete") : t("common.confirm"))}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
