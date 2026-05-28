/**
 * markdownChunks — split a long markdown document into prompt-sized
 * chunks so a 200-page PDF doesn't blow the model's context.
 *
 * Two splitting strategies, in priority order:
 *   1. Heading-based (H1/H2): preserves logical sections. Used when the
 *      markdown has structure (markitdown's PDF output tags page
 *      breaks as "# Page N" headings; PPTX gets "# Slide N").
 *   2. Character-budget: falls back to ~chunkChars windows when no
 *      headings are present, breaking on the nearest paragraph
 *      boundary so chunks read naturally.
 *
 * Each chunk gets a 1-based index and an optional title (the heading
 * that started it). Consumers (chatContext, retrieval) can pick relevant
 * chunks instead of loading the whole document.
 */

export interface MarkdownChunk {
  index: number;
  title: string | null;
  text: string;
  chars: number;
}

/** Default chunk size — ~1k tokens. Tuned so 8 chunks fit comfortably
 *  in a 32k context window with room for the system + user prompt. */
const DEFAULT_CHUNK_CHARS = 4000;

export function chunkMarkdown(
  markdown: string,
  opts: { chunkChars?: number; maxChunks?: number } = {},
): MarkdownChunk[] {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const maxChunks = opts.maxChunks ?? 200;

  // Strategy 1: split on level-1 / level-2 headings if the doc has any.
  const headingRe = /^(#{1,2})\s+(.+)$/gm;
  const headings: Array<{ pos: number; text: string }> = [];
  for (const m of markdown.matchAll(headingRe)) {
    headings.push({ pos: m.index ?? 0, text: m[2]?.trim() ?? "" });
  }

  const chunks: MarkdownChunk[] = [];
  if (headings.length >= 2) {
    for (let i = 0; i < headings.length && chunks.length < maxChunks; i++) {
      const h = headings[i]!;
      const next = headings[i + 1];
      const text = markdown.slice(h.pos, next?.pos ?? markdown.length).trim();
      if (text.length === 0) continue;
      // If a single heading-section is larger than chunkChars*2, split
      // it further (rare but happens with monolithic PPTX exports).
      if (text.length > chunkChars * 2) {
        for (const piece of splitByBudget(text, chunkChars)) {
          chunks.push({ index: chunks.length + 1, title: h.text, text: piece, chars: piece.length });
          if (chunks.length >= maxChunks) break;
        }
      } else {
        chunks.push({ index: chunks.length + 1, title: h.text, text, chars: text.length });
      }
    }
    return chunks;
  }

  // Strategy 2: pure character budget, breaking on paragraph boundary.
  for (const piece of splitByBudget(markdown, chunkChars)) {
    if (chunks.length >= maxChunks) break;
    chunks.push({ index: chunks.length + 1, title: null, text: piece, chars: piece.length });
  }
  return chunks;
}

/** Greedy ~budget-sized chunks. Tries paragraph boundary first, then
 *  sentence, then hard cut. */
function splitByBudget(text: string, budget: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const remaining = text.length - i;
    if (remaining <= budget) {
      out.push(text.slice(i).trim());
      break;
    }
    // Look back from i+budget for a paragraph break (\n\n) within the
    // last 25% of the budget window; if none, look for any \n; finally
    // hard-cut.
    const windowStart = i + Math.floor(budget * 0.75);
    const windowEnd = i + budget;
    const para = text.lastIndexOf("\n\n", windowEnd);
    if (para >= windowStart) {
      out.push(text.slice(i, para).trim());
      i = para + 2;
      continue;
    }
    const line = text.lastIndexOf("\n", windowEnd);
    if (line >= windowStart) {
      out.push(text.slice(i, line).trim());
      i = line + 1;
      continue;
    }
    out.push(text.slice(i, windowEnd).trim());
    i = windowEnd;
  }
  return out.filter((s) => s.length > 0);
}
