# Tree-sitter symbol index — implementation plan

Phase D candidate. The current regex-based extractor in
`apps/server/src/services/symbolIndex.ts` gives retrieval a useful
+2.0 boost for chunks in files whose names contain a query-matched
symbol, but it misses real symbol structure (scope, parent class,
import edges). This plan upgrades that to a proper AST extractor.

This is a separate batch because the WASM-grammar lifecycle decisions
deserve their own attention — installing the wrong deps now would
either bloat the package or break installs on uncommon platforms.

---

## 1. Dependency choice

Three viable shapes, in increasing complexity:

### A — `tree-sitter` (native bindings) + per-language packages

```bash
npm i tree-sitter tree-sitter-typescript tree-sitter-python
```

- Pros: smallest surface, most idiomatic in Node, no WASM dance.
- Cons: native code. `prebuild-install` covers macOS / Linux / Windows
  for common Node versions, but Alpine and odd ARM combos can fail.
  Failure mode is "npm install errors out", which is hostile.

### B — `web-tree-sitter` + lazy WASM fetch (recommended for v1)

```bash
npm i web-tree-sitter
```

- Pros: portable; works anywhere WASM does (including browser, future
  hosted preview). 4.6 MB runtime in `node_modules` and no native code.
- Cons: each grammar is a separate `.wasm` file. We need to source
  them from somewhere (see §2).

### C — `tree-sitter-wasms` (one package, all grammars)

```bash
npm i tree-sitter-wasms
```

- Pros: trivial — every grammar is in one place.
- Cons: 51.8 MB unpacked. Punishes every install for languages
  most users don't have.

**Recommendation: B.** Ship `web-tree-sitter` as a regular dependency,
fetch only the grammars the workspace actually needs.

## 2. Grammar source + caching

The `web-tree-sitter` ecosystem has no canonical CDN. Two practical
options:

### Option B1 — pull from GitHub on first use

Each grammar's repo (`tree-sitter-typescript`, `tree-sitter-python`,
…) has tagged releases. We can fetch the prebuilt WASM if the
maintainer attaches one, or build via the tree-sitter CLI on the
user's machine (which needs `cc`).

In practice the prebuilt WASMs come from third parties — `Menci/
vscode-tree-sitter` and similar. Picking one source we trust is the
real decision.

### Option B2 — ship the WASMs we want in the repo

Bundle `typescript.wasm` (~1 MB) and `python.wasm` (~700 KB) under
`apps/server/grammars/`. ~2 MB checked-in.

- Pros: zero network, zero install branch. Works offline forever.
- Cons: repo size; grammar updates require committing new blobs.

**Recommendation: B2 for the first two languages.** TypeScript and
Python carry the vast majority of source-file weight in the workspaces
we ship as starters; bundling makes the feature reliable. Add a
lazy-fetch path later for Go / Rust / Java if a real user needs them.

Cache directory: `~/.ariadne/grammars/` for the lazy-fetch path
(survives across server restarts; can be wiped to force re-download).

## 3. SymbolProvider interface

The existing `symbolIndex.ts` becomes a chooser:

```ts
export interface SymbolProvider {
  id: string;
  /** True only if this provider successfully initialised (grammars
   *  loaded etc.). Caller falls through to the next provider on false. */
  ready: boolean;
  /** Extract symbols from one file's content. Returns empty for an
   *  unsupported language — chooser picks the next provider down. */
  extract(text: string, ext: string): Promise<Omit<SymbolRow, "workspaceId" | "path">[]>;
}
```

Boot-time order:
1. `treeSitterProvider` — if `web-tree-sitter` resolves AND grammars
   load. Set `ready = true`.
2. `regexProvider` — always ready, the current implementation.

`indexWorkspaceSymbols()` becomes:

```ts
for (const p of providers) {
  if (!p.ready) continue;
  const rows = await p.extract(text, ext);
  if (rows.length > 0 || p === regexProvider) {
    // First provider that returned anything wins; regex is the floor.
    pushed.push(...rows);
    break;
  }
}
```

## 4. Symbol shape extensions

The current `SymbolRow` has `{ name, kind, line }`. Tree-sitter
unlocks more useful columns we should add:

- `endLine: number` — for range navigation in the future UI.
- `parent?: string` — `Foo.bar` for methods inside a class.
- `signature?: string` — `function add(x: number, y: number): number`
  for tooltips.
- `exported?: boolean` — top-level vs. file-internal.

Migration: add columns via guarded `ALTER TABLE`. Old rows have nulls;
the retriever's boost logic is unaffected.

