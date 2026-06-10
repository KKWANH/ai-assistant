# `projects/` — example verticals built on the Ariadne platform

> **Status: DESIGN ONLY.** This document is the agreed architecture. No code
> has been migrated yet. Implementation is phased (see *Migration*). Decided:
> projects are wired into core via a **static registry** (build-time imports),
> not a runtime plugin loader.

## Why this exists

The core platform — `apps/server`, `apps/web`, `packages/shared` — must be
**domain-agnostic**. "Lecture prep" and "Portfolio" are **not** platform
features; they are **examples** of what you can build on the platform. Today
they are woven through ~24 (lecture) and ~5 (portfolio) core files. That is the
mistake this restructure fixes.

Each example lives in `projects/<name>/`, where it:

- **works** — it is real, runnable code wired into the app, and
- **reads** — it is a self-contained folder a person can open to learn the
  pattern (a custom screen + actions + any project code + a README).

Core knows only the **registry interface**. It never says `if (category ===
"lecture")`. Remove a project folder and unregister it, and core still builds.

## What a project is

```
projects/<name>/
  README.md          # what this example demonstrates — written for a reader
  project.server.ts  # server registry manifest (routes, starter, tools)
  project.web.ts     # web registry manifest (routes, starter card, home)
  server/            # (optional) services + Fastify routes this project adds
  web/               # (optional) React views/routes this project adds
  template/          # the portable workspace template (BL1 format):
                     #   surface.tsx · actions.yaml · template.yaml · seed files
```

A *simple* project (budget, chefbook, …) has only `template/` + a tiny
`project.*.ts` that registers a starter. A *rich* project (lecture) also ships
`server/` + `web/` code that the registry mounts.

## The registry (static, build-time)

Core defines two interfaces and iterates over a statically-imported list. There
is **no dynamic loading** — `projects/index.*.ts` imports each project, so the
boundary is explicit and type-checked, but the source lives outside `apps/`.

### Server — `apps/server/src/projects/registry.ts`

```ts
export interface ProjectServerModule {
  name: string;                                  // "lecture"
  /** Offered in the create-workspace flow (replaces the hardcoded STARTERS). */
  starter?: {
    id: string;                                  // "lecture"
    category: string | null;                     // "lecture" → scopes templates
    scaffold?(rootPath: string): void;           // optional seed structure
  };
  /** Routes this project adds (replaces the hardcoded `lectureRoutes(app)`). */
  registerRoutes?(app: FastifyInstance): Promise<void> | void;
}
```

`apps/server/src/projects/index.ts` statically imports every project's
`project.server.ts` into `PROJECTS: ProjectServerModule[]`. Then:

- Bootstrap (`index.ts`) does `for (const p of PROJECTS) await p.registerRoutes?.(app)`
  instead of calling `lectureRoutes(app)` by name.
- The create handler builds its starter→category map by iterating `PROJECTS`,
  not from an inline object.

### Web — `apps/web/src/projects/registry.ts`

```ts
export interface ProjectWebModule {
  name: string;
  /** A card in the create dialog (icon + i18n keys). */
  starterCard?: { id: string; icon: LucideIcon; labelKey: string; descKey: string };
  /** Extra routes — the rich UI — lazy-loaded. */
  routes?: { path: string; element: React.LazyExoticComponent<React.FC> }[];
  /** Where this project's workspaces open on entry (generalizes the lecture
   *  → /lecture and immersive-home routing). Returns a path or null. */
  resolveHome?(ws: Workspace): string | null;
}
```

`apps/web/src/projects/index.ts` imports every `project.web.ts` into
`PROJECTS: ProjectWebModule[]`. Then:

- `App.tsx` spreads `PROJECTS.flatMap(p => p.routes ?? [])` into the router.
- `CreateWorkspaceDialog` builds its starter cards from `PROJECTS`.
- `AppShell` sidebar target = `firstNonNull(PROJECTS.map(p => p.resolveHome?.(ws)))
  ?? \`/workspaces/${ws.id}\`` — so lecture's "open to /lecture" is just a
  project resolving its own home, not a core special-case.

## What stays in core (the general capabilities projects use)

These are **not** lecture/portfolio-specific and remain first-class platform:

