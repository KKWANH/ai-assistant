/**
 * docsContent — the prose. Each export is one page body in Markdown (GFM:
 * tables, callouts via `> [!NOTE]`, fenced code with a language tag). Authored
 * to be accurate to the codebase; the registry (docsRegistry.tsx) wires these
 * into the nav + routing + search. Keep headings as `##` / `###` so the "On
 * this page" rail and in-page anchors pick them up.
 */

export const INTRODUCTION = `
Ariadne is a **local-first AI workspace** (AGPL-3.0). It runs on your machine,
points every answer back at its source, and is built — top to bottom — to be
extended. If you're here to add a route, a provider, a tool, or a whole project,
these docs are the map.

## Three ideas shape the codebase

Understanding these three makes the rest of the code predictable.

### Local-first

The server binds to loopback. A request that arrives over a real loopback
connection **is** the admin — no login, full powers (the terminal, the host
filesystem, git). The same server can be reached remotely through a Cloudflare
tunnel, but a remote request must carry a session cookie and loses the
local-only powers. One predicate, \`accessContext(req)\`, draws that line; gate
anything dangerous on it.

### Register, don't hardcode

Commands, settings, surfaces, AI providers, agent tools, and the server's HTTP
routes are all **registries**. Neither the web shell nor the server bootstrap
enumerates them by hand — you contribute one entry and the platform wires the
rest (the nav, the schema, the search, the docs). Most "how do I add X?"
questions have the same answer: find X's registry and append to it.

### Dual-use

Ariadne is at once a power-user IDE — file editor, git panel, terminal,
programmable surfaces — and an approachable tool for non-developers, toggled per
account and per workspace. Features are built so the depth is *discoverable*,
not in your face.

> [!TIP]
> New to the codebase? Read [Quickstart](/developers/quickstart) to get it
> running, skim [Architecture](/developers/architecture-overview) for the shape
> of the system, then jump to whichever [extension guide](/developers/add-a-route)
> matches your task.
`;

export const QUICKSTART = `
Ariadne is a Node monorepo (npm workspaces). You need **Node ≥ 22** — the server
uses the built-in \`node:sqlite\`, so there's no native database to compile.

## Install and run

\`\`\`bash
npm install
./ops/ariadne.sh restart      # build the web app + (re)start the server on :4319
\`\`\`

Open <http://localhost:4319>. Because the request is loopback, you're the admin
— no sign-in. That's the whole app: chat, workspaces, the IDE, settings.

## Develop with hot reload

For a fast edit loop, run the two dev servers instead:

\`\`\`bash
npm run dev:server            # tsx watch — the API on :4319, restarts on change
npm run dev:web               # vite on :5173, proxies /api → :4319 with HMR
\`\`\`

Edit under \`apps/web/src\` and the browser updates instantly. Edit the server and
\`tsx watch\` restarts it.

> [!NOTE]
> The production app is served from \`apps/web/dist\`. After a change you want the
> real server to serve, rebuild and restart with \`./ops/ariadne.sh restart\` —
> the dev server on :5173 is for iteration only.

## Verify your setup

\`\`\`bash
npm run typecheck             # shared + server + admin + web, strict
npm run gen:api:check         # fail if the API docs drifted from the routes
\`\`\`

No API key is required to explore — a built-in **mock provider** returns
schema-correct output so runs complete end to end offline. Add a real key in
**Settings → Providers** when you want live answers.
`;

