import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

function safeLinkProps(href = "") {
  if (!/^https?:\/\//i.test(href)) return { href: "" };
  return { href, target: "_blank", rel: "noreferrer" };
}

export function MarkdownRenderer({ children }) {
  return (
    <div className="message-text" data-markdown-renderer>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
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
