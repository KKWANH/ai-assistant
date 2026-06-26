/**
 * docsRegistry — the single source for the docs site. Sections hold pages; each
 * page is Markdown (rendered by docsKit) or a custom node (the interactive API
 * reference). The sidebar nav, the URL routing (/developers/<slug>), prev/next,
 * the "On this page" rail, and search all derive from this tree — add a page by
 * appending one entry, the platform's "register, don't hardcode" model applied
 * to documentation.
 */
import type { ReactNode } from "react";
import { BookOpen, Boxes, Layers, Workflow, Server, GitBranch, type LucideIcon } from "lucide-react";
import { ApiReference } from "./ApiReference";
import { DocsLanding } from "./docsLanding";
import { extractHeadings, type Heading } from "./docsKit";
import {
  QUICKSTART, API_KEYS, PROJECT_LAYOUT,
  ARCHITECTURE_OVERVIEW, REQUEST_LIFECYCLE, DATA_MODEL, AUTH_MODEL,
  SURFACES, RUNS_AND_TEMPLATES, MEMORY,
  ADD_A_ROUTE, ADD_A_PROVIDER, ADD_AN_AGENT_TOOL, BUILD_A_SURFACE, ADD_A_SETTING,
  ADD_A_COMMAND, CONNECT_MCP, ADD_A_WORKSPACE, CONTRIBUTE_A_PROJECT,
  RUNNING_THE_SERVER, CONFIGURATION, REMOTE_ACCESS, DESKTOP_APP, EVALUATION,
  THEMING, COMMANDS,
} from "./docsContent";

export type PageContent =
  | { kind: "md"; body: string }
  | { kind: "node"; render: () => ReactNode; headings?: Heading[] };

export interface DocPage {
  /** Unique across all pages; the URL is /developers/<slug>. */
  slug: string;
  title: string;
  /** One line — the page header subtitle, the search snippet, the <title>. */
  description: string;
  /** A landing page: rendered chrome-free (no breadcrumb/title/TOC/prev-next),
   *  full width — it owns its whole presentation. */
  hero?: boolean;
  content: PageContent;
}

export interface DocSection {
  id: string;
  label: string;
  icon: LucideIcon;
  pages: DocPage[];
}

