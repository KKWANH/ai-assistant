# Frontend UX Review

Date: 2026-05-16

## Fixed In This Pass

- Added a project-scoped retrieval path so chat can use project files through RAG instead of only raw attachment injection.
- Added local hybrid retrieval signals to receipts: matched terms, rerank score, and vector score.
- Added retrieval source IDs (`R1`, `R2`) to context prompts and receipts so source-grounded answer UX can be built on stable IDs.
- Added retrieval-first context planning so easy/general chat does not silently include prior attachment dumps unless the user asks for previous/all files.
- Added retrieval status/rebuild endpoints for index visibility.
- Changed trusted viewer iframe payload loading from an investment-only endpoint to per-viewer payload endpoints.
- Added inline source preview for context receipt chunks.
- Added linked-resource metadata to retrieved chunks so Easy/Power surfaces can distinguish own-project sources from approved imported resources.
- Trusted viewer payloads can now include approved linked resources by alias.
- Source previews now open in a full right-side drawer instead of a small inline block.
- Retrieval indexing now uses per-source digests and incremental replacement for changed/removed files.
- A lightweight retrieval watcher starts with the UI server and refreshes stale project indexes in the background.
- Fixed route parsing for `/project/:id?tab=...` and `/project/:id/app/:appId?...` so query state no longer corrupts project IDs.
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
- RAG is active, source IDs are present, and receipt chunks open a source drawer. Easy mode still needs multi-source comparison and pinning.

## Next Code Risks

- TanStack Query now owns chat submit, project Workflow App import/preview/run, and project local-only mutations. Sidebar rename/delete/profile mutations still use direct route calls.
- `ActionPanels.tsx` is thinner now, but still exports automation panels, task suggestions, and inspectors.
- CSS ownership improved for project dashboard via CSS Modules and action panels via component-owned CSS. Sidebar/chat/home/model/viewer styles are still class-based global CSS.
- Retrieval now does incremental source replacement. Large folders may still need a native file-event watcher instead of the current lightweight polling watcher.
- Trusted viewer payloads support artifact patterns and linked resource aliases. The next risk is making this UI-discoverable in viewer manifests and Project settings.
