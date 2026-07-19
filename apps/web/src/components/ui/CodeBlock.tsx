/**
 * CodeBlock — a real code block: a language tag, a copy button, and syntax
 * highlighting. Shared by the chat renderer (MarkdownContent) and the docs site
 * (docsKit) so fenced code looks the same everywhere.
 *
 * highlight.js (its ~35-language "common" subset) is DYNAMICALLY imported — it
 * stays out of the entry chunk and only loads the first time a code block
 * actually renders. Colors come from theme CSS vars (see the `.hljs-*` rules in
 * globals.css), so highlighting tracks dark/light automatically.
 */
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

// Module-level singleton so every code block shares one hljs load.
let hljsPromise: Promise<typeof import("highlight.js/lib/common").default> | null = null;
function loadHljs() {
  hljsPromise ??= import("highlight.js/lib/common").then((m) => m.default);
  return hljsPromise;
}

export function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  // Highlighted HTML (hljs escapes the source, so it's safe to inject); null =
  // not highlighted yet (or highlight failed) → render the raw text meanwhile.
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadHljs()
      .then((hljs) => {
        if (cancelled) return;
        try {
          const res =
            language && hljs.getLanguage(language)
              ? hljs.highlight(code, { language, ignoreIllegals: true })
              : hljs.highlightAuto(code);
          setHtml(res.value);
        } catch {
          setHtml(null);
        }
      })
      .catch(() => {
        /* offline / chunk failed — the raw <code> fallback stays */
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-surface-3/50 px-3 py-1">
        <span className="text-2xs font-mono uppercase tracking-wider text-muted-foreground">
          {language || "text"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[0.85em] leading-relaxed font-mono text-foreground">
        {html != null ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}
