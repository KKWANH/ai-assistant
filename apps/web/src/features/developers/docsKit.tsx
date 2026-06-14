/**
 * docsKit — the rendering + utility layer for the in-app docs site.
 *
 * Reuses the app's react-markdown + remark-gfm pipeline (already shipped for
 * chat) but tunes it for documentation: anchored headings that feed an "On this
 * page" rail, copy-able code blocks with a language tag, GitHub-style callouts
 * (`> [!NOTE]`), and internal links that route through react-router instead of
 * reloading the SPA. Kept separate from the chat renderer (MarkdownContent),
 * which is intentionally compact — docs want air.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import { Check, Copy, Hash, Info, Lightbulb, AlertTriangle, AlertOctagon } from "lucide-react";
import { SystemDiagram, RequestLifecycleDiagram, DataModelDiagram } from "./diagrams";

/** Diagrams embeddable from markdown via a ```diagram fenced block (first line =
 *  id, the rest = an optional caption). Keeps architecture pages pure markdown. */
const DIAGRAMS: Record<string, () => ReactNode> = {
  system: SystemDiagram,
  "request-lifecycle": RequestLifecycleDiagram,
  "data-model": DataModelDiagram,
};

// ---------------------------------------------------------------------------
// Headings → ids → "On this page"
// ---------------------------------------------------------------------------

/** Stable slug for a heading — shared by the rendered `id` and the TOC link so
 *  they always agree. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
  /** 1-based source line — matches react-markdown's hast `node.position`, which
   *  is how the renderer looks an id back up (render-order-independent, so it's
   *  safe under React StrictMode's double-invoked render). */
  line: number;
}

/** Pull h2/h3 headings out of a markdown body for the TOC. Skips fenced code so
 *  a `# comment` inside a ```block``` never shows up as a heading. */
export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>(); // de-dup: a repeated slug gets -2, -3, …
  let inFence = false;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (m) {
      const text = m[2]!.replace(/[`*_]/g, "").trim();
      const base = slugify(text);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const id = n === 0 ? base : `${base}-${(n + 1).toString()}`;
      out.push({ depth: m[1]!.length as 2 | 3, text, id, line: i + 1 });
    }
  }
  return out;
}

/** Active-heading tracker for the TOC. Reports the last heading whose top has
 *  scrolled past a line near the top of the container — i.e. the section you're
 *  reading — and snaps to the final heading at the very bottom (so a short last
 *  section, which can't scroll to the top, still highlights). rAF-throttled. */
export function useScrollSpy(ids: string[], rootEl: HTMLElement | null): string {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  useEffect(() => {
    if (!rootEl || ids.length === 0) return;
    const LINE = 100; // px from the top of the scroll container
    let ticking = false;
    const compute = () => {
      ticking = false;
      // At the bottom, the last section wins even if it never reached the top.
      if (rootEl.scrollTop + rootEl.clientHeight >= rootEl.scrollHeight - 8) {
        setActive(ids[ids.length - 1] ?? "");
        return;
      }
      const rootTop = rootEl.getBoundingClientRect().top;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = rootEl.querySelector(`#${CSS.escape(id)}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - rootTop <= LINE) current = id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(compute);
    };
    compute();
    rootEl.addEventListener("scroll", onScroll, { passive: true });
    return () => { rootEl.removeEventListener("scroll", onScroll); };
  }, [ids, rootEl]);
  return active;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Copy-able code block with a language tag — the docs.* staple. */
