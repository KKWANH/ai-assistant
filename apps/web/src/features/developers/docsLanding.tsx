/**
 * DocsLanding — the public docs entry (/developers). Not a usage page: a landing
 * designed to draw a visitor in — what Ariadne is, why it's different, what you
 * can build, and how little it takes to extend it — then funnel them to the
 * quickstart, the app, or the repo. Rendered chrome-free (no breadcrumb/title)
 * by DevelopersView for `hero` pages.
 */
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Eye, Plug, Layers, GitBranch } from "lucide-react";

const REPO_URL = "https://github.com/KKWANH/ai-assistant";

const VALUE_PROPS = [
  {
    icon: MapPin,
    title: "Local-first",
    body: "Runs on your machine. A loopback request is the admin — no login, no cloud, no lock-in. Your files and API keys never leave.",
    to: "/developers/auth-model",
    link: "The auth model",
  },
  {
    icon: Eye,
    title: "Traceable",
    body: "Every answer cites its source. Runs and edits are recorded, staged, and reviewable — you can always see why the AI said what it said.",
    to: "/developers/runs-and-templates",
    link: "Runs & templates",
  },
  {
    icon: Plug,
    title: "Extensible",
    body: "Routes, providers, agent tools, surfaces, settings — all registries. Adding one is a single entry; the platform wires the rest.",
    to: "/developers/add-a-route",
    link: "Start extending",
  },
  {
    icon: Layers,
    title: "Dual-use",
    body: "A power-user IDE — editor, git, terminal, programmable surfaces — and an approachable mode for everyone, toggled per workspace.",
    to: "/developers/surfaces",
    link: "Surfaces",
  },
];

const EXTEND = [
  { label: "a route", to: "/developers/add-a-route", hint: "one registry entry" },
  { label: "a provider", to: "/developers/add-a-provider", hint: "one descriptor" },
  { label: "an agent tool", to: "/developers/add-an-agent-tool", hint: "one run()" },
  { label: "a surface", to: "/developers/build-a-surface", hint: "the SDK" },
  { label: "a setting", to: "/developers/add-a-setting", hint: "a hook" },
  { label: "a command", to: "/developers/add-a-command", hint: "Cmd+K" },
];

const BUILDS = [
  "Lecture decks", "Research papers", "Budgets", "Reading lists",
  "Decisions", "Recipes", "Code review",
];

function PrimaryCta({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90"
    >
      {children}
    </Link>
  );
}

export function DocsLanding() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 lg:px-10">
      {/* Hero */}
      <section className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-2xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Open source · AGPL-3.0 · local-first
        </span>
        <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
          The AI workspace you can{" "}
          <span className="underline decoration-[3px] decoration-foreground/30 underline-offset-[8px]">see into</span>.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Ariadne runs on your machine, points every answer back at its source, and is built —
          top to bottom — to be extended. A power-user IDE and an approachable assistant in one.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <PrimaryCta to="/developers/quickstart">Get started <ArrowRight className="h-4 w-4" /></PrimaryCta>
          <Link
            to="/developers/architecture-overview"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-3"
          >
            How it works
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Open Ariadne →
          </Link>
        </div>
        <p className="mt-6 text-2xs text-muted-foreground">
          138 API endpoints · 7 example projects · runs entirely on your machine
        </p>
      </section>

      {/* Value props */}
      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        {VALUE_PROPS.map((v) => {
          const Icon = v.icon;
          return (
            <div key={v.title} className="rounded-2xl border border-border bg-card p-5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
                <Icon className="h-5 w-5 text-accent" />
              </span>
              <h3 className="mt-3 text-base font-semibold text-foreground">{v.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{v.body}</p>
              <Link to={v.to} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                {v.link} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          );
        })}
      </section>

      {/* Register, don't hardcode */}
      <section className="mt-16">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Register, don't hardcode</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The whole platform is registries — the nav, the schema, the search, even these docs derive
            from the same source. Extending it is one entry, end to end. Add…
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXTEND.map((e) => (
            <Link
              key={e.label}
              to={e.to}
              className="group flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 transition hover:border-accent/50 hover:bg-surface-3"
            >
              <span className="text-sm font-medium text-foreground">Add {e.label}</span>
              <span className="text-2xs text-muted-foreground transition group-hover:text-accent">{e.hint} →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* What you can build */}
      <section className="mt-16 rounded-2xl border border-border bg-surface-1 p-7 text-center">
        <h2 className="text-xl font-semibold text-foreground">Built for real work</h2>
        <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
          Seven example projects ship in the repo — each a self-contained folder that plugs in
          through registries, without the core knowing they exist.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {BUILDS.map((b) => (
            <span key={b} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/80">{b}</span>
          ))}
        </div>
        <Link to="/developers/contribute-a-project" className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Contribute a project <ArrowRight className="h-3 w-3" />
        </Link>
      </section>

      {/* Final CTA */}
      <section className="mt-16 flex flex-col items-center gap-4 rounded-2xl border border-accent/30 bg-accent/5 p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Run it in two minutes</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">npm install &amp;&amp; ./ops/ariadne.sh restart</code>
          {" "}— no API key needed to explore.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <PrimaryCta to="/developers/quickstart">Read the quickstart <ArrowRight className="h-4 w-4" /></PrimaryCta>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface-3"
          >
            <GitBranch className="h-4 w-4" /> View source
          </a>
        </div>
      </section>
    </div>
  );
}
