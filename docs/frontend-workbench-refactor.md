# Frontend Workbench Refactor

## Existing App Model

The backend already models AIWS as a file-backed local workbench:

- `storage.py`: workspace root, users, projects, sessions, files, messages, runs, artifacts.
- `contracts.py`: explicit contracts for workflow apps, viewer slots, resource links, run records, artifacts.
- `action_registry.py`: `aiws.yaml` loading, action normalization, capabilities, secret path checks, Workflow App metadata.
- `workbenchContracts.ts`: frontend normalizers for panels, action kinds, and planner previews.

The frontend previously exposed these concepts unevenly:

- Chat and Home were the dominant surfaces.
- Runs and Artifacts appeared mostly inside project/home panels.
- Actions were mixed with Workflow Apps and starter chat tools.
- Settings/Auth/Viewer UI remained legacy modal-oriented.
- Styling was partly tokenized but many work surfaces still depended on broad global CSS.

## Target Product Nouns

AIWS frontend should be organized around four first-class nouns:

1. **Workspace / Project**
   Local folder-backed workbench with `aiws.yaml`, files, sessions, runs, artifacts, context index, and settings.

2. **Session**
   Conversational work thread. It can create runs and artifacts, but it is not the whole product.

3. **Run**
   Traceable execution record for model calls, actions, Workflow App steps, indexing, or artifact generation.

4. **Artifact**
   Durable output produced by a run or session. It must be browseable independently from chat.

Actions remain executable verbs. They appear in command palettes, manifest action cards, Workflow App launchers, and run triggers.

## Refactor Decisions

- Keep backend APIs stable.
- Add frontend object-browser routes for Projects, Runs, and Artifacts.
- Keep `LegacyApp` as a compatibility data container for now, but move visual shell semantics into `WorkbenchShell`.
- Use reusable work-object cards for Project/Session/Run/Artifact rather than one-off dashboard cards.
- Make Home a cockpit of recent work objects instead of a chat-like landing screen.
- Keep Power/debug internals behind collapsible developer details.

## Remaining Legacy Boundaries

- `LegacyApp` still owns some navigation, modal, and refresh orchestration.
- Settings/Auth are still modal/login surfaces, now wrapped but not fully split into routes.
- Run/Artifact global pages use currently available workspace/home payloads until project-wide pagination/search endpoints are added.
- Global CSS still exists for legacy compatibility; new shell/object surfaces are module/scoped where practical.

## Verification

Minimum frontend gates:

```bash
cd web
npm run typecheck
npm run lint
npm run test -- --run
npm run build
```
