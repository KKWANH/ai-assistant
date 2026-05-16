# TypeScript Migration

AIWS now mounts through `web/src/main.tsx` and keeps `allowJs` enabled while the runtime path moves incrementally.

## Completed

- Main entry is TypeScript.
- App providers, router, shell contracts, workflow app contracts, and viewer registry are typed.
- Core runtime components converted in this pass:
  - `app/legacy/Overlays.tsx`
  - `app/legacy/LegacyApp.tsx`
  - `app/legacy/CenterPane.tsx`
  - `components/actions/ActionPanels.tsx`
  - `components/chat/Composer.tsx`
  - `components/inspector/ContextPanel.tsx`
  - `components/project/ProjectDashboard.tsx`
  - `app/layout/WorkspaceSidebar.tsx`
  - `components/home/StartPane.tsx`
  - `pages/AppsToolsCatalogPage.tsx`
- Chat submission logic is shared through `useChatSubmit()`.
- Docked workflow chat no longer casts the legacy composer through `unknown`.

## Remaining Checklist

- Remove temporary `ts-nocheck` from `LegacyApp.tsx`, `CenterPane.tsx`, `ContextPanel.tsx`, `ProjectDashboard.tsx`, `WorkspaceSidebar.tsx`, `StartPane.tsx`, and `AppsToolsCatalogPage.tsx` by adding explicit domain props.
- Route remaining mutations through typed client helpers.
- Replace remaining broad JSON payload types with backend contract parsers.
- Turn on `checkJs` for any files that stay JavaScript temporarily.
- Set `allowJs` to `false` once the main runtime path no longer imports JSX.

Do not disable TypeScript or add new JSX files during the migration.