export const PROJECT_LAYOUT = `
Everything lives in one repository. Two workspaces (\`apps/*\`, \`packages/*\`) plus
a \`projects/\` folder of self-contained example apps.

\`\`\`text
apps/
  server/   Fastify + node:sqlite — routes/ services/ providers/ surface/ db/
  web/      React 18 + Vite + Tailwind v4 — features/ components/ lib/
  desktop/  Tauri shell (spawns the server as a sidecar)
  admin/    supervisor — process management
packages/
  shared/   zod schemas, types, theme, the provider registry — imported by both apps
  surface-sdk/  the typed runtime a custom surface is built against
projects/   static example projects (lecture, portfolio), contributed via a registry
\`\`\`

## Where things go

| You're adding… | It lives in… |
| --- | --- |
| An HTTP endpoint | \`apps/server/src/routes/\` + an entry in \`routes/registry.ts\` |
| Business logic | \`apps/server/src/services/\` (keep route handlers thin) |
| An AI provider | the \`PROVIDER_REGISTRY\` in \`packages/shared\` |
| A type shared by both apps | \`packages/shared/src/types.ts\` |
| A screen or feature | \`apps/web/src/features/\` |
| A reusable UI primitive | \`apps/web/src/components/ui/\` |
| A self-contained example app | \`projects/<name>/\` |

> [!IMPORTANT]
> \`packages/shared\` is imported by **both** the server and the web app, so it must
> stay free of Node-only and browser-only APIs. Types, zod schemas, and plain
> data belong here; \`fs\` and \`window\` do not.
`;

export const ADD_A_ROUTE = `
The backend follows "register, don't hardcode": you never edit \`index.ts\` to add
an endpoint. A route file exports a Fastify plugin; you append **one entry** to
the route registry, and the bootstrap iterates it inside the \`/api\` scope (so the
auth hook always runs).

## 1. Write the route plugin

\`\`\`ts
// apps/server/src/routes/notes.ts
import type { FastifyInstance } from "fastify";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

export async function noteRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    "/workspaces/:id/notes",
    async (req, reply) => {
      // Mutations refuse remote callers — local-only power.
      if (await rejectRemoteAccess("Local only.", req, reply)) return;
      const ws = await requireWorkspace(req.params.id, req, reply); // write access
      if (!ws) return;
      // ... do the work against ws.rootPath ...
      return reply.send({ ok: true });
    },
  );
}
\`\`\`

## 2. Register it

\`\`\`ts
// apps/server/src/routes/registry.ts — append to CORE_ROUTES
{ domain: "notes", description: "Workspace notes.", register: noteRoutes },
\`\`\`

That's it. \`index.ts\` loops over \`CORE_ROUTES\` and registers each under \`/api\`, so
your paths are served at \`/api/workspaces/:id/notes\` with the auth hook applied.

## The rules that keep routes safe

- **\`requireWorkspace(id, req, reply, "read")\`** for reads; omit the 4th argument
  for owner/write access. It resolves the workspace and writes the 404/403 for
  you — return early when it yields \`null\`.
- **\`accessContext(req)\`** is \`"local"\` *only* on a genuine loopback connection.
  Gate dangerous powers (shell, raw filesystem) on it; never trust a header.
- **Heavy work belongs in \`services/\`.** Route handlers parse input, call a
  service, and shape the response — nothing more.
- **Public (unauthenticated) routes** go in \`PUBLIC_ROUTES\`, not \`CORE_ROUTES\` —
  they register *outside* the \`/api\` auth scope. That list is deliberately tiny.

> [!TIP]
> Re-run \`node scripts/gen-api-inventory.mjs\` (or \`npm run gen:api\`) after adding
> a route and it appears in the [API Reference](/developers/api) automatically —
> the generator scans \`routes/\` and the registry, so the docs never drift.
`;

