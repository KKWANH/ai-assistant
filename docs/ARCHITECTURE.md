# Ariadne — Architecture

> **Moved.** The architecture docs now live in Ariadne's built-in documentation
> site, with interactive diagrams. Run the app and open **`/developers`** (a
> public docs site). This stub is a pointer for people browsing the repo.

| Topic | In-app page |
| --- | --- |
| System & the four channels (REST / SSE / terminal WS / postMessage) | `/developers/architecture-overview` |
| A chat message's lifecycle | `/developers/request-lifecycle` |
| Data model — the workspace as the hub | `/developers/data-model` |
| Local vs remote, the access boundary | `/developers/auth-model` |
| Custom surfaces (sandboxed iframe + the SDK) | `/developers/surfaces`, `/developers/build-a-surface` |
| Running the server + the supervisor | `/developers/running-the-server` |

Source: `apps/web/src/features/developers/docsContent.ts` (prose) and
`diagrams.tsx` (the SVG diagrams). The speed contract stays in
[`PERFORMANCE_ARCHITECTURE.md`](PERFORMANCE_ARCHITECTURE.md); the visual language
in [`DESIGN_GUIDELINE.md`](DESIGN_GUIDELINE.md).
