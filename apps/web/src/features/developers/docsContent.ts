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
projects/   self-contained example projects (lecture, papers, budget, …), each contributed via a registry
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
    // traitKey is required — an i18n key for the one-line trait shown in the
    // model picker (falls back to the key if you haven't added a translation).
    { id: "my-model-1", label: "My Model 1", traitKey: "model.trait.myvendor",
      speed: "normal", costTier: "mid", pricing: { inUsd: 0.5, outUsd: 1.5 } },
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
i18n strings, and a web view, without the core enumerating it. Seven ship today
— \`budget\`, \`chefbook\`, \`code\`, \`decisions\`, \`lecture\`, \`papers\`, and \`reading\`.

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
| Chat, runs, read/edit workspace files, git status/diff | ✅ | ✅ (authenticated) |
| Terminal / PTY | ✅ allowed | ❌ refused |
| Host-path file picker, scripts, git commit | ✅ allowed | ❌ refused |

A loopback request *is* the admin — there's no separate login on your own
machine. The same server reached through the Cloudflare tunnel is \`remote\`: it
keeps the workspace-scoped API (reads, edits, git status/diff) once
authenticated, but loses the **host-level** powers — the terminal, the host-path
folder picker, running scripts, and git commit stay local-only for everyone.

## Applying it in a route

\`\`\`ts
// refuse remote callers outright (shell, the host-path picker, git commit):
if (await rejectRemoteAccess("Local only.", req, reply)) return;

// or branch on it:
if (accessContext(req) === "local") {
  // expose the powerful path
}
\`\`\`

The \`/api\` scope runs an \`onRequest\` auth hook with a small allowlist of
unauthenticated paths (login, logout, reset, guest, and trigger-secret
webhooks). Add
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

// --- Concepts ---------------------------------------------------------------

export const SURFACES = `
A **surface** is a custom interactive screen — a dashboard, a tool, a control
panel — that you write in TypeScript/React and attach to a workspace. It runs in
a **sandboxed iframe** and reaches Ariadne only through a typed bridge, so it can
be powerful without being dangerous.

## The sandbox

A surface is served into an \`<iframe sandbox="allow-scripts">\` — note the absence
of \`allow-same-origin\`, so it cannot read the parent's cookies or DOM, and cannot
call \`/api\` directly. Every capability arrives over a \`postMessage\` bridge that
the host (running with your session) brokers: the surface asks, the host performs
the authenticated call and returns the result. A render crash inside a surface is
caught and shown as a banner — it can't take down the app.

## What a surface can do

Through the SDK hook \`useAriadne()\`, a surface can:

- **Ask the workspace's model** — \`ask(prompt)\` for a one-shot completion.
- **Search the workspace** — \`search(query)\` for the most relevant file chunks.
- **Read files** — \`listFiles()\`, \`readText(path)\`, \`readCsv(path)\`.
- **Persist its own state** — \`getState()\` / \`setState(json)\`.
- **Run templates & actions** — \`runTemplate\`, \`runAction\`, \`getRun\`.
- **Stage a file edit** for review — \`stageFile(path, content)\`.
- **Pull market data** — quotes, FX, history, dividends, news (best-effort).

It also gets a **UI kit** (Card, Stat, Button, Badge, Grid) and **charts**
(LineChart, BarChart, PieChart) that already track the app's theme.

## Where it lives

A surface is a file in the workspace — \`.ariadne/surface.tsx\` (or a
\`.ariadne/surface/\` folder for multiple files). The server bundles it with
esbuild into \`.ariadne/surface-dist/bundle.js\` and serves it to the iframe. Set
the workspace's home view to **surface** and it becomes the immersive landing
screen, no tabs.

> [!NOTE]
> Surfaces are authored locally only — the editor and the build run on your
> machine. [Build a surface](/developers/build-a-surface) walks through the full
> SDK with a starter.
`;