export function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1400);
    });
  };
  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border/70 bg-surface-3/50 px-3 py-1.5">
        <span className="text-2xs font-mono uppercase tracking-wider text-muted-foreground">
          {language || "text"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed font-mono text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const CALLOUTS = {
  NOTE: { cls: "border-info/40 bg-info/5", label: "text-info", Icon: Info },
  TIP: { cls: "border-success/40 bg-success/5", label: "text-success", Icon: Lightbulb },
  IMPORTANT: { cls: "border-accent/40 bg-accent/5", label: "text-accent", Icon: AlertOctagon },
  WARNING: { cls: "border-warning/40 bg-warning/5", label: "text-warning", Icon: AlertTriangle },
  CAUTION: { cls: "border-destructive/40 bg-destructive/5", label: "text-destructive", Icon: AlertOctagon },
} as const;
type CalloutKind = keyof typeof CALLOUTS;

function Callout({ kind, children }: { kind: CalloutKind; children: ReactNode }) {
  const c = CALLOUTS[kind];
  const Icon = c.Icon;
  return (
    <div className={`my-4 flex gap-2.5 rounded-xl border px-3.5 py-3 ${c.cls}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.label}`} />
      <div className="min-w-0 space-y-1 text-sm leading-relaxed text-foreground/90 [&>p]:m-0">
        <p className={`text-2xs font-semibold uppercase tracking-wider ${c.label}`}>{kind.toLowerCase()}</p>
        {children}
      </div>
    </div>
  );
}

/** The leading plain-text string of a blockquote's first paragraph, or "". Both
 *  callout detection and stripping key off this exact spot, so they always agree
 *  — a token that isn't a plain-text lead (e.g. inside bold) is left as a normal
 *  blockquote rather than a callout we can't strip. */
function leadString(children: ReactNode): string {
  const arr = Array.isArray(children) ? children : [children];
  const firstEl = arr.find((c) => typeof c === "object" && c !== null) as
    | { props?: { children?: ReactNode } }
    | undefined;
  const inner = firstEl?.props?.children;
  const innerArr = Array.isArray(inner) ? inner : [inner];
  return typeof innerArr[0] === "string" ? innerArr[0] : "";
}

/** If a blockquote opens with a GitHub alert token (`[!NOTE]`), return its kind;
 *  else null. The token itself is stripped at render time by stripAlertToken. */
function calloutKind(children: ReactNode): CalloutKind | null {
  const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.exec(leadString(children));
  return m ? (m[1] as CalloutKind) : null;
}

// ---------------------------------------------------------------------------
// The docs markdown renderer
// ---------------------------------------------------------------------------

// The id comes from the precomputed (de-duped) list, looked up by the heading's
// source line — see DocsMarkdown — so the rendered anchor always matches the TOC
// (even for repeated heading text) and is stable under StrictMode's double render.
function heading(depth: 2 | 3, idForLine: (line: number | undefined) => string) {
  const Tag = (`h${depth}` as "h2" | "h3");
  const cls =
    depth === 2
      ? "group scroll-mt-24 text-xl font-semibold tracking-tight text-foreground mt-10 mb-3 pb-1.5 border-b border-border/60 first:mt-0"
      : "group scroll-mt-24 text-base font-semibold text-foreground mt-7 mb-2";
  return function H({ node, children }: { node?: { position?: { start: { line: number } } }; children?: ReactNode }) {
    const id = idForLine(node?.position?.start.line);
    return (
      <Tag id={id} className={cls}>
        <a href={`#${id}`} className="no-underline">
          {children}
          <Hash className="ml-1.5 inline h-3.5 w-3.5 -translate-y-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </a>
      </Tag>
    );
  };
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-bold tracking-tight text-foreground">{children}</h1>,
  // h2/h3 are injected per-render in DocsMarkdown (they need the de-duped ids).
  h4: ({ children }) => <h4 className="mt-5 mb-1 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-3 text-sm leading-7 text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1.5 text-sm leading-7 marker:text-muted-foreground/60 text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1.5 text-sm leading-7 marker:text-muted-foreground text-foreground/90">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  a: ({ href, children }) => {
    const internal = href?.startsWith("/") ?? false;
    if (internal) {
      return (
        <Link to={href!} className="font-medium text-accent underline-offset-2 hover:underline">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline-offset-2 hover:underline"
      >
        {children}
      </a>
    );
  },
  code: ({ className, children }) => {
    const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
    if (lang === "diagram") {
      const [id, ...caption] = String(children).trim().split("\n");
      const D = DIAGRAMS[(id ?? "").trim()];
      return (
        <figure className="my-5 rounded-xl border border-border bg-card p-4">
          {D ? <D /> : <p className="text-xs text-destructive">Unknown diagram: {id}</p>}
          {caption.length > 0 && (
            <figcaption className="mt-3 text-2xs leading-snug text-muted-foreground">
              {caption.join(" ").trim()}
            </figcaption>
          )}
        </figure>
      );
    }
    if (lang || String(children).includes("\n")) {
      return <CodeBlock language={lang} code={String(children).replace(/\n$/, "")} />;
    }
    return (
      <code className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>, // CodeBlock already renders its own <pre>
  blockquote: ({ children }) => {
    const kind = calloutKind(children);
    if (kind) {
      // Strip the leading "[!KIND]" token from the first paragraph's text.
      return <Callout kind={kind}>{stripAlertToken(children)}</Callout>;
    }
    return (
      <blockquote className="my-4 border-l-2 border-accent/50 pl-4 text-sm italic leading-7 text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-3 py-2 align-top text-foreground/85">{children}</td>,
  hr: () => <hr className="my-8 border-border" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
};

/** Remove the leading `[!KIND]` token from rendered blockquote children. */
function stripAlertToken(children: ReactNode): ReactNode {
  const arr = Array.isArray(children) ? [...children] : [children];
  const idx = arr.findIndex((c) => typeof c === "object" && c !== null);
  if (idx < 0) return children;
  const first = arr[idx] as { props?: { children?: ReactNode } };
  const inner = first.props?.children;
  const innerArr = Array.isArray(inner) ? [...inner] : [inner];
  if (typeof innerArr[0] === "string") {
    innerArr[0] = innerArr[0].replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/, "");
  }
  arr[idx] = <p key="lead" className="my-0 text-sm leading-7">{innerArr}</p>;
  return arr;
}

export const DocsMarkdown = memo(function DocsMarkdown({ body }: { body: string }) {
  // Map each heading's source line → its de-duped id (the same ids the TOC uses),
  // and have the h2/h3 components look themselves up by line. Keying on the line
  // (not render order) keeps the anchors matching the TOC even when two headings
  // share text, and is safe under StrictMode's double-invoked render.
  const idForLine = useMemo(() => {
    const byLine = new Map(extractHeadings(body).map((h) => [h.line, h.id]));
    return (line: number | undefined) => (line != null ? (byLine.get(line) ?? "") : "");
  }, [body]);
  const withHeadings = useMemo<Components>(
    () => ({ ...components, h2: heading(2, idForLine), h3: heading(3, idForLine) }),
    [idForLine],
  );
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={withHeadings}>
      {body}
    </ReactMarkdown>
  );
});