export const ADD_A_PROVIDER = `
AI providers derive from a single registry. An OpenAI-compatible vendor is one
descriptor — no new class. A bespoke wire format adds a \`create()\` factory on the
same descriptor. Labels, default model, model choices, pricing, vision support,
key resolution, the Settings UI, and the status route **all derive** from this
one entry.

## An OpenAI-compatible vendor

\`\`\`ts
// packages/shared/src/config.ts — add to PROVIDER_REGISTRY
{
  id: "myvendor", label: "My Vendor", kind: "openai-compatible",
  envKey: "MYVENDOR_API_KEY",
  baseURL: "https://api.myvendor.com/v1",
  defaultModel: "my-model-1",
  models: [
    { id: "my-model-1", label: "My Model 1", speed: "normal",
      costTier: "mid", pricing: { inUsd: 0.5, outUsd: 1.5 } },
  ],
}
// then add "myvendor" to the PROVIDERS list.
\`\`\`

## A bespoke transport

If the vendor isn't OpenAI-compatible, add a factory that returns an
\`AiProvider\`. The server's \`getProvider\` looks the factory up in
\`PROVIDER_FACTORIES\` (and falls back to the OpenAI-compatible client, then the
mock):

\`\`\`ts
// on the same descriptor:
create: (model, key) => new MyVendorProvider(model, key),
\`\`\`

An \`AiProvider\` implements \`complete\`, \`completeStream\`, and optionally
\`completeWithImages\` (vision). Return text plus a token \`usage\` count so the
metering and per-account limits work.

> [!NOTE]
> The provider registry lives in \`packages/shared\` precisely so the server (key
> resolution, the factory) and the web app (the Settings picker, pricing labels)
> read the *same* source. Add the model once; both ends update.
`;

export const ADD_AN_AGENT_TOOL = `
In agent mode the planner emits a list of steps, each naming a **tool**. The
built-in tools live in one registry — \`AGENT_TOOLS\` in
\`apps/server/src/services/agent.ts\` — which is the single source for each tool's
name, whether it may run in parallel, and its execution.

## Add one entry

\`\`\`ts
// apps/server/src/services/agent.ts — a key in AGENT_TOOLS: Record<AgentTool, ToolDef>
list_dependencies: {
  // Read-only + side-effect-free tools may be batched concurrently; omit
  // \`parallel\` for anything that writes or depends on a prior step's result.
  parallel: true,
  run: async ({ description, chat, provider, sources, signal }) => {
    if (!chat.workspaceId) return "[No workspace attached]";
    // ... do the work, return a string the model reads as the step result ...
    return "react@18, fastify@5, …";
  },
},
\`\`\`

Then add the name to the \`AgentTool\` union in \`packages/shared/src/types.ts\`.
Because \`AGENT_TOOLS\` is typed \`Record<AgentTool, ToolDef>\`, the compiler **forces**
every union member to have an entry — forget one and the build fails. The planner
schema enum, the parallel-batching set, the replanner prompt, and the dispatcher
all derive from this table; nothing else needs touching.

## The tool contract

- The \`run\` receives a \`ToolContext\`: the step \`description\`, the \`chat\`, the
  \`provider\`, the shared \`sources\` array (search tools \`push\` results onto it for
  citation), and an \`AbortSignal\`.
- **Return a string** — it becomes the step result the model reads. For a soft
  failure, return a \`[bracketed message]\`; the synthesis step still sees it.
- **Throw** to mark the step \`failed\` and arm a re-plan — do this when a retry
  with a corrected plan could succeed (e.g. an unknown MCP server name).

> [!IMPORTANT]
> This is the chat agent's flat tool vocabulary. The run engine's ordered
> pipeline blocks (\`BlockType\` in \`runs/actionEngine.ts\`) are a **separate**
> system with a different execution model — don't conflate the two.
`;

export const ADD_A_COMMAND = `
The Cmd+K palette is a registry too. Any mounted component can contribute
commands — they merge with the built-ins, ranked by the palette's fuzzy matcher,
and unregister automatically when the component unmounts. The same model powers
this docs site's search.

## Contribute commands

\`\`\`tsx
import { useMemo } from "react";
import { useRegisterCommands } from "../lib/commands";
import { Sparkles } from "lucide-react";

function MyFeature() {
  const items = useMemo(
    () => [
      {
        id: "my-feature:do-thing",
        label: "Do the thing",
        description: "Runs the thing in the current workspace",
        section: "My Feature",
        icon: <Sparkles className="h-4 w-4" />,
        keybinding: "Mod+Shift+T",   // user-remappable
        onSelect: () => { /* … */ },
      },
    ],
    [],
  );
  useRegisterCommands("my-feature", items);
  return /* … */;
}
\`\`\`

## Notes

- Pass a **memoized** \`items\` array (\`useMemo\`) so the registry isn't churned on
  every render.
- Set \`queryOnly: true\` for large dynamic sets (e.g. file search) so they only
  appear once the user types — otherwise they flood the empty palette.
- \`keybinding\` is a *default*; the user can remap it in Settings, and the global
  Keybindings handler fires it. \`Mod\` is ⌘ on macOS, Ctrl elsewhere.
`;