const md = (body: string): PageContent => ({ kind: "md", body });

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    label: "Getting started",
    icon: BookOpen,
    pages: [
      { slug: "introduction", title: "Introduction", description: "A local-first AI workspace you can see into — and extend.", hero: true, content: { kind: "node", render: () => <DocsLanding /> } },
      { slug: "quickstart", title: "Quickstart", description: "Install, run, and develop with hot reload.", content: md(QUICKSTART) },
      { slug: "api-keys", title: "API keys & models", description: "Get a provider key, add it, and pick a model — step by step.", content: md(API_KEYS) },
      { slug: "project-layout", title: "Project layout", description: "The monorepo, and where each kind of change goes.", content: md(PROJECT_LAYOUT) },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    icon: Boxes,
    pages: [
      { slug: "architecture-overview", title: "Overview", description: "The four channels between the SPA and the server.", content: md(ARCHITECTURE_OVERVIEW) },
      { slug: "request-lifecycle", title: "Request lifecycle", description: "What happens between send and the first token.", content: md(REQUEST_LIFECYCLE) },
      { slug: "data-model", title: "Data model", description: "The workspace as the hub, stored in node:sqlite.", content: md(DATA_MODEL) },
      { slug: "auth-model", title: "Auth model", description: "Local vs remote — the one distinction that governs every dangerous capability.", content: md(AUTH_MODEL) },
    ],
  },
  {
    id: "concepts",
    label: "Concepts",
    icon: Layers,
    pages: [
      { slug: "surfaces", title: "Surfaces", description: "Custom interactive screens in a sandboxed iframe, talking through a typed bridge.", content: md(SURFACES) },
      { slug: "runs-and-templates", title: "Runs & templates", description: "Traceable executions: evidence-first templates and the block pipeline.", content: md(RUNS_AND_TEMPLATES) },
      { slug: "memory", title: "Memory", description: "Confirmed workspace facts that ride into the model's prompts.", content: md(MEMORY) },
    ],
  },
  {
    id: "extending",
    label: "Extending Ariadne",
    icon: Workflow,
    pages: [
      { slug: "add-a-route", title: "Add a route", description: "Extend the backend — a Fastify plugin plus one registry entry.", content: md(ADD_A_ROUTE) },
      { slug: "add-a-provider", title: "Add a provider", description: "Wire up an AI provider from a single registry descriptor.", content: md(ADD_A_PROVIDER) },
      { slug: "add-an-agent-tool", title: "Add an agent tool", description: "Give the plan-and-execute agent a new built-in tool.", content: md(ADD_AN_AGENT_TOOL) },
      { slug: "build-a-surface", title: "Build a surface", description: "Author a custom screen against the @ariadne/surface SDK.", content: md(BUILD_A_SURFACE) },
      { slug: "add-a-setting", title: "Add a setting", description: "Contribute a settings section from any component.", content: md(ADD_A_SETTING) },
      { slug: "add-a-command", title: "Add a command", description: "Contribute to the Cmd+K palette from any component.", content: md(ADD_A_COMMAND) },
      { slug: "connect-mcp", title: "Connect an MCP server", description: "Register a Model Context Protocol server the agent can call.", content: md(CONNECT_MCP) },
      { slug: "add-a-workspace", title: "Add a workspace", description: "Create, scan, and configure a workspace over the API.", content: md(ADD_A_WORKSPACE) },
      { slug: "contribute-a-project", title: "Contribute a project", description: "A self-contained example app that plugs in through registries.", content: md(CONTRIBUTE_A_PROJECT) },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Server,
    pages: [
      { slug: "running-the-server", title: "Running the server", description: "The ops CLI and the supervisor that keeps the server alive.", content: md(RUNNING_THE_SERVER) },
      { slug: "configuration", title: "Configuration", description: "Environment variables, ports, and where state lives on disk.", content: md(CONFIGURATION) },
      { slug: "remote-access", title: "Remote access", description: "Expose Ariadne through a Cloudflare tunnel, with login and roles.", content: md(REMOTE_ACCESS) },
      { slug: "desktop-app", title: "The desktop app", description: "The Tauri shell that runs the server as a sidecar.", content: md(DESKTOP_APP) },
      { slug: "evaluation", title: "Evaluation", description: "The offline retrieval, RAG, and strategy eval suite.", content: md(EVALUATION) },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    icon: GitBranch,
    pages: [
      {
        slug: "api",
        title: "API reference",
        description: "Every HTTP endpoint, auto-generated from the server routes.",
        content: { kind: "node", render: () => <ApiReference /> },
      },
      { slug: "theming", title: "Theming", description: "The design tokens that drive every colour in the app.", content: md(THEMING) },
      { slug: "commands", title: "Commands", description: "The npm scripts and ops helper for running, checking, and evaluating.", content: md(COMMANDS) },
    ],
  },
];

// --- derived lookups (the nav order is the source of truth) -----------------

export const ALL_PAGES: { page: DocPage; section: DocSection }[] = DOC_SECTIONS.flatMap((section) =>
  section.pages.map((page) => ({ page, section })),
);

export function findPage(slug: string): { page: DocPage; section: DocSection } | undefined {
  return ALL_PAGES.find((p) => p.page.slug === slug);
}

/** The first page — where /developers (no slug) lands. */
export const DEFAULT_SLUG = ALL_PAGES[0]?.page.slug ?? "introduction";

/** Headings for the "On this page" rail: parsed from markdown, or supplied by a
 *  node page (the API reference has none). Cached per page — DocPage objects are
 *  stable, and search calls this for every page on every keystroke, so the
 *  markdown is parsed once, not once per character. */
const HEADINGS_CACHE = new WeakMap<DocPage, Heading[]>();
export function pageHeadings(page: DocPage): Heading[] {
  const cached = HEADINGS_CACHE.get(page);
  if (cached) return cached;
  const headings = page.content.kind === "md" ? extractHeadings(page.content.body) : (page.content.headings ?? []);
  HEADINGS_CACHE.set(page, headings);
  return headings;
}
