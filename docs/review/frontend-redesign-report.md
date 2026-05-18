# Frontend Redesign Report

Date: 2026-05-18

## Summary

This pass moves the frontend from “foundation only” into an actual T3 Code Dark app shell. Theme tokens, shell orchestration, topbar/sidebar/main/inspector ownership, neutral dark surfaces, composer styling, model picker styling, project cards, and mobile sheet behavior now work together while existing backend routes and runtime behavior stay compatible.

## Improved

- Theme system now has presets for AIWS Dark, T3 Code Dark, Notion Light, Notion Dark, and System.
- T3 Code Dark is now the default theme. AIWS Dark remains available as the legacy identity preset.
- Existing saved `aiws-dark` preferences are migrated once to `t3-code-dark` so the redesign actually appears for existing browsers.
- Theme choice persists in localStorage and applies through CSS variables.
- Settings includes a design theme selector.
- The default palette now follows the T3 Code-style app chrome: near-black background, flat neutral panels, low-radius cards, thinner borders, minimal blue accents, and no dashboard grid/glow.
- `AppShell` now owns the topbar/sidebar/main/inspector/overlay layout slots. `LegacyApp` remains as a compatibility/data container instead of directly assembling the visual frame.
- `AppShell` now owns a real command palette surface with Cmd/Ctrl+K. Commands cover Home, new project, Workflow Apps, inspector toggle, projects, and recent chats.
- Route-backed session and project-config refresh are now driven by TanStack Query hooks, with `LegacyApp` consuming query-backed data instead of manually fetching those paths on route changes.
- New typed primitives provide reusable buttons, inputs, panels, modals, drawers, tabs, empty states, loading states, and menu surfaces.
- Global blue glow/grid styling is removed from the default theme and moved behind the AIWS Dark preset.
- Sidebar, topbar, composer, model picker, home cards, project dashboard cards, and mobile inspector/model-picker sheets now use neutral surface tokens.
- Home launcher cards are now flatter and smaller, with the primary card expressed through border/accent rather than a large blue gradient.
- Chat/user messages and the composer now use neutral command-bar surfaces instead of bright blue/glass styling.
- Mobile behavior now treats the sidebar as a drawer and the inspector/model picker as sheet-style panels.
- Workflow App shells now prefer the latest persisted project run/artifacts for their viewer slots, not only the just-finished in-memory result.
- Previous UX cleanup remains: project debug panels hidden by default, project cockpit card, simpler Easy model picker, subtler chat bubbles, and “Context used” receipt copy.

## Known Limitations

- `LegacyApp` still owns route state, navigation, and modal business state. Workspace/home/runtime/session/project-config data now use query hooks, but mutations are not fully feature-owned yet.
- Primitives are available but only partially adopted. Existing screens still use many legacy class names.
- Sidebar/chat/home/model/viewer CSS is cleaner and tokenized, but not fully converted to CSS Modules.
- Command palette is functional, but not yet a full Raycast-style command system with grouped sections and keyboard roving selection.
- Mobile inspector/model picker sheets exist, but workflow-specific mobile forms remain next-pass work.

## Manual Test Checklist

- Switch theme in Settings, close Settings, reload, and confirm theme persists.
- Open Home, Project, Apps & Tools, and Chat under dark and light themes.
- Verify model picker still opens from composer.
- Verify mobile sidebar drawer still closes via scrim.

## Next Steps

1. Move remaining `LegacyApp` navigation/modal orchestration into route and feature modules.
2. Replace legacy sidebar and settings controls with primitives.
3. Convert chat timeline/composer and project tabs/cards to component CSS modules.
4. Expand command palette with keyboard selection, grouped commands, and route-aware actions.
5. Expand Playwright checks for 390px mobile layout and theme persistence.
