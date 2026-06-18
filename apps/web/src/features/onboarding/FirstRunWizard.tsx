/**
 * FirstRunWizard — desktop onboarding. On the first launch of the desktop app
 * (ARIADNE_DESKTOP=1) with no real provider configured, a stranger who just
 * double-clicked Ariadne gets a welcome + a place to paste an API key, instead
 * of an empty app. Shows once: dismissed (localStorage) or once a key is set.
 * Web builds never see it (me.desktop is absent).
 */
import { useState } from "react";
import { PROVIDERS, PROVIDER_LABELS } from "@ariadne/shared";
import type { ProviderId } from "@ariadne/shared";
import { useMe, useProviderStatus, useSetProviderKey } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { useToast } from "../../components/ui/Toast";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";

const DONE_KEY = "ariadne.firstRunDone.v1";
// Providers that take a pasted API key (mock needs none; ollama/vllm are
// local / self-hosted and configured by URL, not a key field).
const KEYABLE = PROVIDERS.filter((p) => !["mock", "ollama", "vllm"].includes(p));

export function FirstRunWizard() {
  const { t } = useT();
  const { toast } = useToast();
  const { data: me } = useMe();
  const { data: status } = useProviderStatus();
  const setKey = useSetProviderKey();
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
  });
  const [provider, setProvider] = useState<ProviderId>((KEYABLE[0] as ProviderId) ?? "anthropic");
  const [apiKey, setApiKey] = useState("");

  // Desktop shell only, and only before any real provider is configured.
  const hasRealProvider = (status ?? []).some((p) => p.configured && p.id !== "mock");
  const open = me?.desktop === true && status !== undefined && !hasRealProvider && !done;

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode — in-memory only */ }
    setDone(true);
  };

  const save = async () => {
    const k = apiKey.trim();
    if (!k) return;
    try {
      await setKey.mutateAsync({ id: provider, key: k });
      finish();
    } catch {
      toast({ title: t("firstRun.saveFailed"), variant: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={finish} title={t("firstRun.title")} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground leading-relaxed">{t("firstRun.body")}</p>
        <div className="flex flex-col gap-2.5">
          <Select
            label={t("firstRun.providerLabel")}
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            options={KEYABLE.map((p) => ({ value: p, label: PROVIDER_LABELS[p as ProviderId] }))}
          />
          <Input
            type="password"
            label={t("firstRun.keyLabel")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("firstRun.keyPlaceholder")}
            autoFocus
          />
          <p className="text-2xs text-muted-foreground leading-relaxed">{t("firstRun.keyHint")}</p>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={finish}>
            {t("firstRun.skip")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!apiKey.trim() || setKey.isPending}
            loading={setKey.isPending}
            onClick={() => void save()}
          >
            {t("firstRun.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