export const ADD_A_WORKSPACE = `
A workspace is a local folder plus include/exclude globs. You create one, scan it
into a **snapshot** (the file list) and an embedding index, and from then on
everything — chat retrieval, the data tab, runs — reads from that snapshot.

## Create, scan, read

\`\`\`bash
# 1. Create — rootPath is an absolute local folder
curl -s -X POST localhost:4319/api/workspaces \\
  -H 'content-type: application/json' \\
  -d '{"name":"Notes","rootPath":"/Users/me/notes"}'
# → { id, name, rootPath, ... }

# 2. Scan → snapshot + embeddings; emits an SSE scan-complete event
curl -s -X POST localhost:4319/api/workspaces/<id>/scan

# 3. Read the snapshot the UI renders from
curl -s localhost:4319/api/workspaces/<id>/snapshot
\`\`\`

## Configure it

Per-workspace settings — the default model, the home view, visibility — live on
the workspace row and are set with \`PATCH /api/workspaces/:id\`. A workspace can
pin its **own** provider + model, overriding the account default for its chats.

To scaffold starter files and a custom surface when the workspace is created,
pass a \`starter\` id that matches a [project](/developers/contribute-a-project).

> [!NOTE]
> Scanning is incremental and content-addressed — re-scanning a mostly-unchanged
> folder only re-embeds what changed, so it's cheap to keep a workspace fresh.
`;

export const CONTRIBUTE_A_PROJECT = `
A **project** under \`projects/<name>/\` is a self-contained example app that plugs
into Ariadne through registries — it can contribute server routes, run templates,
i18n strings, and a web view, without the core enumerating it. \`lecture\` and
\`portfolio\` are the shipped examples.

## What a project can contribute

| Contribution | How |
| --- | --- |
| Server routes | export a \`routes\` plugin from the project's \`server.ts\` |
| Run templates | the project registers its templates; core no longer hardcodes them |
| A web screen | a route element merged into the app's router via \`PROJECT_ROUTES\` |
| Localized copy | the project owns its i18n namespace; core lifts no project strings |

## The shape

\`\`\`text
projects/lecture/
  server.ts        the project's server module (routes, templates)
  server/          route handlers + generators (deck, doc, exam)
  web/             the React view + its api client + i18n
  types.ts         types shared within the project
\`\`\`

> [!TIP]
> Projects are the strongest test of the "register, don't hardcode" claim: if
> adding \`lecture\` required editing core, the seams would leak. They don't — a
> project is added and removed by its folder plus its registry entries.
`;

export const AUTH_MODEL = `
Ariadne's security model is one distinction drawn in one place: **how did this
request arrive?** Everything dangerous hangs off the answer.

## Local vs remote

\`accessContext(req)\` returns \`"local"\` for a request on a genuine loopback
connection with no proxy headers, and \`"remote"\` otherwise.

| | Local (loopback) | Remote (tunnel) |
| --- | --- | --- |
| Identity | the admin, implicitly | must carry a session cookie |
| Terminal / PTY | ✅ allowed | ❌ refused |
| Host filesystem & git | ✅ allowed | ❌ refused |
| Chat, workspaces, runs | ✅ | ✅ (when authenticated) |

A loopback request *is* the admin — there's no separate login on your own
machine. The same server reached through the Cloudflare tunnel is \`remote\`: it
needs a cookie and loses the local-only powers, even for the same person.

## Applying it in a route

\`\`\`ts
// refuse remote callers outright (mutations, shell, fs):
if (await rejectRemoteAccess("Local only.", req, reply)) return;

// or branch on it:
if (accessContext(req) === "local") {
  // expose the powerful path
}
\`\`\`

The \`/api\` scope runs an \`onRequest\` auth hook with a small allowlist of
unauthenticated paths (login, logout, guest, and trigger-secret webhooks). Add
genuinely public endpoints to \`PUBLIC_ROUTES\` so they register outside that
scope — deliberately, and rarely.

> [!WARNING]
> Never infer "local" from a header like \`X-Forwarded-For\` — those are
> attacker-controllable through a proxy. Trust only \`accessContext\`, which reads
> the real connection.
`;

