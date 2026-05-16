# Frontend Architecture

AIWS is moving from a single JavaScript entry file toward a typed React frontend.

## Migration Strategy

- TypeScript is enabled with `allowJs` so existing JSX can continue to run while new foundation code is typed.
- `src/main.tsx` is now only responsible for mounting providers and the router.
- The legacy app is temporarily isolated in `src/app/legacy/LegacyApp.tsx`.
- The top bar shell controls have moved to `src/app/layout/TopBar.tsx`.
- New app-level files live under `src/app/`.
- Shared server contracts live under `src/shared/contracts/`.
- Typed server access lives in `src/shared/api/client.ts`.

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

## Next Extraction Targets

`LegacyApp.tsx` still owns several large UI areas. The next migration should move:

- Sidebar tree into `src/app/layout/Sidebar.tsx`
- Center route branching into `src/app/router.tsx`
- Settings dialogs into `src/features/settings/`
- Message timeline into `src/components/chat/`

## Backend Constraints

The Python static asset serving model and existing API route paths stay unchanged.
