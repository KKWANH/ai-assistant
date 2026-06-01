# Surface SDK reference

A **custom surface** is a React app you write that renders inside a workspace —
a domain-specific cockpit (the Portfolio dashboard is the flagship example)
built on the same engine as the rest of Ariadne. This is the reference for the
`@ariadne/surface` runtime: how a surface mounts, the data SDK it can call, the
chart components it ships with, and the gotchas that bite first-time builders.

> Scope: this documents the **runtime contract** as it actually behaves today
> (cross-checked against `apps/server/src/surface/runtime.tsx` and the host
> bridge in `apps/web/src/features/surface/SurfaceView.tsx`). Where the shipped
> TypeScript types and the runtime disagree, the **runtime** wins and the gap is
> flagged under [Gotchas](#gotchas).

---

## 1. What a surface is

- A surface is a single React component, the **default export** of your entry
  file. The host bundles it (esbuild) into a self-contained IIFE and mounts it
  in a **sandboxed iframe** (`sandbox="allow-scripts"` — no same-origin).
- Because there is no same-origin access, your code **cannot** touch the parent
  page, its cookies, or `localStorage`. All data flows through the `useAriadne()`
  bridge (below), and **the host makes the actual `/api` calls** on your behalf
  using the session cookie. Your surface never holds credentials.
- Colours, spacing, and motion come from **CSS custom properties** injected into
  the iframe's `:root` by the host (`--background`, `--foreground`, `--accent`,
  `--muted-foreground`, `--border`, `--success`, `--warning`, …). Never hardcode
  hex — use `rgb(var(--accent))` etc. so light/dark themes just work.

### Entry point

Two layouts; the build picks the **folder form first if it exists**, else the
single file:

| Layout | Path | When to use |
|---|---|---|
| Single file | `.ariadne/surface.tsx` | Most surfaces. Start here. |
| Folder form | `.ariadne/surface/index.tsx` (+ sibling `.ts`/`.tsx`) | Multi-file surfaces; `index.tsx` is the entry, esbuild pulls in whatever it imports. |

> ⚠ If **both** exist, the folder form wins (`resolveSurfaceEntry` returns
> `.ariadne/surface/index.tsx` when present). Don't leave a stale folder form
> around a single-file surface — it will silently shadow it.

Minimal surface:

```tsx
import { React, useAriadne } from "@ariadne/surface";

export default function App() {
  const ariadne = useAriadne();
  return <div style={{ padding: 16, color: "rgb(var(--foreground))" }}>Hello surface</div>;
}
```

### Build & run loop

1. Edit the source (the in-app **Edit screen** tab, or the file directly on disk).
2. Click **Build** (or `POST /api/workspaces/:id/surface/build`). esbuild bundles
   to `.ariadne/surface-dist/bundle.js`.
3. The **Custom screen** tab renders the bundle in the iframe.

