import { useState } from "react";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useLogin } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { resetSession } from "../../lib/api";
import type { LoginInput } from "@ariadne/shared";

export function LoginView() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const login = useLogin();
  const { t } = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const input: LoginInput = { username: username.trim(), password };
    if (!input.username || !input.password) {
      setError(t("auth.required"));
      return;
    }
    try {
      await login.mutateAsync(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.failed"));
    }
  };

  /**
   * "Stuck on the login screen even with the right password?" path.
   * Calls the server's reset endpoint to drop the malformed cookie, then
   * full-reloads so localStorage state + react-query cache also drop.
   */
  const handleReset = async () => {
    setResetting(true);
    setResetMsg(null);
    try {
      await resetSession();
      setResetMsg(t("auth.resetDone"));
      // Hard reload to clear localStorage + react-query cache too.
      setTimeout(() => { window.location.replace("/"); }, 600);
    } catch {
      setResetMsg(t("auth.resetFailed"));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Ariadne
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.signInToContinue")}
          </p>
        </div>

        <Card className="px-6 py-7">
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <Input
              label={t("auth.username")}
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={login.isPending}
              required
            />
            <Input
              label={t("auth.password")}
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={login.isPending}
              required
            />

            {error && (
              <p className="text-xs text-destructive -mt-1">{error}</p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={login.isPending}
              className="mt-1 w-full"
            >
              {t("auth.signIn")}
            </Button>
          </form>

          {/* Recovery affordance — "I keep getting errors / 401 loop /
              works in incognito" → drop the malformed cookie and reload.
              Mounted as a small subdued link so it doesn't compete with
              the form, but is one click away when the user needs it. */}
          <div className="mt-4 pt-3 border-t border-border text-center">
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={resetting}
              className="text-2xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
            >
              {resetting ? t("auth.resetting") : t("auth.resetLink")}
            </button>
            {resetMsg && (
              <p className="text-2xs text-muted-foreground mt-1.5">{resetMsg}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