export const ARCHITECTURE_OVERVIEW = `
A React single-page app talks to a Fastify server over **four channels** — REST,
server-sent events, a terminal WebSocket, and \`postMessage\` to the sandboxed
surface iframe. The server owns everything stateful; the browser reaches none of
it directly.

\`\`\`diagram
system
The browser never touches storage or providers directly — every path goes
through the Fastify routes, which the auth hook gates (loopback = admin,
remote = cookie).
\`\`\`

## The four channels

- **REST** (\`/api/*\`) — the bulk of the surface: workspaces, chats, runs,
  settings. JSON in, JSON out, behind the auth hook.
- **SSE** — streaming. A chat reply or a run streams tokens and status events
  back over a long-lived \`text/event-stream\` so the UI updates live.
- **Terminal WebSocket** — a node-pty session, **local only**. The browser is a
  thin xterm.js front end over the PTY.
- **postMessage** — a custom surface runs in a sandboxed iframe and talks to the
  host only through a typed \`postMessage\` bridge, never the DOM or network
  directly.

## What the server owns

SQLite (via \`node:sqlite\`), the embedding index, the AI providers, and the
host's git, PTY, and filesystem. Concentrating these behind the routes is what
lets one predicate — local vs remote — govern every dangerous capability. See
[the auth model](/developers/auth-model).
`;

export const REQUEST_LIFECYCLE = `
What happens between hitting **send** and the first token? A chat message is the
busiest path in the system — here's the whole pipeline.

\`\`\`diagram
request-lifecycle
streamAssistantReply resolves the effective settings (a workspace's model
override, else the account default), classifies on a cheap triage tier,
retrieves top-k chunks, calls the metered provider, and streams deltas over SSE.
\`\`\`

## Stages

1. **Resolve settings** — the effective provider + model: a workspace's pin if
   it has one, otherwise the account default.
2. **Triage** — a cheap model classifies the turn (does it need retrieval? web
   search? agent mode?) so the expensive model isn't paid for trivial turns.
3. **Retrieve** — top-k chunks from the workspace's embedding index become
   grounding context, each carrying its source for citation.
4. **Generate** — the metered provider call, streamed. Token usage is counted
   against the account's limits as it flows.
5. **Stream** — deltas and status events go back over SSE; the client renders
   them live.

> [!NOTE]
> **Instant mode** skips triage and retrieval and streams a direct provider
> answer — the right call for a quick back-and-forth where grounding would only
> add latency.
`;

export const DATA_MODEL = `
The **workspace** is the hub of the data model. Scanning a workspace produces a
snapshot and an embedding index; chats, runs, a surface, and memory all hang off
it. Everything is stored in \`node:sqlite\`.

\`\`\`diagram
data-model
A scan produces a snapshot (file list) plus an embedding index; chats, runs, the
surface, and memory all reference the workspace.
\`\`\`

## The entities

- **Workspace** — a local folder + include/exclude globs + its per-workspace
  config (default model, home view, visibility).
- **Snapshot** — the file list a scan produced; the UI and retrieval render from
  it, not from a live directory walk.
- **Chat / Message** — conversations grounded in the workspace, with optional
  agent traces and staged edits.
- **Run** — a template execution: ordered pipeline blocks, their staged output,
  and a diff to review.
- **Memory** — confirmed facts that ride along into both the planner and the
  synthesis prompts.

> [!TIP]
> Migrations are **additive-only** — every boot re-runs \`CREATE TABLE IF NOT
> EXISTS\` plus guarded column adds. There's no version table and no
> down-migrations, so keep new columns nullable or defaulted.
`;