export const RUNS_AND_TEMPLATES = `
A **run** is a recorded execution of a **template** (a structured,
evidence-first research task) or an **action** (an ordered pipeline of blocks).
Runs are traceable: each records its inputs, the files it chose, its steps, and
its output, so you can re-open — or re-run — it later.

## Templates

A template declares its inputs, the Markdown **sections** its output must
contain, and whether evidence and a re-run diff are required. The built-ins
(research brief, investment memo, job-search review, source audit) ship in the
server; **projects contribute their own** via \`registerProjectTemplates(...)\` at
boot, so the core never hardcodes a project's templates.

A template run moves through phases — \`created → scanning → context_pick →
generating → completed\` — and **pauses at \`context_pick\`** so you approve which
files it grounds on before it spends the expensive model.

## Actions: the block pipeline

An action is an ordered list of **blocks**, each feeding its output to the next:

| Block | Does |
| --- | --- |
| \`ask_ai\` | Ask the model (with workspace retrieval + memory) |
| \`web_analysis\` | Web search + summarize |
| \`run_script\` | Run a workspace \`.sh\` / \`.py\` script |
| \`read_file\` | Read a file's content |
| \`write_file\` | Append to or replace a file |
| \`edit_file\` | Stage a change for review |
| \`run_tests\` | Run a test command, capture pass/fail |

Each block receives the previous block's output (capped at 8&nbsp;KB). The
pipeline is **fail-fast** — the first failed block stops the run, and every
block's result is recorded so you see exactly where it stopped.

> [!IMPORTANT]
> These block types are the run engine's vocabulary — a **separate** system from
> the chat agent's tools. [Add an agent tool](/developers/add-an-agent-tool)
> explains the distinction.

## Staged edits & review

\`edit_file\` (and the chat agent's edits) never write straight to your files.
They **stage** the change under \`.ariadne/staged/<runId>/\` as a before/after
diff. You review it, pick which paths to apply, and only then is it written — and
committed to the workspace's history. Nothing touches your working tree without
your approval.
`;

export const MEMORY = `
**Memory** is a small set of facts the assistant has confirmed about a workspace
— things like *"the test command is \`npm run typecheck\`"* or *"the database is
Postgres 14."* Confirmed facts ride along into the model's prompts so it stops
re-deriving (or guessing) them.

## Where it lives

Memory is a human-editable file in the workspace: \`.ariadne/memory.yaml\`. No
database, no hidden state — open it, read it, edit it. Each entry is a single
sentence (≤ 500 chars) plus when it was added, by whom, and an optional source
(the chat message it came from).

## How it's used

When you save a fact, it's injected — as an authoritative block — into:

- the **agent planner** prompt, so step-picking reflects it,
- the **synthesis** prompt, so the final answer reflects it,
- and the run engine's **\`ask_ai\`** block.

The render is capped (~60 entries / 6&nbsp;KB) to stay within the context
budget; beyond that the oldest are truncated with a note.

## Manage it

| Method | Path | Access |
| --- | --- | --- |
| GET | \`/api/workspaces/:id/memory\` | read |
| POST | \`/api/workspaces/:id/memory\` | write |
| DELETE | \`/api/workspaces/:id/memory/:memId\` | write |

Listing needs read access; adding and deleting need write.

> [!TIP]
> Because memory is just a YAML file in the workspace, it travels with the
> workspace and is reviewable in version control — the facts the AI leans on are
> never opaque.
`;

// --- Extending (additions) --------------------------------------------------

