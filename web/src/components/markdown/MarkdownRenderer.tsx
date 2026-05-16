import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

function safeLinkProps(href = ""): { href: string; target?: string; rel?: string } {
  if (!/^https?:\/\//i.test(href)) return { href: "" };
  return { href, target: "_blank", rel: "noreferrer" };
}

export function MarkdownRenderer({ children }: { children?: React.ReactNode }) {
  return (
    <div className="message-text" data-markdown-renderer>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeSanitize]}
        components={{
          a({ href, children: linkChildren }) {
            return <a {...safeLinkProps(href)}>{linkChildren}</a>;
          },
          code({ className, children: codeChildren, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            return (
              <code className={className} data-language={match?.[1] || ""} {...props}>
                {codeChildren}
              </code>
            );
          },
        }}
      >
        {String(children || "")}
      </ReactMarkdown>
    </div>
  );
}
