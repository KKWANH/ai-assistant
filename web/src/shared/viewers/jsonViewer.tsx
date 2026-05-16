import React from "react";

export function JsonViewer({ artifact }: { artifact: { content?: string } }) {
  const content = artifact.content || "";
  const formatted = formatJson(content);
  return <pre>{formatted}</pre>;
}

function formatJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