export const BUILD_A_SURFACE = `
A surface is a TypeScript/React screen you attach to a workspace, written against
the \`@ariadne/surface\` SDK. The server bundles it and runs it in a sandboxed
iframe — see [Surfaces](/developers/surfaces) for the security model; this page
is the SDK.

## A minimal surface

\`\`\`tsx
// .ariadne/surface.tsx
import { useAriadne, Card, Stat, Grid, useState, useEffect } from "@ariadne/surface";

export default function Surface() {
  const ariadne = useAriadne();
  const [files, setFiles] = useState([]);
  useEffect(() => { ariadne.listFiles().then(setFiles); }, [ariadne]);

  return (
    <Card title="Workspace">
      <Grid cols={2} gap={12}>
        <Stat label="Files" value={files.length} />
      </Grid>
    </Card>
  );
}
\`\`\`

The default export is your surface. Edit it in the workspace's surface editor
(local only) — it auto-builds and live-previews as you type.

## The SDK — useAriadne()

\`useAriadne()\` returns a stable object. The core methods:

| Method | Returns |
| --- | --- |
| \`ask(prompt)\` | the model's reply (string) |
| \`search(query)\` | \`{ path, text }[]\` — top workspace chunks |
| \`listFiles()\` | \`{ path, size, extension, estimatedTokens }[]\` |
| \`readText(path)\` | file content |
| \`readCsv(path)\` | \`{ headers, rows }\` |
| \`getState()\` / \`setState(json)\` | this surface's persisted state (≤ 256 KB) |
| \`listTemplates()\` / \`runTemplate(id, input)\` / \`getRun(id)\` | templates + runs |
| \`runAction(id, input)\` | run an \`actions.yaml\` action |
| \`stageFile(path, content)\` | stage a data-file edit for review |

Market data (best-effort): \`getQuotes\`, \`getQuotesDetailed\`, \`getFxRates\`,
\`getQuoteHistory\`, \`getQuoteNews\`, \`getDividendHistory\`, \`getQuoteCalendars\`.

## The UI kit

Themed components, all from \`@ariadne/surface\`:

- **\`Card\`** — \`{ title?, children }\`
- **\`Stat\`** — \`{ label, value, delta? }\` (\`delta\` colours green/red with an arrow)
- **\`Button\`** — \`{ label, onClick?, variant?: "primary" | "ghost", disabled? }\`
- **\`Badge\`** — \`{ label, tone?: "neutral" | "success" | "warning" | "danger" | "info" }\`
- **\`Grid\`** — \`{ cols?, gap?, children }\`
- **Charts** — \`LineChart\`, \`BarChart\`, \`PieChart\`, each \`{ data: { label, value }[], title?, … }\`

The common React hooks (\`useState\`, \`useEffect\`, \`useMemo\`, \`useRef\`,
\`useCallback\`) are re-exported too. Use the kit and \`rgb(var(--…))\`
[theme variables](/developers/theming) instead of hardcoded colours, so the
surface tracks light/dark automatically.

## Persist state

\`\`\`tsx
const ariadne = useAriadne();
// load once on mount
useEffect(() => { ariadne.getState().then((s) => { if (s) restore(s); }); }, [ariadne]);
// save (JSON, ≤ 256 KB) — lands in .ariadne/surface-state.json
const save = (next) => ariadne.setState(next);
\`\`\`

> [!NOTE]
> The SDK contract is versioned (\`API_VERSION\`). A surface can record the version
> it targets with \`export const apiVersion = N\`.
`;

export const ADD_A_SETTING = `
The Settings screen is a registry. Any component can contribute a section of
settings while it's mounted — it appears alongside the built-in sections with no
edit to the settings screen itself.

## Register a section

\`\`\`tsx
import { useMemo } from "react";
import { useRegisterSettings, type SettingsSection } from "../../lib/settings-registry";

function MyFeatureSettings() {
  const [verbose, setVerbose] = useMyStore();
  const section: SettingsSection = useMemo(
    () => ({
      title: "My Feature",
      fields: [
        {
          id: "verbose",
          label: "Verbose logging",
          description: "Print extra detail to the console",
          type: "toggle",
          value: verbose,
          onChange: setVerbose,
        },
      ],
    }),
    [verbose, setVerbose],
  );
  useRegisterSettings("my-feature", section);
  return null; // or your feature's UI
}
\`\`\`

## Field types

A \`SettingsField\` is one of:

- **\`toggle\`** — \`{ type, id, label, description?, value: boolean, onChange }\`
- **\`select\`** — \`{ type, id, label, value: string, options: { value, label }[], onChange }\`

## Notes

- **State is yours.** The registry only renders the control; each field carries
  its own \`value\` + \`onChange\`, so the setting lives in your store/hook. Persist
  it wherever fits (a store, localStorage, or the server).
- **Memoize the section** (\`useMemo\`) so it isn't re-registered every render.
- Re-registering the same \`id\` replaces its section; unmounting removes it — the
  same model as the [command palette](/developers/add-a-command).
`;

