# Priority Progress

Updated: 2026-05-16

| Priority | Item | Status | Notes |
| --- | --- | --- | --- |
| First | Redefine information architecture: reduce Action surface, split Chat Tool vs Project App | Mostly done | Sidebar now navigates to `/apps-tools`; legacy `/actions` remains as a compatibility alias for old links/tests. Home only shows server-backed Chat Tools; Apps & Tools splits `chat_tool` and `workflow_app`. |
| Next | Frontend TS migration: ProjectDashboard.jsx, ContextPanel.jsx, LegacyApp.jsx, api.js | Partial+ | `api.js` is now typed `api.ts`. `LegacyApp`, `CenterPane`, `ProjectDashboard`, `ContextPanel`, `WorkspaceSidebar`, `StartPane`, and `AppsToolsCatalogPage` are now `.tsx` runtime files. Remaining: remove `ts-nocheck` by adding strict prop/domain types, then convert visual helper components. |
| Next | Typed data layer: React Query client hooks | Partial+ | Added hooks for workspace, home, runtime, OpenClaw, automations, session, project config, runs, artifacts, connections. Dashboard no longer receives `fetchJson` from CenterPane. Remaining: move inspector/sidebar/project panels to typed mutations/hooks. |
| Parallel | PDF extraction pipeline replacement | Done | Replaced raw PDF byte scraping with PyMuPDF, pypdf, literal fallback, and quality gate. Low-quality extraction fails honestly instead of emitting corrupt summaries. |
| Next | Trusted workspace viewers | Partial | Added trusted `/api/project-viewers/<project>/investment-rebalance` payload endpoint, manifest read, reload/build status, and sandbox iframe route. Remaining: actual TS bundling for project-local viewer packages. |
| Later | Project connections runtime | Partial+ | Approved linked resources now resolve into `resolvedImports` aliases, latest artifact metadata, run `inputs.resolved_imports`, and process env aliases such as `AIWS_IMPORT_FOODS_PATH`. Remaining: app-specific runners should map those aliases into formal input schemas. |
| Last | Large visual redesign | Not started | Keep last. Product model and runtime contracts still need more consolidation before another broad visual pass. |

## Still Open

- Remove `ts-nocheck` from `LegacyApp.tsx`, `CenterPane.tsx`, `ProjectDashboard.tsx`, and `ContextPanel.tsx`.
- Convert remaining visual helper components to TSX.
- Replace remaining prop-drilled `fetchJson` in inspector/sidebar/project panels with typed mutations/hooks.
- Make Workflow App definitions declare which `resolvedImports` aliases map to which input fields.
- Add real custom viewer TS bundling/rebuild pipeline; current reload is manifest/status only.
- Retire legacy `/actions` alias once public links/tests are updated.
