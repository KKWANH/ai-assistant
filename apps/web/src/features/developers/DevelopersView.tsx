/**
 * DevelopersView — the in-app developer docs hub (/developers). A docs-style
 * shell (sidebar sections) over the API reference, architecture diagrams, and
 * extension guides. Aimed at open-source contributors: how the backend is laid
 * out, how to add a workspace, and how to extend the server.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Boxes, Terminal, GitBranch, Workflow, ArrowLeft } from "lucide-react";
import { ApiReference } from "./ApiReference";
import { SystemDiagram, RequestLifecycleDiagram, DataModelDiagram } from "./diagrams";

type SectionId = "overview" | "architecture" | "api" | "guides";

const NAV: { id: SectionId; label: string; icon: typeof BookOpen }[] = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "architecture", label: "Architecture", icon: Boxes },
  { id: "api", label: "API Reference", icon: GitBranch },
  { id: "guides", label: "Guides", icon: Workflow },
];

/** Monospace code block. */
function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="rounded-lg border border-border bg-surface-2 p-3 text-2xs font-mono text-foreground overflow-x-auto leading-relaxed">
      {children}
    </pre>
  );
}

function Figure({ title, children, caption }: { title: string; children: ReactNode; caption?: string }) {
  return (
    <figure className="rounded-xl border border-border bg-card p-4">
      <figcaption className="text-xs font-semibold text-foreground mb-3">{title}</figcaption>
      {children}
      {caption && <p className="text-2xs text-muted-foreground mt-3 leading-snug">{caption}</p>}
    </figure>
  );
}

function Overview() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Ariadne for developers</h2>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          A local-first AI workspace platform (AGPL-3.0). It runs on your machine, points every answer back at the source,
          and is built to be extended. Three ideas shape the codebase:
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { t: "Local-first", d: "The server binds to loopback; a loopback request IS the admin. Remote access (the tunnel) requires a cookie and loses local-only powers like the terminal." },
          { t: "Register, don't hardcode", d: "Commands, settings, surfaces — and the server's API routes — are registries. Neither the web shell nor the server bootstrap enumerates them; you contribute a hook or a CORE_ROUTES entry." },
          { t: "Dual-use", d: "A power-user IDE (editor, git, terminal, surfaces) and an easy non-developer mode, toggled per account and per workspace." },
        ].map((x) => (
          <div key={x.t} className="rounded-lg border border-border bg-card p-3">
            <h3 className="text-xs font-semibold text-accent mb-1">{x.t}</h3>
            <p className="text-2xs text-muted-foreground leading-snug">{x.d}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Monorepo layout</h3>
        <Code>{`apps/
  server/   Fastify + node:sqlite — routes/ services/ providers/ surface/ db/
  web/      React 18 + Vite + Tailwind v4 — features/ components/ lib/
  desktop/  Tauri shell (sidecar spawns the server)
  admin/    supervisor (process management)
packages/
  shared/   zod schemas, types, theme, the provider registry — imported by both apps
projects/   static example projects (lecture, portfolio) contributed via a registry`}</Code>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Run it</h3>
        <Code>{`npm install
./ops/ariadne.sh restart      # build web + (re)start the server on :4319
# or for development:
npm run dev:server            # tsx watch — the API on :4319
npm run dev:web               # vite on :5173 (proxies /api → :4319)`}</Code>
        <p className="text-2xs text-muted-foreground">
          Web changes are served from <code className="font-mono">apps/web/dist</code>; rebuild + restart with{" "}
          <code className="font-mono">./ops/ariadne.sh restart</code>.
        </p>
      </div>
    </div>
  );
}

function Architecture() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Architecture</h2>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          A React SPA talks to a Fastify server over four channels — REST, server-sent events, a terminal WebSocket, and{" "}
          <code className="font-mono text-xs">postMessage</code> to the sandboxed surface iframe. The server owns sqlite,
          the embedding index, the AI providers, and the host's git/PTY/filesystem.
        </p>
      </div>
      <Figure
        title="System"
        caption="The browser never reaches storage or providers directly — everything goes through the Fastify routes, which the auth hook gates (loopback = admin, remote = cookie)."
      >
        <SystemDiagram />
      </Figure>
      <Figure
        title="A chat message's lifecycle"
        caption="streamAssistantReply resolves the effective settings (a workspace's model override, else the account default), classifies on a cheap triage tier, retrieves top-k chunks, calls the metered provider, and streams deltas back over SSE. 'instant' mode skips triage + retrieval."
      >
        <RequestLifecycleDiagram />
      </Figure>
      <Figure
        title="Data model"
        caption="The workspace is the hub: a scan produces a snapshot + embedding index; chats, runs, a surface, and memory all hang off it. Stored in node:sqlite."
      >
        <DataModelDiagram />
      </Figure>
    </div>
  );
}