export const CONNECT_MCP = `
Ariadne speaks the **Model Context Protocol**. Register an MCP server and the
chat agent can call its tools — no code, just configuration. Servers are
per-account and spawned locally (stdio), so registering one is a local-only
operation.

## Register a server

\`\`\`bash
curl -s -X POST localhost:4319/api/mcp-servers \\
  -H 'content-type: application/json' \\
  -d '{
    "name": "fs",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/notes"],
    "enabled": true
  }'
\`\`\`

| Field | Meaning |
| --- | --- |
| \`name\` | the name the agent refers to (≤ 60 chars) |
| \`command\` | the binary to spawn (\`npx\`, an absolute path, …) |
| \`args\` | arguments appended to the command |
| \`env\` | environment variables (for secrets) |
| \`enabled\` | include it in the agent's inventory (default \`true\`) |

The transport is currently **stdio**. Check the connection with
\`POST /api/mcp-servers/:id/test\` and list its tools with
\`GET /api/mcp-servers/:id/tools\`.

## How the agent uses it

At the start of an agent run, Ariadne connects to each enabled server (10&nbsp;s
timeout, cached) and lists its tools (cached 60&nbsp;s) so the planner sees the
**real** tool names. The planner then emits an \`mcp_call\` step whose description
is:

\`\`\`text
<serverName>::<toolName> <json-args>
# e.g.   fs::read_text_file {"path":"/Users/me/notes/todo.md"}
\`\`\`

A failed tool call flips the step to failed and the agent re-plans with the
refreshed inventory. [Add an agent tool](/developers/add-an-agent-tool) shows how
\`mcp_call\` fits the built-in tool registry.

## Endpoints

| Method | Path |
| --- | --- |
| GET | \`/api/mcp-servers\` |
| POST | \`/api/mcp-servers\` |
| PATCH | \`/api/mcp-servers/:id\` |
| DELETE | \`/api/mcp-servers/:id\` |
| GET | \`/api/mcp-servers/:id/tools\` |
| POST | \`/api/mcp-servers/:id/test\` |
`;

// --- Reference (additions) --------------------------------------------------

export const THEMING = `
Ariadne's look is driven by **design tokens** — semantic names like \`accent\` and
\`surface-2\`, never raw hex. The tokens live in one place and are injected as CSS
custom properties at runtime, so the whole app (and every surface) restyles from
a single source.

## The tokens

\`THEME_TOKENS\` (in \`packages/shared\`) defines a \`dark\` and a \`light\` set — 34
tokens each, as space-separated RGB triples consumed via \`rgb(var(--token))\` (so
Tailwind opacity modifiers like \`bg-accent/10\` work). The groups:

- **Surfaces** — \`background\`, \`surface-1\`, \`surface-2\`, \`surface-3\`, \`card\`
- **Text** — \`foreground\`, \`card-foreground\`, \`muted\`, \`muted-foreground\`
- **Lines & focus** — \`border\`, \`border-strong\`, \`ring\`
- **Accent** — \`accent\`, \`accent-foreground\`
- **Status** — \`success\`, \`warning\`, \`destructive\`, \`info\` (each \`+ -foreground\`)
- **Regions** — \`sidebar\`, \`topbar\`, \`inspector\` (\`+ -foreground\` / \`-border\`)

## Using them

In TSX, every token is a Tailwind utility:

\`\`\`tsx
<div className="bg-surface-2 text-foreground border border-border">
  <span className="text-accent">accent</span>
</div>
\`\`\`

In raw CSS or a surface, read the variable directly — \`rgb(var(--accent))\`.

## Switching modes

\`applyTheme(mode)\` writes every token of the chosen mode onto \`:root\` as a CSS
variable (and toggles a \`.light\` class). The app ships **dark** and **light**;
the toggle is in **Settings → Preferences**. The same system also defines the
type scale (\`--text-2xs\`…\`--text-2xl\`), the radius scale, motion durations, and
the z-index scale.

> [!TIP]
> To add a colour: put the token in \`THEME_TOKENS\` (both modes) and map it in
> \`globals.css\`'s \`@theme inline\` block. It's then a Tailwind utility everywhere
> — the "one source" rule for styling.
`;

