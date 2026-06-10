# Phase 3 prompt — move portfolio into `projects/portfolio/`

> Paste this into the **portfolio session** (the one that owns portfolio).
> Phases 1 (simple starters) and 2 (lecture) are done and on `main`; the
> registry exists and `projects/lecture/` is the worked example for a *rich*
> vertical. Portfolio was HANDS-OFF for the platform session — it's yours.

## Goal

Move the **portfolio** vertical out of core into `projects/portfolio/`, wired
in only through the project registry, exactly like `projects/lecture/`. When
done, `grep -rIl "portfolioStarter\|portfolioV2\|seedPortfolio\|demo-portfolio"
apps/` finds **nothing** — core imports nothing named portfolio (i18n label
strings may remain, like other starters).

Read first: `projects/README.md` (the architecture) and `projects/lecture/`
(the pattern — server.ts/web.ts registry entries, `@ariadne/server`/
`@ariadne/web` cross-imports, types moved out of shared).

## Portfolio's coupling to core today (the work-list)

1. `apps/server/src/surface/portfolioStarter.ts` — the seed files + surface
   strings (v1 + v2). → `projects/portfolio/template.ts` (git mv).
2. `apps/server/src/surface/portfolioV2Template.ts` — `seedPortfolioV2Surface`
   (the multi-file v2 surface folder). → `projects/portfolio/` (its own
   module); the starter's scaffold should call it.
3. `apps/server/src/routes/workspaces.ts` — the hardcoded `portfolio` entry in
   `STARTERS` + the `if (starter === "portfolio") seedPortfolioV2Surface(...)`
   special-case. → both move into the portfolio project: the registry starter
   provides the files/surface/actions, and the v2 surface seeding becomes the
   starter's own `scaffold(rootPath)` hook (you'll need to add an optional
   `scaffold?(rootPath)` to `ProjectStarter` and have the create handler call
   it — a small registry extension; lecture didn't need it).
4. `apps/server/src/demoWorkspace.ts` — seeds the built-in **Portfolio** demo
   workspace at `data/portfolio` on boot. This is portfolio-specific seeding
   that has no lecture equivalent. Decide: keep a thin core hook that asks the
   registry "does any project want a demo workspace seeded?", or move the
   whole demo-seed into `projects/portfolio/` and have core call a registry
   `seedDemoWorkspaces()` (mirror `registerProjectRoutes`).
5. `apps/server/src/db/repo.ts` — any `demo-portfolio/ → portfolio/` rootPath
   migration / `DEMO_WORKSPACE_ID` handling. Move with the demo-seed logic.
6. `apps/server/src/index.ts` — wherever demoWorkspace seeding is invoked at
   boot → route through the registry hook.
7. Web `CreateWorkspaceDialog` already builds its cards from the registry, so
   adding `projects/portfolio/web.ts` (a `ProjectWebModule` with the
   `starterCard`) is all that's needed there; remove the hardcoded portfolio
   card. If portfolio wants an immersive home, add `resolveHome`.

## Pattern to follow (from `projects/lecture/`)

- `projects/portfolio/` = `template.ts` (moved seed/surface), `server.ts`
  (`ProjectServerModule`: the starter, category `finance`, + `scaffold` for
  the v2 surface, + any demo-seed export), `web.ts` (the card), `README.md`,
  and any `server/` helpers (the v2 template module).
- Register it: add `import { project as portfolio } from
  "../../../../projects/portfolio/server.js"` to
  `apps/server/src/projects/index.ts` (relative — tsx doesn't resolve
  `@projects`), push it into `PROJECTS`, and (if you add demo-seeding /
  scaffold hooks) wire those in the registry the way `registerProjectRoutes`
  is wired. Add `projects/portfolio/web` to `apps/web/src/projects/index.ts`.
- Cross-import core from the project via the `@ariadne/server` / `@ariadne/web`
  workspace packages (deep `@ariadne/server/src/...` paths — tsx resolves them
  via the node_modules symlink).
- Move portfolio-only types out of `@ariadne/shared` into
  `projects/portfolio/types.ts` if any.
- Don't break the **HANDS-OFF data**: `data/portfolio/`, `portfolio-v2/`,
  `docs/PORTFOLIO_STARTER_V2.md` stay where they are; you're moving the
  *starter/template code*, not the user's portfolio data.

## Registry extensions you'll likely add (small)

- `ProjectStarter.scaffold?(rootPath: string): void` — for the v2 surface
  seeding (lecture had no scaffold; the simple starters only had data).
- A `seedDemoWorkspaces()` collector in `apps/server/src/projects/index.ts`
  (mirrors `registerProjectRoutes`) if you move the demo-Portfolio seed.

## Verify (like Phase 1/2)

`npm run typecheck` + `npm run build:web` pass; `./ops/ariadne.sh restart`
boots; the demo Portfolio still seeds (or is intentionally dropped); creating a
Portfolio workspace from the dialog scaffolds its files + v2 surface and sets
category `finance`; `grep` finds no portfolio code imports left in `apps/`.
Commit with `git add <path>` (never `-A`); end the message with the
`Co-Authored-By` line.
