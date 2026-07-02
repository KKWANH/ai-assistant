/**
 * MarkdownContent — assistant-message markdown renderer.
 *
 * Split out so React.lazy() can keep the react-markdown + remark-gfm +
 * remark-cjk-friendly bundle (~52 kB gz) out of ChatView's initial chunk.
 * User messages don't render markdown, so on the empty home / first paint
 * we don't need this code at all.
 *
 * memo() because ReactMarkdown reparses + re-renders on every prop
 * change. Without it, each streaming-delta re-renders the parent
 * MessageBubble, which re-runs the full markdown parse on the
 * accumulated text → O(n²) parses by the time a long response is done.
 * Memoizing on `content` means we only reparse when content actually
 * grows — once per delta instead of once per re-render.
 */
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Lets `**bold**` / `*italic*` parse when the delimiters touch CJK characters
// (e.g. `**공**과`) — plain CommonMark flanking rules reject those as emphasis.
import remarkCjkFriendly from "remark-cjk-friendly";
import CodeBlockVisualization from "./CodeBlockVisualization";

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // `pre` renders only its children — the styled block wrapper lives in `code`
  // below, so this avoids react-markdown's default <pre> double-wrapping the
  // block (and, for a visualization, wrapping the iframe in a <pre>).
  pre({ children }) {
    return <>{children}</>;
  },
  // Code blocks
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith("language-");
    // A ```html / ```svg block renders as a live sandboxed preview (with a
    // code toggle) instead of a listing — the "draw me a visualization" path.
    const lang = isBlock ? className!.slice("language-".length).toLowerCase() : "";
    if (lang === "html" || lang === "svg") {
      return <CodeBlockVisualization lang={lang} code={String(children ?? "").replace(/\n$/, "")} />;
    }
    if (isBlock) {
      return (
        <pre className="my-2 rounded-md bg-surface-3 border border-border px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code
        className="px-1 rounded bg-surface-3 border border-border font-mono text-xs text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Headings
  h1({ children }) {
    return <h1 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h3>;
  },
  // Paragraphs
  p({ children }) {
    return <p className="mt-1.5 first:mt-0 leading-relaxed">{children}</p>;
  },
  // Lists
  ul({ children }) {
    return <ul className="my-1.5 ml-4 space-y-0.5 list-disc text-foreground">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-1.5 ml-4 space-y-0.5 list-decimal text-foreground">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  // Tables
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-xs border-collapse border border-border">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-surface-3">{children}</thead>;
  },
  th({ children }) {
    return <th className="border border-border px-2 py-1 text-left font-medium text-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>;
  },
  // Blockquote
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },
  // HR
  hr() {
    return <hr className="border-border my-3" />;
  },
  // Links
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground"
      >
        {children}
      </a>
    );
  },
};

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm text-foreground leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownContent;
