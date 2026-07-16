/**
 * Shared markdown element renderers — the single source of truth for how body
 * prose (paragraphs, lists, tables, quotes, rules, links) looks across the app.
 *
 * Both the chat message renderer (features/chat/MarkdownContent) and the in-app
 * docs site (features/developers/docsKit) build on this set so the body copy
 * renders from ONE theme instead of two hand-kept copies. Each surface then adds
 * only what's special to it — chat: live html/svg previews; docs: anchored
 * headings, GitHub callouts, embedded diagrams, and internal SPA routing — by
 * spreading this object and overriding those keys.
 */
import type { Components } from "react-markdown";

export const baseMarkdownComponents: Components = {
  p: ({ children }) => <p className="mt-1.5 first:mt-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 ml-4 space-y-0.5 list-disc text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 space-y-0.5 list-decimal text-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse border border-border">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-3">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium text-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 text-foreground/80">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
};
