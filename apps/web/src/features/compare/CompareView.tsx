/**
 * Compare models — one prompt, N models, side-by-side answers. The cross-vendor
 * "second opinion" single-vendor chat UIs can't offer: put a local Ollama model
 * next to Claude next to GPT on the same question and judge them together.
 *
 * Built from the shared design-system primitives (Button/Textarea/Card) + tokens
 * so it stays visually consistent with the rest of the app by construction.
 */
import { useState } from "react";
import { Columns2 } from "lucide-react";
import { useT } from "../../lib/i18n";
import { useProviderStatus } from "../../lib/queries";
import { compareModels, type CompareResult } from "../../lib/api";
import { Spinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import { Textarea } from "../../components/ui/Textarea";
import { Card } from "../../components/ui/Card";

interface Picked {
  provider: string;
  model: string;
}
const keyOf = (p: Picked): string => `${p.provider}:${p.model}`;
const MAX_MODELS = 4;

export function CompareView() {
  const { t } = useT();
  const { data: providers } = useProviderStatus();
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = (providers ?? []).filter((p) => p.configured);

  const toggle = (provider: string, model: string): void => {
    const k = `${provider}:${model}`;
    setPicked((prev) => {
      if (prev.some((p) => keyOf(p) === k)) return prev.filter((p) => keyOf(p) !== k);
      if (prev.length >= MAX_MODELS) return prev;
      return [...prev, { provider, model }];
    });
  };

  const canRun = prompt.trim().length > 0 && picked.length >= 2 && !loading;

  const run = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await compareModels(prompt.trim(), picked);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Placeholder cards while loading so the grid doesn't jump when answers land.
  const cards: CompareResult[] =
    results ?? picked.map((p) => ({ provider: p.provider, model: p.model, text: "" }));
  const gridCols = picked.length >= 3 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 flex flex-col gap-5">
        <header className="flex items-center gap-2">
          <Columns2 className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-semibold text-foreground">{t("compare.title")}</h1>
        </header>
        <p className="text-sm text-muted-foreground -mt-3">{t("compare.subtitle")}</p>

        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("compare.promptPlaceholder")}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("compare.pickModels")} ({picked.length}/{MAX_MODELS})
          </span>
          {configured.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("compare.noProviders")}</p>
          ) : (
            configured.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground w-28 shrink-0">{p.label}</span>
                {p.models.map((m) => (
                  <Button
                    key={m}
                    size="xs"
                    variant={picked.some((x) => keyOf(x) === `${p.id}:${m}`) ? "primary" : "outline"}
                    onClick={() => toggle(p.id, m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" loading={loading} disabled={!canRun} onClick={() => void run()}>
            {t("compare.run")}
          </Button>
          {picked.length < 2 && (
            <span className="text-2xs text-muted-foreground">{t("compare.needTwo")}</span>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {(loading || results) && (
          <div className={`grid grid-cols-1 gap-4 ${gridCols}`}>
            {cards.map((r, i) => (
              <Card
                key={`${r.provider}:${r.model}:${i.toString()}`}
                className="flex flex-col gap-2 min-h-[130px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground truncate">{r.model}</span>
                  <span className="text-2xs text-muted-foreground shrink-0 ml-2">{r.provider}</span>
                </div>
                {loading && !results ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Spinner size="sm" label={t("compare.running")} />
                  </div>
                ) : r.error ? (
                  <p className="text-xs text-destructive">{r.error}</p>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {r.text}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