export const COMMANDS = `
The repository's npm scripts and the ops helper. Run them from the repo root.

## Run & develop

| Command | What |
| --- | --- |
| \`./ops/ariadne.sh restart\` | build the web app + (re)start the server on :4319 |
| \`npm run dev:server\` | \`tsx watch\` — the API on :4319, restarts on change |
| \`npm run dev:web\` | Vite on :5173 with HMR, proxies \`/api\` → :4319 |
| \`npm run build:web\` | production build of the web app |
| \`npm run start:server\` | run the server once (no watch) |

## Check

| Command | What |
| --- | --- |
| \`npm run typecheck\` | strict \`tsc\` over shared + server + admin + web |
| \`npm run gen:api\` | regenerate the API inventory from the routes |
| \`npm run gen:api:check\` | fail if the committed inventory drifted (a CI gate) |
| \`npm run check:bundle\` | enforce the per-chunk bundle budgets |

## Evaluate

| Command | What |
| --- | --- |
| \`npm run eval:retrieval\` | retrieval-quality eval |
| \`npm run eval:rag\` | end-to-end RAG eval |
| \`npm run eval:strategy\` | agent-strategy eval |

> [!NOTE]
> The production app is served from \`apps/web/dist\`; after a web change, rebuild
> and restart with \`./ops/ariadne.sh restart\`. The dev server on :5173 is for
> iteration only.
`;

// --- Operations -------------------------------------------------------------

export const RUNNING_THE_SERVER = `
\`ops/ariadne.sh\` is the lifecycle tool. It builds the web app, starts a
**supervisor** that owns the server (and the tunnel), and gives you status and
logs. The supervisor keeps the server alive and serves a small admin dashboard.

## The ops CLI

\`\`\`bash
./ops/ariadne.sh start      # build web + launch the supervisor (daemonized)
./ops/ariadne.sh restart    # stop, then start
./ops/ariadne.sh stop       # SIGTERM the supervisor (SIGKILL if it lingers)
./ops/ariadne.sh status     # supervisor PID, server health, current tunnel URL
./ops/ariadne.sh logs NAME  # tail a log — NAME: server (default) | tunnel | supervisor
./ops/ariadne.sh admin      # open the admin dashboard
\`\`\`

## The supervisor

\`start\` launches the supervisor (\`apps/admin\`) as a background daemon. It:

- spawns and **monitors** two children — the server and the Cloudflare tunnel —
  restarting them if they die,
- rotates logs and writes its PID to the run directory,
- serves an **admin dashboard** on \`127.0.0.1:7459\` (loopback only — never
  exposed through the tunnel) with status, log tails, error analysis, and a
  restart button.

The server itself listens on \`:4319\`. See [Configuration](/developers/configuration)
for the ports and directories, and [Remote access](/developers/remote-access) for
reaching it from another device.

> [!NOTE]
> For day-to-day development you don't need the supervisor — run
> \`npm run dev:server\` and \`npm run dev:web\` directly (see
> [Commands](/developers/commands)). The supervisor is for running Ariadne as a
> persistent, self-healing service.
`;

export const CONFIGURATION = `
Ariadne reads its configuration from environment variables, with local-first
defaults — nothing is required to run on your own machine. Set them in your
shell or an uncommitted \`.env\`.

## Server & network

| Variable | Default | Controls |
| --- | --- | --- |
| \`ARIADNE_PORT\` | \`4319\` | the server's HTTP port |
| \`ARIADNE_BIND\` | \`127.0.0.1\` | bind address; \`0.0.0.0\` exposes on all interfaces (login then required) |
| \`ARIADNE_ADMIN_USER\` | \`admin\` | the seeded admin username |
| \`ARIADNE_ADMIN_PASSWORD\` | random (logged once) | the seeded admin password — set it to silence the warning |

## Data & logs

These default under the repo root; point them elsewhere to relocate state.

| Variable | Default | Holds |
| --- | --- | --- |
| \`ARIADNE_HOME\` | \`./data\` | the SQLite DB (\`ariadne.db\`) + settings |
| \`ARIADNE_LOG_DIR\` | \`./logs\` | active + rotated logs |
| \`ARIADNE_RUN_DIR\` | \`./run\` | PID files + the tunnel URL |

## Providers

| Variable | Default | Controls |
| --- | --- | --- |
| \`ARIADNE_PROVIDER\` | \`ollama\` | the default provider when none is set in Settings |
| \`ANTHROPIC_API_KEY\`, \`OPENAI_API_KEY\`, \`GEMINI_API_KEY\`, \`MOONSHOT_API_KEY\`, \`MINIMAX_API_KEY\`, … | — | provider keys (or paste them in **Settings → Providers**) |
| \`OLLAMA_BASE_URL\` | \`http://localhost:11434\` | the local Ollama endpoint |
| \`VLLM_BASE_URL\` | — | required for the vLLM provider |
| \`TAVILY_API_KEY\`, \`BRAVE_API_KEY\` | — | web-search backends |

A key set in **Settings → Providers** is stored in the DB and fills the same
slot; the env var is the fallback.

## State on disk

Two places hold state:

- **\`$ARIADNE_HOME/ariadne.db\`** — the single SQLite database: accounts,
  sessions, settings, workspaces, chats, runs, the embedding + full-text
  indexes, and usage.
- **\`<workspace>/.ariadne/\`** — per-workspace, travels with the folder:
  \`workspace.yaml\` (globs), \`memory.yaml\`, \`actions.yaml\`, \`surface.tsx\` +
  \`surface-dist/\`, \`staged/\` (pending edits), \`scripts/\`, \`hooks/\`.

> [!TIP]
> Because per-workspace state lives in \`.ariadne/\` as plain YAML/TSX, it's
> reviewable in the workspace's own version control — config and memory are never
> hidden inside a database.
`;

