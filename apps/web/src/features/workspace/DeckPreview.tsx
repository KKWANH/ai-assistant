/**
 * DeckPreview — a fullscreen preview of a generated lecture deck. Each slide
 * renders as a clean white card mirroring the .pptx (title slide + content
 * slides with bullets, the per-slide image, and speaker notes).
 *
 * Each slide's imageQuery is clickable: it opens a picker backed by the real
 * image search (museum/archive sources with citations). Picking an image
 * attaches it to that slide; "이미지 적용" rebuilds the .pptx with the chosen
 * images embedded. A download button serves the real .pptx.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X, Download, FileText, Loader2, Image as ImageIcon, Search, Check } from "lucide-react";
import type { Deck, ImageResult } from "@ariadne/shared";
import { deckFileUrl, generateScript, rebuildDeck, searchImages } from "../../lib/api";

export function DeckPreview({
  workspaceId,
  deck,
  fileName,
  course,
  onClose,
}: {
  workspaceId: string;
  deck: Deck;
  fileName: string;
  course?: string;
  onClose: () => void;
}) {
  // Local, mutable copy so picked images persist across the preview session.
  const [localDeck, setLocalDeck] = useState<Deck>(deck);
  // Which slide's image picker is open (index into slides), or null.
  const [picking, setPicking] = useState<number | null>(null);

  const genScript = useMutation({
    mutationFn: () => generateScript(workspaceId, localDeck, course),
  });
  const rebuild = useMutation({
    mutationFn: () => rebuildDeck(workspaceId, localDeck),
  });

  const setSlideImage = (i: number, img: ImageResult | null) => {
    setLocalDeck((d) => ({
      ...d,
      slides: d.slides.map((s, j) =>
        j === i
          ? {
              ...s,
              imageUrl: img?.imageUrl,
              imageCredit: img
                ? [img.title, img.creator, img.source].filter(Boolean).join(" · ").slice(0, 160)
                : undefined,
            }
          : s,
      ),
    }));
    rebuild.reset(); // any prior rebuild is now stale
  };

  const pickedCount = localDeck.slides.filter((s) => s.imageUrl).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-3 text-white">
          <span className="min-w-0 truncate text-sm font-medium">
            {localDeck.title} · {(localDeck.slides.length + 1).toString()} 슬라이드
            {pickedCount > 0 && <span className="ml-2 text-white/60">이미지 {pickedCount}</span>}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {pickedCount > 0 &&
              (rebuild.isSuccess ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1.5 text-sm text-emerald-300">
                  <Check className="h-4 w-4" /> 이미지 적용됨
                </span>
              ) : (
                <button
                  onClick={() => rebuild.mutate()}
                  disabled={rebuild.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-accent/90 px-3 py-1.5 text-sm text-white hover:bg-accent disabled:opacity-60"
                  title="고른 이미지를 슬라이드에 넣어 .pptx를 다시 만듭니다"
                >
                  {rebuild.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> 적용 중…
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-4 w-4" /> 이미지 적용
                    </>
                  )}
                </button>
              ))}
            {genScript.data ? (
              <a
                href={deckFileUrl(workspaceId, genScript.data.fileName)}
                download
                className="inline-flex items-center gap-1 rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
              >
                <FileText className="h-4 w-4" /> 스크립트 다운로드
              </a>
            ) : (
              <button
                onClick={() => genScript.mutate()}
                disabled={genScript.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25 disabled:opacity-60"
              >
                {genScript.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> 스크립트 생성 중…
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" /> 스크립트 (.docx)
                  </>
                )}
              </button>
            )}
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
                <h2 className="text-2xl font-bold text-[#1A1A1A]">{localDeck.title}</h2>
                {localDeck.subtitle && <p className="mt-2 text-base text-gray-500">{localDeck.subtitle}</p>}
              </div>
            </SlideCard>

            {localDeck.slides.map((s, i) => (
              <SlideCard key={i}>
                <div className="flex gap-4">
                  <div className="min-w-0 flex-1">
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
                  </div>
                  {/* Right column: the picked image, or a button to find one. */}
                  {s.imageUrl ? (
                    <div className="w-40 shrink-0">
                      <img
                        src={s.imageUrl}
                        alt={s.imageCredit ?? ""}
                        className="h-28 w-full rounded border border-gray-200 object-cover"
                      />
                      {s.imageCredit && (
                        <p className="mt-1 truncate text-2xs text-gray-400" title={s.imageCredit}>
                          {s.imageCredit}
                        </p>
                      )}
                      <div className="mt-1 flex gap-2 text-xs">
                        <button onClick={() => setPicking(i)} className="text-gray-500 hover:text-gray-800">
                          변경
                        </button>
                        <button onClick={() => setSlideImage(i, null)} className="text-gray-500 hover:text-gray-800">
                          제거
                        </button>
                      </div>
                    </div>
                  ) : (
                    s.imageQuery && (
                      <button
                        onClick={() => setPicking(i)}
                        className="flex w-40 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-300 p-3 text-center text-xs text-gray-500 hover:border-accent hover:text-accent"
                        title={`이미지 검색: ${s.imageQuery}`}
                      >
                        <Search className="h-4 w-4" />
                        <span className="line-clamp-2">이미지 찾기: {s.imageQuery}</span>
                      </button>
                    )
                  )}
                </div>
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

      {picking !== null && localDeck.slides[picking] && (
        <ImagePicker
          query={localDeck.slides[picking].imageQuery ?? localDeck.slides[picking].title}
          onPick={(img) => {
            setSlideImage(picking, img);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** A modal that searches images for a slide and lets the lecturer pick one. */
function ImagePicker({
  query,
  onPick,
  onClose,
}: {
  query: string;
  onPick: (img: ImageResult) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(query);
  const [submitted, setSubmitted] = useState(query);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["deck-image-search", submitted],
    queryFn: () => searchImages(submitted),
    enabled: !!submitted.trim(),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSubmitted(q.trim());
            }}
            placeholder="이미지 검색어 (영어가 더 잘 찾습니다)"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <button
            onClick={() => setSubmitted(q.trim())}
            className="shrink-0 rounded-md bg-accent px-3 py-1 text-sm text-accent-foreground"
          >
            검색
          </button>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 hover:bg-surface-3" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 이미지 검색 중…
            </div>
          )}
          {isError && <p className="py-12 text-center text-sm text-muted-foreground">검색에 실패했습니다.</p>}
          {data && data.results.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">결과가 없습니다. 검색어를 바꿔보세요.</p>
          )}
          {data && data.results.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {data.results.map((img, i) => (
                <button
                  key={i}
                  onClick={() => onPick(img)}
                  className="group overflow-hidden rounded-lg border border-border bg-surface-2 text-left hover:border-accent"
                  title={`${img.title}${img.creator ? ` · ${img.creator}` : ""} · ${img.source}`}
                >
                  <img
                    src={img.thumbUrl}
                    alt={img.title}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition group-hover:opacity-90"
                  />
                  <div className="p-1.5">
                    <p className="truncate text-2xs font-medium">{img.title}</p>
                    <p className="truncate text-2xs text-muted-foreground">{img.creator ?? img.source}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {data && data.sources.length > 0 && (
            <p className="mt-3 text-2xs text-muted-foreground">출처: {data.sources.join(", ")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SlideCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-lg">{children}</div>;
}
