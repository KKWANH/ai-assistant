# @ariadne/surface-sdk

The canonical TypeScript contract for the `@ariadne/surface` module that custom
surfaces import. It exists so a builder editing `.ariadne/surface.tsx` in their
own editor gets **autocomplete and type-checking for the SDK** — even though a
workspace is a sandboxed folder with no `node_modules`.

## How it reaches a workspace

`surface-env.d.ts` is **self-contained** (the Ariadne SDK is typed precisely;
React hooks and JSX are declared loosely so it needs no `@types/react`). When a
surface is saved, the server copies it into the workspace as
`.ariadne/surface-env.d.ts` and writes a tiny `.ariadne/tsconfig.json` that
includes it. Opening the surface in VS Code (or any TS-aware editor) then
resolves `import { useAriadne, LineChart } from "@ariadne/surface"` with full
types. No install step.

The copy inside a workspace is generated — **don't edit it**. Edit
`surface-env.d.ts` here and it re-seeds on the next surface save.

## Keep in sync

This is a hand-authored mirror of the runtime the build actually bundles:
`apps/server/src/surface/runtime.tsx`. When you add/change an SDK method or a
chart prop there, update `surface-env.d.ts` (and `docs/SURFACE_SDK.md`) to match.

> The build itself does not use this file — esbuild aliases `@ariadne/surface`
> to `runtime.tsx`. This contract is purely for the editor.