export const REMOTE_ACCESS = `
By default Ariadne binds to loopback, and a loopback request is the admin — see
[the auth model](/developers/auth-model). To reach it from another device, expose
it through a **Cloudflare tunnel**. Requests then arrive as \`remote\`,
authenticate with a session cookie, and lose the local-only powers (terminal,
host filesystem).

## The tunnel

The supervisor runs \`cloudflared\` for you, in one of two modes:

- **Quick tunnel** (default, zero-config) — an ephemeral
  \`https://<random>.trycloudflare.com\` URL, printed on \`start\` and shown by
  \`./ops/ariadne.sh status\`. Good for a quick share.
- **Named tunnel** (stable) — set \`ARIADNE_TUNNEL_NAME\` and
  \`ARIADNE_TUNNEL_HOSTNAME\` (a Cloudflare-managed domain you own) and the URL is
  deterministic across restarts. \`ops/setup-tunnel.sh <hostname>\` wires it up.

Either way the tunnel forwards to \`http://localhost:4319\`; the admin dashboard on
\`:7459\` is never exposed.

## Remote authentication

A request arriving through the tunnel is detected as \`remote\` (Cloudflare's
\`cf-*\` headers). Remote callers must authenticate:

| Route | Purpose |
| --- | --- |
| \`POST /api/auth/login\` | username + password → a signed \`ariadne_session\` cookie (30 days) |
| \`POST /api/auth/guest\` | a passwordless guest session |
| \`POST /api/auth/logout\` | clear the session |

The cookie is \`httpOnly\`, \`sameSite=lax\`, \`secure\`, and signed with a secret
generated on first boot.

## Calling the API remotely

On your own machine every \`/api\` call just works — a loopback request is the
admin, so \`curl localhost:4319/api/workspaces\` needs no auth. Through the tunnel
you log in once to get the session cookie, then send it with each call:

\`\`\`bash
BASE=https://your-tunnel.example.com   # your quick- or named-tunnel URL

# 1. Log in — save the signed session cookie to a jar
curl -s -c jar.txt -X POST "$BASE/api/auth/login" \\
  -H 'content-type: application/json' \\
  -d '{"username":"admin","password":"…"}'

# 2. Call any endpoint, sending the cookie back
curl -s -b jar.txt "$BASE/api/workspaces"
\`\`\`

The \`ariadne_session\` cookie is valid for 30 days. \`POST /api/auth/guest\` gets a
passwordless (read-mostly) session the same way. Every curl example in these
docs uses \`localhost:4319\` for brevity — swap in \`$BASE\` and add \`-b jar.txt\` to
run it against a remote instance.

## Who can do what

| Capability | Local | Guest | User | Admin |
| --- | --- | --- | --- | --- |
| Read files, git status/diff, chat | ✅ | ✅ (capped) | ✅ | ✅ |
| Write / edit workspace files | ✅ | ❌ | ✅ (own) | ✅ |
| Agent mode, template runs | ✅ | ❌ | ✅ (own) | ✅ |
| Terminal, host-path picker, scripts, git commit | ✅ | ❌ | ❌ | ❌ |

Local is implicitly admin (no login). Guests are read-mostly with a daily token
cap. The bottom row — the terminal, the host-path folder picker, running
scripts, and git commit — touches the host machine directly, so it stays
**local-only** for everyone and never crosses the tunnel.

> [!WARNING]
> Exposing Ariadne puts your workspaces and AI keys behind a login. Set a strong
> \`ARIADNE_ADMIN_PASSWORD\`, prefer a named tunnel you control, and remember a
> quick-tunnel URL — though random — is reachable by anyone who has it.
`;

