# Frontend UX Review

Date: 2026-05-16

## Fixed In This Pass

- Restored strict TypeScript checks for implicit `any`, null handling, and unknown catch values.
- Removed `ts-nocheck`, file-level `no-explicit-any`, and direct `any` from the main runtime path:
  - `LegacyApp.tsx`
  - `CenterPane.tsx`
  - `ContextPanel.tsx`
  - `ProjectDashboard.tsx`
  - `WorkspaceSidebar.tsx`
  - `StartPane.tsx`
  - `AppsToolsCatalogPage.tsx`
  - `ActionPanels.tsx`
  - `Composer.tsx`
- Recentered Home and Apps & Tools content inside the available work area.
- Reduced Apps & Tools card height and centered catalog grids so Chat Tools no longer look pinned to the left/top.
- Moved legacy workspace data refresh out of `LegacyApp.tsx` into `useLegacyWorkbenchData`.
- Moved project Workflow App preview/run/import state out of `ActionPanels.tsx` into `projectActionRuntime.ts`.
- Moved project Workflow App preview/result rendering into `ProjectActionPreview` and `ProjectActionRunResult`.
- Switched project Workflow App import/preview/run execution to React Query mutations with project-config invalidation.
- Moved action panel and project dashboard CSS out of the root style import tree into component folders.
- Made the investment advisor dashboard visible directly on the Project → Workflow Apps tab, so the app path is less chat/history-first.
- Converted the project dashboard style slice to a CSS Module and moved the architecture diagram onto that module boundary.
- Converted chat submit and project local-only security updates to React Query mutations with query invalidation.
- After a Workflow App run in an investment project, the UI switches/focuses back to the app dashboard area instead of leaving the user in run/history context.

## Current UX Problems Found

- Home still has two meanings in code: quick chat launcher and starter tool launcher. The screen is cleaner now, but the product model should keep moving toward: global chat first, project apps inside projects.
- Apps & Tools is still partly backed by home action metadata. The visual catalog is centered now, but the execution contract is still split between chat tools and workflow apps.
- Sidebar history is dense. It helps power users, but easy mode still needs stronger grouping and fewer stale low-value rows.
- Context/receipt surfaces are technically available, but the main chat still shows receipt and plan details too heavily for easy users.
- Workflow App results are improving, but investment advisor still needs a richer completed-state dashboard once all expected artifacts exist.

## Next Code Risks

- TanStack Query now owns chat submit, project Workflow App import/preview/run, and project local-only mutations. Sidebar rename/delete/profile mutations still use direct route calls.
- `ActionPanels.tsx` is thinner now, but still exports automation panels, task suggestions, and inspectors.
- CSS ownership improved for project dashboard via CSS Modules and action panels via component-owned CSS. Sidebar/chat/home/model/viewer styles are still class-based global CSS.
