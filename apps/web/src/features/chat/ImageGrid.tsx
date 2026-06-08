/**
 * ImageGrid — renders a "find images" message's results as a responsive
 * thumbnail grid (2 columns on mobile, up to 4 on desktop). Clicking a
 * thumbnail opens a fullscreen lightbox with the full-resolution image and
 * its attribution (source, creator, date, license) so a slide can cite it.
 */
import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { ImageResult } from "@ariadne/shared";

export function ImageGrid({ images }: { images: ImageResult[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {images.map((img, i) => (
          <button
            key={`${img.imageUrl}-${i.toString()}`}
            onClick={() => setLightbox(i)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-2"
            title={`${img.title}${img.creator ? " — " + img.creator : ""}`}
          >
            <img
              src={img.thumbUrl}
              alt={img.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <p className="truncate text-2xs text-white">{img.title}</p>
              <p className="truncate text-2xs text-white/70">{img.source}</p>
            </div>
          </button>
        ))}
      </div>
      {lightbox !== null && (
        <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} onIndex={setLightbox} />
      )}
    </div>
  );
}

function Lightbox({
  images,
  index,
  onClose,
  onIndex,
}: {
  images: ImageResult[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const img = images[index];
  const prev = () => onIndex((index - 1 + images.length) % images.length);
  const next = () => onIndex((index + 1) % images.length);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length]);

  if (!img) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm text-white/60">
          {(index + 1).toString()} / {images.length.toString()}
        </span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            onClick={prev}
            className="absolute left-2 z-10 rounded-full bg-white/10 p-2 hover:bg-white/20"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6 text-white" />
          </button>
        )}
        <img src={img.imageUrl} alt={img.title} className="max-h-full max-w-full object-contain" />
        {images.length > 1 && (
          <button
            onClick={next}
            className="absolute right-2 z-10 rounded-full bg-white/10 p-2 hover:bg-white/20"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6 text-white" />
          </button>
        )}
      </div>

      <div className="p-4 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">{img.title}</p>
        {(img.creator || img.date) && (
          <p className="mt-0.5 text-sm text-white/70">{[img.creator, img.date].filter(Boolean).join(" · ")}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
          <a
            href={img.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-white"
          >
            {img.source}
            <ExternalLink className="h-3 w-3" />
          </a>
          {img.license && <span>{img.license}</span>}
        </div>
      </div>
    </div>
  );
}
