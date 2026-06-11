/**
 * DocPreview — a fullscreen preview of a generated course deliverable (handout,
 * worksheet, reading list, or syllabus entry). Renders the title + heading/body
 * sections and a .docx download. A reading list carries a fabrication caveat,
 * since LLM-suggested citations need checking before use. Mirrors DeckPreview.
 */
import { Download, X, AlertTriangle } from "lucide-react";
import type { GeneratedDoc, DocType } from "../types.js";
import { deckFileUrl } from "./api";

export function DocPreview({
  workspaceId,
  type,
  doc,
  fileName,
  label,
  onClose,
}: {
  workspaceId: string;
  type: DocType;
  doc: GeneratedDoc;
  fileName: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-3 text-white">
          <span className="min-w-0 truncate text-sm font-medium">{doc.title}</span>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={deckFileUrl(workspaceId, fileName)}
              className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-sm text-white hover:bg-white/20"
            >
              <Download className="h-4 w-4" /> .docx
            </a>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-t-xl bg-card p-4 sm:p-6">
          <div className="mb-1 text-xs text-muted-foreground">{label}</div>
          <h2 className="mb-4 text-lg font-semibold">{doc.title}</h2>
          {type === "reading" && (
            <p className="mb-4 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> AI 추천 목록 — 실제 존재·서지정보는 확인 후 사용하세요.
            </p>
          )}
          <div className="space-y-4">
            {doc.sections.map((s, i) => (
              <div key={i}>
                {s.heading && <h3 className="mb-1 text-sm font-semibold text-foreground">{s.heading}</h3>}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
