/**
 * TutorialOverlay — lightweight internal guided tour (no external library).
 * Auto-runs on first visit; re-launchable from the top-bar Help button.
 *
 * Visibility: the current step's target is scrolled into view, lit by a
 * bright accent ring + glow that cuts through a dimmed backdrop, and the
 * step card is anchored next to it with a pointer.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useUIStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { getTourSteps } from "./steps";

const SEEN_KEY = "ariadne.tutorialSeen";
const CARD_WIDTH = 360;
const GAP = 16;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function TutorialOverlay() {
  const { tutorialOpen, setTutorialOpen } = useUIStore();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const navigate = useNavigate();

  // Keep only steps whose spotlight target actually exists right now, so the
  // tour adapts to the mode/layout instead of pointing at nothing — easy mode
  // hides the command/help/workspaces targets, so those steps drop out and the
  // tour shows welcome → new-chat → composer → done. Steps with no target always
  // stay. Re-evaluated whenever the tour (re)opens.
  const allSteps = getTourSteps(t);
  const TOUR_STEPS = useMemo(
    () =>
      allSteps.filter(
        (s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`) !== null,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tutorialOpen, t],
  );

  // Auto-launch once, on the very first visit. Skipped on small screens —
  // the tour spotlights desktop sidebar/top-bar targets.
  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY) && window.innerWidth >= 768) {
      setTutorialOpen(true);
    }
  }, [setTutorialOpen]);

  // Reset to the first step whenever the tour (re)opens.
  useEffect(() => {
    if (tutorialOpen) setStep(0);
  }, [tutorialOpen]);

  const current = TOUR_STEPS[step];

  // Scroll the target into view, then track its position.
  useLayoutEffect(() => {
    if (!tutorialOpen || !current?.target) {
      setRect(null);
      return;
    }
    const sel = `[data-tour="${current.target}"]`;
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const measure = () => {
      const node = document.querySelector(sel);
      setRect(node ? node.getBoundingClientRect() : null);
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // Depend on `step`, not `current` — getTourSteps() returns a fresh array
    // each render, so `current` changes identity constantly and would re-run
    // this effect (re-scrolling the target) on every render.
  }, [tutorialOpen, step]);

  // Escape closes the tour (same as Skip).
  useEffect(() => {
    if (!tutorialOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        localStorage.setItem(SEEN_KEY, "1");
        setTutorialOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tutorialOpen, setTutorialOpen]);

  if (!tutorialOpen || !current) return null;

  const isLast = step === TOUR_STEPS.length - 1;
  const finish = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setTutorialOpen(false);
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let cardStyle: React.CSSProperties;
  let placeBelow = true;
  let arrowLeft = 0;
  let cardLeft = 0;

  if (rect) {
    placeBelow = rect.bottom < vh * 0.6;
    cardLeft = clamp(
      rect.left + rect.width / 2 - CARD_WIDTH / 2,
      GAP,
      vw - CARD_WIDTH - GAP
    );
    arrowLeft = clamp(rect.left + rect.width / 2 - cardLeft, 20, CARD_WIDTH - 20);
    cardStyle = placeBelow
      ? { top: rect.bottom + GAP, left: cardLeft, width: CARD_WIDTH }
      : { bottom: vh - rect.top + GAP, left: cardLeft, width: CARD_WIDTH };
  } else {
    cardStyle = {
      top: "50%",
      left: "50%",
      width: CARD_WIDTH,
      transform: "translate(-50%, -50%)",
    };
  }

  return createPortal(
    // The outer layer captures pointer events so the app is inert mid-tour;
    // clicking the dimmed area (anywhere but the card) dismisses the tour.
    <div className="fixed inset-0 z-[var(--z-tutorial)]" onClick={finish}>
      {rect ? (
        // Spotlight: dimmer (huge box-shadow) + bright accent ring + glow.
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              "0 0 0 9999px rgba(0,0,0,0.66)," +
              "0 0 0 2px rgb(var(--accent))," +
              "0 0 26px 6px color-mix(in srgb, rgb(var(--accent)) 60%, transparent)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div className="absolute" style={cardStyle} onClick={(e) => e.stopPropagation()}>
        {/* Pointer toward the target */}
        {rect && (
          <div
            className="absolute h-3 w-3 rotate-45 bg-card border-border"
            style={
              placeBelow
                ? { top: -6, left: arrowLeft, borderTopWidth: 1, borderLeftWidth: 1 }
                : {
                    bottom: -6,
                    left: arrowLeft,
                    borderBottomWidth: 1,
                    borderRightWidth: 1,
                  }
            }
          />
        )}
        <div className="relative rounded-2xl border border-border bg-card/85 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-inset ring-white/[0.1] shadow-2xl">
          <div className="flex items-start justify-between gap-4 px-5 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-accent">
                {step + 1}/{TOUR_STEPS.length}
              </span>
              <h2 className="text-sm font-semibold text-foreground">
                {current.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={finish}
              aria-label={t("tutorial.skip")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="px-5 pt-2 text-xs leading-relaxed text-muted-foreground">
            {current.body}
          </p>
          <div className="flex flex-wrap items-center gap-2 gap-y-3 px-5 py-4 mt-2">
            <div className="flex items-center gap-1.5">
              {TOUR_STEPS.map((s, i) => (
                <span
                  key={s.id}
                  className={[
                    "h-1.5 rounded-full transition-all",
                    i === step ? "w-4 bg-accent" : "w-1.5 bg-border-strong",
                  ].join(" ")}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {step > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
                >
                  {t("tutorial.back")}
                </Button>
              )}
              {isLast ? (
                <>
                  <Button variant="ghost" size="sm" type="button" onClick={finish}>
                    {t("tutorial.done")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      finish();
                      navigate("/tutorial");
                    }}
                  >
                    {t("tutorial.viewFull")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
                >
                  {t("tutorial.next")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
