import React from "react";
import { MarkdownRenderer } from "../../components/markdown/MarkdownRenderer.jsx";

export function MarkdownViewer({ artifact }: { artifact: { content?: string } }) {
  return <MarkdownRenderer>{artifact.content || ""}</MarkdownRenderer>;
}
