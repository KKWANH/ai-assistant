/**
 * CodeBlockVisualization — renders a model-emitted ```html / ```svg fenced block
 * as a live, sandboxed preview inline in the chat (with a Preview/Code toggle),
 * instead of a syntax-highlighted listing. This is the "draw me an HTML/SVG"
 * capability.
 *
 * Security: the same model as the custom-surface iframe — `sandbox="allow-scripts"`
 * with NO `allow-same-origin`. The frame gets a null origin, so model HTML cannot
 * touch the app's DOM, cookies, or localStorage, and (offline sandbox) cannot load
 * external scripts/styles/images. Content is passed via `srcDoc`, never a same-app
 * route, so there's no path for it to read app state.
 *
 * The frame auto-sizes: a tiny injected script posts its scrollHeight and the host
 * clamps it. postMessage works across the null-origin boundary; we still verify the
 * message came from THIS iframe's window before trusting it.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type VizLang = "html" | "svg";

/** Concrete rendered colours from the app so the preview matches the theme —
 *  read as computed rgb() values (works regardless of how the token is defined). */
function readThemeColors(): { bg: string; fg: string } {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") {
      return { bg: cs.backgroundColor, fg: cs.color || "#e6e6e6" };
    }
  }
  return { bg: "#0b0b0c", fg: "#e6e6e6" };
}

const RESIZE_SCRIPT =
  "<script>(function(){function p(){try{parent.postMessage({__ariadneViz:1,height:document.documentElement.scrollHeight},'*')}catch(e){}}" +
  "if(window.ResizeObserver){new ResizeObserver(p).observe(document.documentElement)}" +
  "window.addEventListener('load',p);setTimeout(p,50);p()})()<\/script>";

function buildSrcDoc(lang: VizLang, code: string, bg: string, fg: string): string {
  // A full HTML document from the model travels as-is (just splice in the resizer).
  if (lang === "html" && /<!doctype|<html[\s>]/i.test(code)) {
    return code.includes("</body>") ? code.replace("</body>", `${RESIZE_SCRIPT}</body>`) : code + RESIZE_SCRIPT;
  }
  const style =
    `<style>html,body{margin:0;padding:10px;background:${bg};color:${fg};` +
    "font-family:-apple-system,system-ui,sans-serif;font-size:14px}" +
    "svg{max-width:100%;height:auto;display:block;margin:0 auto}" +
    "*{box-sizing:border-box}</style>";
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${code}${RESIZE_SCRIPT}</body></html>`;
}

export default function CodeBlockVisualization({ lang, code }: { lang: VizLang; code: string }) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [height, setHeight] = useState(180);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const colors = useMemo(readThemeColors, []);
  const srcDoc = useMemo(() => buildSrcDoc(lang, code, colors.bg, colors.fg), [lang, code, colors]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { __ariadneViz?: number; height?: number } | undefined;
      if (data?.__ariadneViz && typeof data.height === "number") {
        setHeight(Math.max(80, Math.min(Math.ceil(data.height) + 4, 2000)));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const tab = (m: "preview" | "code", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
        mode === m ? "bg-surface-1 text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="my-2 rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-surface-3 border-b border-border">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{lang} · preview</span>
        <div className="flex gap-0.5">
          {tab("preview", "Preview")}
          {tab("code", "Code")}
        </div>
      </div>
      {mode === "preview" ? (
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={`${lang} visualization`}
          className="w-full border-0 bg-background block"
          style={{ height }}
        />
      ) : (
        <pre className="m-0 px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap bg-surface-3 text-foreground">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