Build errors are returned with `file:line:column` and shown in the Edit screen.
(There is no hot reload yet — each change is a manual rebuild. See
[Gotchas](#gotchas).)

---

## 2. Imports from `@ariadne/surface`

The runtime re-exports React and the common hooks so your bundle shares the
host's single React instance — **import them from `@ariadne/surface`, not
`react`**:

```ts
import {
  React, useState, useEffect, useCallback, useRef, useMemo,
  useAriadne,
  LineChart, BarChart, PieChart,
} from "@ariadne/surface";
```

Also exported: the TypeScript types `AriadneSDK`, `SurfaceFile`, `Quote`,
`QuoteError`, `CsvData`, `AriadneTheme`, `QuoteCalendar`, `NewsItem`,
`StageFileResult`, and the `*Props` types for each chart.

**Editor autocomplete.** When you save a surface, Ariadne writes a generated
`.ariadne/surface-env.d.ts` (the full SDK contract) and a tiny
`.ariadne/tsconfig.json` beside it. Open the workspace folder in any TS-aware
editor and `@ariadne/surface` resolves with full types — no `npm install`. The
contract is self-contained (SDK precise; React/JSX loose), and the build ignores
these files (esbuild aliases `@ariadne/surface` to the runtime). Canonical
source: `packages/surface-sdk/surface-env.d.ts`.

**SDK version.** The host exposes `API_VERSION` (currently `1`). Record what
your surface was built against with a top-level `export const apiVersion = 1`.
If the host later ships a breaking SDK change and bumps its version, it shows a
non-fatal banner over your surface ("targets v1, host runs v2…") instead of
letting a changed return shape fail silently. Optional, but recommended for
surfaces you share.

---

## 3. `useAriadne()` — the data SDK

`useAriadne()` returns a **stable** SDK object (same reference every render).
Every method is a `Promise` fulfilled by the host over postMessage; a rejected
promise carries the host's error message. Call them from effects, not during
render.

```tsx
const ariadne = useAriadne();
useEffect(() => {
  let cancelled = false;
  (async () => {
    const { rows } = await ariadne.readCsv("positions/current.csv");
    if (!cancelled) setRows(rows);
  })();
  return () => { cancelled = true; };
}, [ariadne]);
```

### Files & data

| Method | Returns | Notes |
|---|---|---|
| `listFiles()` | `SurfaceFile[]` — `{ path, size, extension, estimatedTokens }` | The whole workspace file list. |
| `readText(path)` | `string` | Raw file contents. Throws if the file is missing. |
| `readCsv(path)` | `{ headers: string[], rows: Record<string,string>[] }` | Every cell is a **string** — coerce numbers yourself (`Number(r.shares)`). Rows are keyed by header. |
| `stageFile(path, content)` | `{ runId, added, removed }` | Stages a data-file edit for review (does **not** write to disk). Deep-link the user to `/runs/:runId/diff` to apply. Same staged-diff gate the AI's `edit_file` uses. |

### Templates & runs

| Method | Returns |
|---|---|
| `listTemplates()` | `Array<{ id, name }>` |
| `runTemplate(id, input)` | the created `Run` (`input` is `Record<string,string>`) |
| `listRuns()` | `Run[]` |
| `getRun(runId)` | `Run` |

### Market data

All best-effort; per-symbol failures are dropped unless you use the `Detailed`
variant. Symbols are Yahoo-style (`AAPL`, `005930.KS`, `^GSPC`).

| Method | Returns | Notes |
|---|---|---|
| `getQuotes(symbols)` | `Quote[]` | Partial on failure (missing symbols silently dropped). |
| `getQuotesDetailed(symbols)` | `{ quotes: Quote[], errors: QuoteError[] }` | Use when you need to badge *which* symbols are unquotable and why. |
| `getFxRates(base, currencies)` | `Record<currency, number>` | Units of `base` per 1 unit of each currency. |
| `getQuoteHistory(symbol, range?, interval?)` | `Array<{ date, close }>` | `range`: `1mo`,`3mo`,`6mo`,`1y`,`2y`,`5y`,`10y`,`ytd`,`max` (default `1y`); `interval` default `1d`. |
| `getQuoteCalendars(symbols)` | earnings + ex-dividend dates per symbol | |
| `getQuoteNews(symbol, max?)` | recent headlines (default 8) | |
| `getDividendHistory(symbol, range?)` | `Array<{ date, amount }>` (default `5y`) | For total-return math. |

`Quote` carries `{ symbol, price, currency, market?, inputSymbol?, resolvedSymbol?, source? }`
plus Yahoo meta extras when available (`fiftyTwoWeekHigh/Low`, `previousClose`,
`regularMarketDayHigh/Low`, `regularMarketVolume`).

### Theme

```tsx
const { theme } = useAriadne();   // theme.mode === "dark" | "light"
```

Mostly you don't need this — bind to CSS vars and the host repaints on theme
change (the iframe is re-keyed on theme, so a toggle remounts the surface).

---

## 4. Chart components

Self-contained SVG — no external chart lib, all colours from theme tokens. Each
takes `data: Array<{ label: string; value: number }>`.

```tsx
<LineChart data={series} title="Value" width={480} height={240} />
<BarChart  data={contributions} title="Contribution (pp)" />
<PieChart  data={allocation} title="Allocation" />
```

| Component | Extra props |
|---|---|
| `LineChart` | `color?`, `compare?` (second dimmed/dashed series — same x-labels & length; y-scale spans both), `seriesLabels?: [string, string]` |
| `BarChart` | `color?` (negative values auto-render in `--destructive`) |
| `PieChart` | — (defaults `width=320 height=280`) |

`LineChart`/`BarChart` default to `480×240`. Pass a CSS-var colour string
(`"rgb(var(--info))"`) to `color`, never a hex.

---

## 5. Worked example

A surface that reads a CSV, overlays live quotes, and charts the result:

```tsx
import { React, useState, useEffect, useAriadne, BarChart } from "@ariadne/surface";

export default function App() {
  const ariadne = useAriadne();
  const [bars, setBars] = useState<Array<{ label: string; value: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { rows } = await ariadne.readCsv("positions/current.csv");
      const syms = rows.map((r) => r.symbol).filter(Boolean);
      const { quotes } = await ariadne.getQuotesDetailed(syms);
      const bySym = Object.fromEntries(quotes.map((q) => [q.symbol.toUpperCase(), q.price]));
      const data = rows.map((r) => ({
        label: r.symbol,
        value: Number(r.shares) * (bySym[r.symbol.toUpperCase()] ?? Number(r.current_price) || 0),
      }));
      if (!cancelled) setBars(data);
    })();
    return () => { cancelled = true; };
  }, [ariadne]);

  return (
    <div style={{ padding: 16, color: "rgb(var(--foreground))" }}>
      <h2 style={{ fontSize: 15, fontWeight: 600 }}>Position value</h2>
      <BarChart data={bars} />
    </div>
  );
}
```

---

## 6. Gotchas

Honest list of what trips builders up today (and what's being fixed):

- **CSV cells are always strings.** `readCsv` does no type coercion — `Number(...)`
  every numeric column, and guard `NaN` (a single `NaN` propagated into a total
  collapses the whole render to `—`).
- **A render-time crash currently blanks the iframe.** There is no surface-level
  error boundary yet, so a thrown error in your component shows *nothing* rather
  than an error — check the browser console while developing. (An error boundary
  + host-visible error reporting is the next builder-DX item.)
- **No hot reload.** Every change is Edit → Build → look. Keep the build green;
  esbuild reports `file:line:col` on failure.
- **Don't poll aggressively.** The host bridges your calls to live providers
  (Yahoo etc.) which are rate-limited; cache in state and refresh on an interval
  only while the tab is visible.
- **Folder form shadows single file.** See [Entry point](#entry-point).
- **Import React from `@ariadne/surface`**, not `react`, so you share the host's
  React instance.

---

## 7. Where things live

| Thing | Path |
|---|---|
| Runtime / SDK source | `apps/server/src/surface/runtime.tsx` |
| Host bridge (fulfills SDK calls) | `apps/web/src/features/surface/SurfaceView.tsx` |
| Bundler | `apps/server/src/services/surfaceBuild.ts` |
| Entry resolution + folder helpers | `apps/server/src/ariadneFolder.ts` |
| Reference surface (multi-file) | `apps/server/src/surface-templates/portfolio-v2/` |
