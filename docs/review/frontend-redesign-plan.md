# Frontend Redesign Plan

Date: 2026-05-18

## Audit

- Runtime path is already TypeScript strict with `main.tsx -> AppProviders -> AppRouter -> LegacyApp`.
- Server state is mostly held by TanStack Query hooks, while some sidebar profile/rename/delete mutations still call direct routes.
- Global CSS is split by feature files, but many components still depend on shared class names.
- Product screens exist for chat, projects, apps/tools, workflow app routes, artifacts, inspector, and settings.
- Easy mode still benefits from hiding internals such as manifest, registry, raw receipt details, and architecture diagrams.

## Refactor Direction

1. Add a token-driven theme layer without changing backend APIs.
2. Introduce a new `app/shell` namespace as the frontend target shell while keeping legacy runtime compatibility.
3. Add typed UI primitives that use the theme variables and can replace scattered button/card/modal patterns incrementally.
4. Keep Easy mode focused on task actions, selected model, context used, and outputs.
5. Keep Power mode for diagnostics, receipt details, registry, and manifest internals.

## This Pass

- Theme presets: `aiws-dark`, `t3-code-dark`, `notion-light`, `notion-dark`, `system`.
- Theme persistence through localStorage.
- Settings theme switcher.
- Shell namespace files for topbar/sidebar/main/inspector/composer.
- Typed primitives folder for future refactors.
- Existing backend/API behavior preserved.

## Next Pass

- Move Sidebar, CenterPane, and Inspector rendering to the new shell files instead of re-export compatibility.
- Convert sidebar/chat/home/model/viewer global CSS slices to component CSS modules.
- Add command palette and inspector drawer behavior.
- Make Workflow App result pages dashboard-first by default.