export const DESKTOP_APP = `
Ariadne ships an experimental **desktop shell** built with Tauri — a native
window around the same local server, with no browser tab to manage.

## How it works

The Tauri shell (Rust) treats the Node server as a **sidecar**. On launch it:

1. picks a free loopback port,
2. spawns the server (\`npm run start:server\`) with \`ARIADNE_PORT=<port>\`,
   \`ARIADNE_BIND=127.0.0.1\` (forced — the desktop is always loopback-only), and
   \`ARIADNE_DESKTOP=1\`,
3. waits for the port to accept connections, then points the webview at
   \`http://127.0.0.1:<port>\`,
4. on quit, sends \`SIGTERM\` to the server so it shuts down cleanly (closing any
   MCP child processes).

The window loads the built web app from \`apps/web/dist\`.

## Build & run

\`\`\`bash
cd apps/desktop
npm run tauri:dev      # a dev window
npm run tauri:build    # package the app
\`\`\`

> [!NOTE]
> This is an early shell: it currently launches the repo's server via
> \`npm run start:server\`, so it needs Node and the source tree present. A later
> phase will bundle a standalone server binary as a Tauri \`externalBin\` so the
> app is self-contained; macOS signing/notarization isn't wired up yet.
`;

export const EVALUATION = `
Ariadne's retrieval and answer quality are guarded by an **offline eval suite**
under \`apps/server/src/eval\`. Each eval runs labeled cases against fixture
workspaces and reports metrics; some enforce thresholds.

## Retrieval

\`\`\`bash
npm run eval:retrieval            # metrics over the retrieval cases
npm run eval:retrieval -- --ci    # also check the gates in gates.yaml
\`\`\`

Runs the labeled query→expected-file cases (plus safety cases) against four
fixtures (\`code-small\`, \`korean-mixed\`, \`portfolio-small\`, \`safety-fixture\`) and
reports **Hit@1/3/6, MRR, nDCG@6, context precision/recall, distractor-leak
rate**, and latency. \`--ci\` prints PASS/FAIL against the gates (Hit@6 ≥ 0.85,
MRR ≥ 0.65, p95 ≤ 500&nbsp;ms, …); add \`--strict\` to make a failing gate exit
non-zero.

\`npm run eval:retrieval:promoted\` replays cases captured from real 👎 feedback on
your own workspaces — these **do** exit non-zero on a regression, as a guard.

## RAG — answer quality

\`\`\`bash
npm run eval:rag             # deterministic mock answers (default)
npm run eval:rag -- --live   # a real provider from Settings
\`\`\`

Runs answer cases that assert **faithfulness** (each sentence supported by the
retrieved context), expected vs. forbidden claims, and correct **abstention**
when the answer isn't in context. A case passes at faithfulness ≥ 0.85, no
forbidden-claim leaks, and correct abstention. \`--use-db\` builds a scratch index
so the semantic and symbol-boosted strategies have data.

## Strategy

\`\`\`bash
npm run eval:strategy -- --use-db
\`\`\`

Runs the **same** retrieval cases across the ranking strategies — \`keyword-only\`,
\`keyword+symbol\`, \`semantic-only\`, \`auto\` — side by side, so you can see what
each buys. This is the data behind the default retrieval choice.

## Output

Every run writes JSON plus a Markdown report under \`data/evals/<timestamp>/\` —
aggregate metrics, a per-case table, and a failures section.

> [!NOTE]
> The evals are offline, and retrieval/strategy are deterministic — no API key
> needed. \`eval:rag\` defaults to mock answers; pass \`--live\` only to measure a
> real provider.
`;