- **Workspaces, surfaces (custom screens), the immersive home**, the template
  export/import mechanism (BL1).
- **General tools**, callable by any project's surface/actions/routes:
  - image search (`services/imageSearch.ts`) — already general ✔
  - web search / page reading (`services/search.ts`) — already general ✔
  - project context (`services/workspaceContext.ts`) — already general ✔
  - **slide generation** — `deckGen.ts` becomes a domain-agnostic
    `services/slidesGen.ts` ("an outline → a clean .pptx"). The *lecture*
    prompt/flow that calls it moves to `projects/lecture/`.
  - **doc generation** — `scriptGen.ts` becomes `services/docGen.ts`
    ("an outline → a .docx"); lecture's narration flow moves out.

The rule of thumb: **a capability that any vertical could want → core tool. A
choice specific to one vertical (the semester/course/week convention, the
lecture UI) → the project.**

## Migration (phased — avoids the hard parts and the HANDS-OFF parts first)

### Phase 1 — pilot: the simple starters  *(low risk, do first)*
Move `budget · chefbook · code · decisions · papers · reading` out of
`apps/server/src/surface/*Starter.ts` into `projects/<name>/template/` + a tiny
`project.*.ts`. Build the registry and re-point the create flow + dialog at it.
This proves the whole mechanism end-to-end **without touching lecture (hard) or
portfolio (HANDS-OFF)**.

### Phase 2 — lecture
1. Extract general tools to core: `slidesGen.ts`, `docGen.ts`.
2. Move the lecture vertical to `projects/lecture/`:
   - `server/`: `lecturePrep.ts` (folder convention), the `lecture.ts` routes,
     the lecture-specific deck/script prompts (calling the core tools).
   - `web/`: `LectureView.tsx`, `DeckPreview.tsx`, lecture api helpers, i18n.
   - `template/` + `project.*.ts`: the starter + `resolveHome` (→ /lecture).
3. Delete the lecture references from core (App.tsx route, AppShell branch,
   CreateWorkspaceDialog card, workspaces.ts starter, shared types that are
   lecture-only). Core no longer imports anything named "lecture".

### Phase 3 — portfolio  *(by its dedicated session; HANDS-OFF until then)*
Same pattern: `projects/portfolio/`. **Designed here, not implemented now.**
The portfolio session owns `portfolioStarter.ts`, `portfolioV2Template.ts`,
`demoWorkspace.ts` and `data/portfolio/`; it will move them once Phase 1 has
established the registry it plugs into.

## Lecture file map (the hard case, for reference)

| Today (core)                                   | After                                            |
|------------------------------------------------|--------------------------------------------------|
| `services/lecturePrep.ts`                      | `projects/lecture/server/`                       |
| `routes/lecture.ts`                            | `projects/lecture/server/` (via `registerRoutes`)|
| `services/deckGen.ts`                          | split → core `slidesGen.ts` + lecture prompt     |
| `services/scriptGen.ts`                        | split → core `docGen.ts` + lecture prompt        |
| `services/imageSearch.ts`, `search.ts`         | **stay in core** (general tools)                 |
| `web/.../LectureView.tsx`, `DeckPreview.tsx`   | `projects/lecture/web/`                           |
| `App.tsx` lecture route                        | registry `routes`                                |
| `AppShell` lecture sidebar branch              | registry `resolveHome`                           |
| `CreateWorkspaceDialog` lecture card           | registry `starterCard`                           |
| `workspaces.ts` lecture starter/category       | registry `starter`                               |
| lecture-only types in `packages/shared`        | `projects/lecture/` (shared only stays general)  |

## Open questions (resolve before Phase 1)

1. **Build wiring.** A path alias `@projects/*` (tsconfig + vite) vs. making
   `projects/*` npm workspaces. Leaning path alias — projects are app source,
   not published packages.
2. **i18n.** Project-scoped keys contributed via the registry, vs. keeping a
   central catalog. Leaning: registry contributes a `messages` map merged at
   startup, so a project's strings travel with it.
3. **`category` semantics.** Keep the DB `category` column (template scoping)
   but populate the allowed values from the registry rather than a hardcoded
   union.
4. **`homeView`/immersive home** stays core (general); a project's `resolveHome`
   composes with it.
