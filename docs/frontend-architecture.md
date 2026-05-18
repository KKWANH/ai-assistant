# Frontend Architecture

AIWS is moving from a single JavaScript entry file toward a typed React frontend.

## Migration Strategy

- TypeScript runs with strict frontend checks. Runtime React files should stay typed; avoid adding new JSX runtime paths.
- `src/main.tsx` is now only responsible for mounting providers and the router.
- The legacy app is temporarily isolated in `src/app/legacy/LegacyApp.tsx` and now acts mostly as a compatibility/data container.
- The top bar shell controls have moved to `src/app/layout/TopBar.tsx`.
- The active shell namespace now lives under `src/app/shell/` (`AppShell`, `AppSidebar`, `AppTopBar`, `AppMain`, `AppInspector`, `AppComposerDock`). `AppShell` owns the visual slots for topbar, sidebar, center pane, inspector, mobile scrim, and overlays.
- `AppShell` also owns the global command palette surface and the Cmd/Ctrl+K keyboard entry point.
- New app-level files live under `src/app/`.
- Shared server contracts live under `src/shared/contracts/`.
- Typed server access lives in `src/shared/api/client.ts`.
- Theme tokens and presets live under `src/ui/theme/`. The default product theme is `t3-code-dark`; `aiws-dark` remains as the legacy blue identity preset.
- Typed reusable primitives live under `src/ui/primitives/`.

## State Ownership

Server state should move to TanStack Query:

- `workspace`: `/api/workspace`
- `models`: `/api/models`
- `session`: `/api/chat/:project/:session`
- `project-config`: `/api/project-config/:project`
- `project-run`: `/api/project-run`
- `project-artifact`: `/api/project-artifact`

React component state should remain for local-only UI concerns:

- draft text
- open/closed menus
- selected modal item
- local drag/drop hover state
- transient form state
- active design theme, persisted in localStorage and applied through CSS variables
- command palette open/closed state

## Next Extraction Targets

`LegacyApp.tsx` still owns route state, navigation, and modal business state. Route-backed session/project-config reads are query-backed now. The next migration should move:

- Center route branching into `src/app/router.tsx`
- Settings dialogs into `src/features/settings/`
- Message timeline into `src/components/chat/`
- Chat/project mutations into TanStack Query feature hooks

## Backend Constraints

The Python static asset serving model and existing API route paths stay unchanged.