## 5. Retrieval changes

The current +2.0 nudge for path-matching symbols stays. Tree-sitter
unlocks an additional signal:

- `import` edges: a chunk in `foo.ts` that imports `Bar` becomes
  relevant to a query about `Bar` even if `foo.ts` doesn't mention
  `Bar` in its prose. New `import_edges` table:
  `(workspace_id, from_path, to_symbol, to_path)`.
- The retriever joins `import_edges` like it joins symbol matches
  today, with a smaller bonus (+0.5 — weaker signal than a direct
  symbol).

This is a Phase D-2 follow-up; do it after the basic provider lands.

## 6. Effort estimate

| Step | Batches |
|---|---|
| Add `web-tree-sitter` dep, bundle TS + Python WASM (~3 MB checked-in) | 0.5 |
| Implement `treeSitterProvider`, wire chooser, extend SymbolRow | 1 |
| Add `endLine` / `parent` / `signature` / `exported` schema + tests | 0.5 |
| Add import-edge extraction + retrieval bonus | 0.5–1 |

Total: ~2.5 batches to a complete tree-sitter integration with the
retrieval improvements that actually move the needle.

## 7. Why not now

This batch (history page + papers starter + multi-attempt UI) is
already substantial. Tree-sitter integration without the schema
extensions and the import-edge work would land as "we have a more
accurate symbol extractor but the visible behaviour is identical" —
a poor ROI for the dep weight. Better to wait one batch and ship
the whole thing as a coherent feature.

---

## 8. Decision (post-research): Option A, not B

When this plan was first drafted Option B (`web-tree-sitter` + bundled
WASMs) was recommended. After working through the actual implementation
the better pick is **Option A — native `tree-sitter` bindings shipped
as `optionalDependencies`**. Three reasons, in the criteria order the
user asked us to weigh them: performance, security, efficiency.

### Performance

Native bindings parse 5–10× faster than WASM for the same grammars
(no JS↔WASM heap marshalling for each source buffer). The indexer
runs in the background slot after every scan, so latency isn't
user-visible, but the cycles add up across hundreds of files per
workspace and across the workspaces an Ariadne instance hosts.

### Security

This is the deciding factor. Option B needs WASM grammars from
*somewhere*. The two B-paths both have weaker provenance than Option A:

- **B1 (lazy CDN fetch):** at runtime we'd be downloading binaries
  from jsDelivr or a third-party mirror, with no integrity check beyond
  HTTPS. The runtime's auto-mode classifier flagged that exact request
  earlier — for good reason: a compromised CDN or a typosquatted
  grammar package poisons every workspace scan after that.
- **B2 (bundle WASMs in the repo):** the prebuilt grammar WASMs come
  from third parties (`Menci/vscode-tree-sitter` etc.) — there's no
  signed release for most grammars. We'd be vendoring unsigned binaries.

Option A uses the npm registry, which gives us:
- Lockfile pinning (`package-lock.json` SHA per artifact).
- Signed package provenance (npm's attestation system for repos opted
  in — `tree-sitter` and the official grammars are).
- A single trust root (npm) instead of "npm for runtime + some CDN
  for grammars".

### Efficiency

`optionalDependencies` fixes the historical objection to Option A.
When the prebuilt native binary isn't available for a platform
(Alpine musl, exotic ARM combo), `npm install` skips the package
with a warning rather than failing the whole install. We already
need fallback logic for "tree-sitter didn't load" — the chooser
detects the failed dynamic import and the regex provider takes over.
Install failures become "you lose accuracy, not the server".

Other efficiency wins:
- No grammar cache directory to manage (`~/.ariadne/grammars/`
  vanishes from the design).
- No first-request lazy-load latency (parsers are loaded at boot
  with the rest of the npm deps).
- No WASM lifecycle (init runtime, instantiate per grammar, etc.).

### Trade-offs accepted

- `node_modules` weight goes up ~10 MB (tree-sitter native + two
  grammars). Not in the repo, not in the production image's working
  set after compilation.
- Platforms without prebuilt binaries silently lose tree-sitter
  symbol extraction. Mitigation: the regex floor still runs, and
  we log the fallback at boot so an operator can spot it.

### What changes vs. §1–§5

- §1: pick A (native), not B.
- §2: deleted. There are no WASM grammars to source.
- §3: chooser logic unchanged — `treeSitterProvider` just imports
  the npm modules dynamically inside a try/catch instead of loading
  WASMs.
- §4: unchanged. Schema extensions still happen.
- §5: unchanged. Import-edge follow-up still applies.
