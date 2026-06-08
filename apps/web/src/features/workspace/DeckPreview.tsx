/**
 * DeckPreview — a fullscreen preview of a generated lecture deck. Each slide
 * renders as a clean white card mirroring the .pptx (title slide + content
 * slides with bullets, the per-slide image suggestion, and speaker notes).
 * A download button serves the real .pptx.
 */
import type { ReactNode } from "react";
import { X, Download, Image as ImageIcon } from "lucide-react";
import type { Deck } from "@ariadne/shared";
import { deckFileUrl } from "../../lib/api";

export function DeckPreview({
  workspaceId,
  deck,
  fileName,
  onClose,
}: {
  workspaceId: string;
  deck: Deck;
  fileName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-3 text-white">
          <span className="min-w-0 truncate text-sm font-medium">
            {deck.title} · {(deck.slides.length + 1).toString()} 슬라이드
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={deckFileUrl(workspaceId, fileName)}
              download
              className="inline-flex items-center gap-1 rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
            >
              <Download className="h-4 w-4" /> 다운로드 (.pptx)
            </a>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <div className="space-y-3">
            <SlideCard>
              <div className="flex min-h-[180px] flex-col justify-center">
                <div className="mb-3 h-0.5 w-16 bg-[#C0392B]" />
                <h2 className="text-2xl font-bold text-[#1A1A1A]">{deck.title}</h2>
                {deck.subtitle && <p className="mt-2 text-base text-gray-500">{deck.subtitle}</p>}
              </div>
            </SlideCard>

            {deck.slides.map((s, i) => (
              <SlideCard key={i}>
                <h3 className="text-lg font-bold text-[#1A1A1A]">{s.title}</h3>
                <div className="my-2 h-px w-full bg-gray-200" />
                <ul className="space-y-1.5">
                  {s.bullets.map((b, j) => (
                    <li key={j} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-gray-400">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {s.imageQuery && (
                  <p className="mt-3 inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    <ImageIcon className="h-3 w-3" /> 이미지 제안: {s.imageQuery}
                  </p>
                )}
                {s.notes && (
                  <p className="mt-2 border-l-2 border-gray-200 pl-2 text-xs leading-relaxed text-gray-400">
                    발표노트: {s.notes}
                  </p>
                )}
              </SlideCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-lg">{children}</div>;
}
