/**
 * TutorialPage — the dedicated `/tutorial` route. A paginated, image-rich
 * walkthrough aimed at non-technical first-time users: one concept per page,
 * a step rail to jump around, and prev/next navigation. The lightweight
 * spotlight overlay handles "where things are"; this page explains "what they
 * are and why they matter".
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useT } from "../../lib/i18n";
import { useMe } from "../../lib/queries";
import { useUIStore } from "../../lib/store";
import { Button } from "../../components/ui/Button";
import { getTutorialSections } from "./tutorialSections";

export function TutorialPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { setCreateWorkspaceOpen } = useUIStore();
  // Simple/Easy mode hides the developer-flavored pages (Agent, MCP,
  // Actions, suggestions, reports). The 12-page tour collapses to 7
  // plain-language pages for non-devs.
  const isSimple = me?.account.mode === "simple";
  const sections = getTutorialSections(t, isSimple);
  const total = sections.length;
  const [step, setStep] = useState(0);
  const section = sections[step] ?? sections[0]!;
  const isLast = step === total - 1;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {t("tutorial.page.title")}
            </h1>
            <p className="text-xs text-muted-foreground">{t("tutorial.page.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t("tutorial.page.skip")}
          </button>
        </div>

        {/* Body: step rail + content stage */}
        <div className="mt-6 flex flex-1 gap-6">
          {/* Step rail — md+ */}
          <nav className="hidden w-52 shrink-0 flex-col gap-0.5 md:flex">
            {sections.map((s, i) => {
              const active = i === step;
              const done = i < step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(i)}
                  className={[
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                    active
                      ? "bg-accent/10 font-medium text-accent"
                      : "text-muted-foreground hover:bg-surface-3 hover:text-foreground",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      active
                        ? "bg-accent text-accent-foreground"
                        : done
                          ? "bg-accent/20 text-accent"
                          : "bg-surface-3 text-muted-foreground",
                    ].join(" ")}
                  >
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="truncate">{s.shortTitle}</span>
                </button>
              );
            })}
          </nav>

          {/* Content stage */}
          <div className="flex flex-1 flex-col">
            {/* Mobile progress */}
            <div className="mb-4 flex items-center gap-2 md:hidden">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {t("tutorial.page.progress", { current: step + 1, total })}
              </span>
              <div className="flex flex-1 items-center gap-1">
                {sections.map((s, i) => (
                  <span
                    key={s.id}
                    className={[
                      "h-1 flex-1 rounded-full",
                      i <= step ? "bg-accent" : "bg-border-strong",
                    ].join(" ")}
                  />
                ))}
              </div>
            </div>

            {/* Visual */}
            <div className="flex min-h-[220px] items-center justify-center py-4">
              {section.visual}
            </div>

            {/* Copy */}
            <h2 className="mt-2 text-xl font-semibold text-foreground">{section.title}</h2>
            <div className="mt-3">{section.body}</div>
          </div>
        </div>

        {/* Footer nav */}
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            {t("tutorial.page.back")}
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:block">
            {t("tutorial.page.progress", { current: step + 1, total })}
          </span>
          {isLast ? (
            // BK4 — end on a concrete first action, not a dead-end "got it".
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => navigate("/")}>
                {t("tutorial.page.justChat")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={() => { navigate("/"); setCreateWorkspaceOpen(true); }}
              >
                {t("tutorial.page.createWorkspace")}
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
            >
              {t("tutorial.page.next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
