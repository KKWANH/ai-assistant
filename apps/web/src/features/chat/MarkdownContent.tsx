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
import { CodeBlock } from "../../components/ui/CodeBlock";

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
    const lang = className?.startsWith("language-")
      ? className.slice("language-".length).toLowerCase()
      : "";
    // A fenced block WITHOUT a language tag gets no `language-*` class, so also
    // treat multi-line content as a block — otherwise a plain ``` block (common
    // in answers: logs, shell output) falls to the inline branch and, since `pre`
    // renders only its children, its newlines collapse into one run.
    const isBlock = !!lang || String(children ?? "").includes("\n");
    if (lang === "html" || lang === "svg") {
      return <CodeBlockVisualization lang={lang} code={String(children ?? "").replace(/\n$/, "")} />;
    }
    if (isBlock) {
      return <CodeBlock language={lang || undefined} code={String(children ?? "").replace(/\n$/, "")} />;
    }
    return (
      <code
        className="px-1 rounded bg-surface-3 border border-border font-mono text-[0.9em] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Headings — compact, message-scale (docs override these with a larger,
  // anchored hierarchy). Em-based: one step above the adjustable body size so
  // structure stays scannable at every chat-font setting.
  h1({ children }) {
    return <h1 className="text-[1.2em] font-semibold mt-4 mb-2 text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-[1.08em] font-semibold mt-3.5 mb-1.5 text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-[1em] font-semibold mt-2.5 mb-1 text-foreground">{children}</h3>;
  },
};

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    // Body size comes from the --chat-font var (Settings → 화면, default 16px)
    // with a roomier line height — assistant answers are long-form reading, and
    // the old denser 14px read as cramped (user feedback). Headings/code inside
    // are em-based so everything scales with the setting together.
    <div className="text-foreground leading-[1.75]" style={{ fontSize: "var(--chat-font, 16px)" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownContent;
