# notes — design discussion

Loose notes from a design conversation about retrieval and symbol
boosting. We discussed where the symbol bonus should live in the
pipeline — at scoring time vs at chunking time — and what the magic
number should be.

The boost itself is not implemented in this file. It lives in
`src/retrieval.ts` under `applySymbolBoost`. This file is mostly
prose musing on why the bonus is + 2.0 rather than something larger.

Other topics covered: chunk size, how `applySymbolBoost` interacts
with embedding similarity, why scoring should be deterministic, why
the symbol index belongs in its own table, what we should do when
the symbol matches a method name shared across files.