function Guides() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Guides</h2>
        <p className="text-sm text-muted-foreground mt-1">Common extension points, end to end.</p>
      </div>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Boxes className="h-4 w-4 text-accent" /> Add a workspace
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A workspace is a local folder plus include/exclude globs. Create one, scan it into a snapshot + embedding index,
          then everything (chat retrieval, the data tab, runs) reads from that snapshot.
        </p>
        <Code>{`# 1. Create — rootPath is an absolute local folder
curl -s -X POST localhost:4319/api/workspaces \\
  -H 'content-type: application/json' \\
  -d '{"name":"Notes","rootPath":"/Users/me/notes"}'
# → { id, name, rootPath, ... }

# 2. Scan → snapshot (file list) + embeddings; emits an SSE scan-complete
curl -s -X POST localhost:4319/api/workspaces/<id>/scan

# 3. Read the snapshot the UI renders from
curl -s localhost:4319/api/workspaces/<id>/snapshot`}</Code>
        <p className="text-2xs text-muted-foreground leading-snug">
          Per-workspace config (default model, home view, visibility) lives on the workspace row and is set via{" "}
          <code className="font-mono">PATCH /api/workspaces/:id</code>. To scaffold files + a custom surface on create, pass
          a <code className="font-mono">starter</code> id (see <code className="font-mono">projects/</code>).
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-accent" /> Extend the backend — add a route
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every route file exports a plugin <code className="font-mono text-xs">(app) =&gt; {`{ … }`}</code>. You don't touch{" "}
          <code className="font-mono text-xs">index.ts</code> — append ONE entry to the route registry (
          <code className="font-mono text-xs">routes/registry.ts</code>), which the bootstrap iterates inside the{" "}
          <code className="font-mono text-xs">/api</code> scope (so the auth hook runs). Guards come from{" "}
          <code className="font-mono text-xs">workspaceGuard.ts</code>.
        </p>
        <Code>{`// apps/server/src/routes/notes.ts
import type { FastifyInstance } from "fastify";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

export async function noteRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { text?: string } }>(
    "/workspaces/:id/notes",
    async (req, reply) => {
      // mutations should refuse remote access
      if (await rejectRemoteAccess("Local only.", req, reply)) return;
      const ws = await requireWorkspace(req.params.id, req, reply); // write access
      if (!ws) return;
      // ... do the work against ws.rootPath ...
      return reply.send({ ok: true });
    },
  );
}

// apps/server/src/routes/registry.ts — append ONE entry; index.ts iterates it:
{ domain: "notes", description: "Workspace notes.", register: noteRoutes },`}</Code>
        <ul className="text-2xs text-muted-foreground space-y-1 list-disc pl-4 leading-snug">
          <li><code className="font-mono">requireWorkspace(id, req, reply, "read")</code> for reads; omit the 4th arg for owner/write.</li>
          <li><code className="font-mono">accessContext(req)</code> is <code className="font-mono">"local"</code> only on a real loopback connection — gate dangerous powers (shell, fs) on it.</li>
          <li>Heavy work belongs in <code className="font-mono">services/</code>; keep route handlers thin.</li>
          <li>Re-run <code className="font-mono">node scripts/gen-api-inventory.mjs</code> and your route shows up here automatically.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Terminal className="h-4 w-4 text-accent" /> Add an AI provider
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Providers derive from a single registry. An OpenAI-compatible vendor is one descriptor — no new class. A bespoke
          transport (non-OpenAI wire format) adds a <code className="font-mono text-xs">create()</code> factory on the same
          descriptor.
        </p>
        <Code>{`// packages/shared/src/config.ts — PROVIDER_REGISTRY
{
  id: "myvendor", label: "My Vendor", kind: "openai-compatible",
  envKey: "MYVENDOR_API_KEY",
  baseURL: "https://api.myvendor.com/v1",
  defaultModel: "my-model-1",
  models: [
    { id: "my-model-1", label: "My Model 1", traitKey: "model.trait.minimax",
      speed: "normal", costTier: "mid", pricing: { inUsd: 0.5, outUsd: 1.5 } },
  ],
  // bespoke transport instead of openai-compatible? add:
  // create: (model, key) => new MyVendorProvider(model, key),
}
// then add "myvendor" to PROVIDERS. Labels, defaults, model choices, pricing,
// vision, key resolution, the settings UI + status route all derive from it.`}</Code>
      </section>
    </div>
  );
}

export function DevelopersView() {
  const [section, setSection] = useState<SectionId>("overview");
  return (
    <div className="flex-1 min-h-0 flex">
      {/* Sidebar nav */}
      <aside className="w-52 shrink-0 border-r border-border overflow-y-auto p-3 hidden md:block">
        <Link to="/" className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3 w-3" /> Back to app
        </Link>
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-2">Developer docs</p>
        <nav className="space-y-0.5">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = section === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                className={[
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                  active ? "bg-accent/10 text-accent font-medium" : "text-foreground hover:bg-surface-3",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {n.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Mobile section tabs */}
        <div className="md:hidden flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setSection(n.id)}
              className={["shrink-0 px-2.5 py-1 rounded-md text-xs", section === n.id ? "bg-accent/10 text-accent" : "text-muted-foreground"].join(" ")}
            >
              {n.label}
            </button>
          ))}
        </div>
        <div className="p-5 sm:p-8">
          {section === "overview" && <Overview />}
          {section === "architecture" && <Architecture />}
          {section === "api" && <ApiReference />}
          {section === "guides" && <Guides />}
        </div>
      </div>
    </div>
  );
}
