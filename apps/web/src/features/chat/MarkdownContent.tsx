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
import { baseMarkdownComponents } from "../../lib/markdownBase";

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Shared body prose (paragraphs, lists, tables, quotes, rules, links).
  ...baseMarkdownComponents,
  // `pre` renders only its children — the styled block wrapper lives in `code`
  // below, so this avoids react-markdown's default <pre> double-wrapping the
  // block (and, for a visualization, wrapping the iframe in a <pre>).
  pre({ children }) {
    return <>{children}</>;
  },
  // Code blocks — chat-specific: a ```html / ```svg block renders as a live
  // sandboxed preview (with a code toggle) instead of a listing.
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith("language-");
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
  // Headings — compact, message-scale (docs override these with a larger,
  // anchored hierarchy).
  h1({ children }) {
    return <h1 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h3>;
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
