# code-small fixture

A 3-file TypeScript "project" used by the retrieval eval harness.

The point: ask questions like "where is symbol boost applied?" and
verify the retriever returns `src/retrieval.ts` (which contains
`applySymbolBoost`) instead of the noisy notes file.

## Files

- `src/retrieval.ts` — chunk scoring, symbol-boost stub
- `src/symbolIndex.ts` — symbol extraction stub
- `notes-distractor.md` — talks *about* retrieval without containing
  the actual implementation. Should rank below `retrieval.ts` for
  queries about the boost code.

## Why this shape

Real workspaces always have a distractor file that mentions the
target keyword but doesn't carry the answer. If the retriever just
matches on the word "symbol", the README will win. A good retriever
should prefer the file that actually defines `applySymbolBoost`.
