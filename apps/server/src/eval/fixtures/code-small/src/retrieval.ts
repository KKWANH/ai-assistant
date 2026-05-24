/**
 * Tiny demo retrieval module — exists so the eval harness can ask
 * "find the file with the symbol boost code" and check the right file
 * comes back. NOT the real apps/server retrieval; this is the fixture.
 */

const SYMBOL_BOOST = 2.0;

interface Chunk {
  path: string;
  body: string;
  score: number;
}

export function applySymbolBoost(chunks: Chunk[], symbolPaths: Set<string>): Chunk[] {
  return chunks.map((c) =>
    symbolPaths.has(c.path) ? { ...c, score: c.score + SYMBOL_BOOST } : c,
  );
}

export function scoreChunk(text: string, tokens: string[]): number {
  let score = 0;
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    if (lower.includes(tok)) score += 1;
  }
  return score;
}
