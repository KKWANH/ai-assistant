# Lecture prep

An **example project** built on the Ariadne platform — deliberately *not* a
core feature. It shows how far a vertical can go on the general platform: a
custom view, server routes, generated artifacts, and an immersive home, all
contributed through the project registry (see `projects/README.md`).

## What it is

A semester is one workspace, organized as **courses → weeks → materials**. For
a week the lecturer can: research (chat + web search), generate a slide deck
(`.pptx`) and a spoken script (`.docx`), and find real, sourced images to drop
onto slides. A per-course memo and a project-wide context keep everything
consistent.

## Layout

```
projects/lecture/
  types.ts            # Deck, Lecture* shapes (moved out of @ariadne/shared)
  server.ts           # registry entry: the "lecture" starter + route export
  web.ts              # registry entry: the create-dialog card + resolveHome
  server/
    lecturePrep.ts    # the courses→weeks→materials folder convention + memo
    deckGen.ts        # outline (LLM) → .pptx (pptxgenjs), with image embed
    scriptGen.ts      # deck → spoken narration → .docx
    routes.ts         # GET/POST the structure, /deck, /script, /deck-file …
  web/
    LectureView.tsx   # the lecture home (course cards → weeks → actions)
    DeckPreview.tsx   # deck preview + per-slide image picker
    api.ts            # the lecture web API client
    routes.tsx        # /workspaces/:id/lecture → LectureView (lazy)
```

## How it plugs in

- **Server**: `server.ts` exports a `ProjectServerModule` (the `lecture`
  starter, category `lecture`) and the Fastify `lectureRoutes`. Core's
  `apps/server/src/projects/index.ts` collects the starter and mounts the
  routes — it never names "lecture".
- **Web**: `web.ts` exports the create-dialog card and `resolveHome` (a lecture
  workspace opens to `/workspaces/:id/lecture`); `web/routes.tsx` contributes
  the route. Core's `apps/web/src/projects/index.ts` spreads both.
- **Imports core** via the `@ariadne/server` / `@ariadne/web` workspace
  packages (general tools: web/image search, retrieval, providers, the
  immersive-home shell, the project-context editor). Core imports *nothing*
  from here.

To remove lecture prep entirely: delete this folder and its two lines in the
server + web registry indexes. Core still builds.
