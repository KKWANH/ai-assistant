/**
 * docsRegistry — the single source for the docs site. Sections hold pages; each
 * page is Markdown (rendered by docsKit) or a custom node (the interactive API
 * reference). The sidebar nav, the URL routing (/developers/<slug>), prev/next,
 * the "On this page" rail, and search all derive from this tree — add a page by
 * appending one entry, the platform's "register, don't hardcode" model applied
 * to documentation.
 */
import type { ReactNode } from "react";
import { BookOpen, Boxes, Workflow, GitBranch, type LucideIcon } from "lucide-react";
import { ApiReference } from "./ApiReference";
import { extractHeadings, type Heading } from "./docsKit";
import {
  INTRODUCTION, QUICKSTART, PROJECT_LAYOUT,
  ARCHITECTURE_OVERVIEW, REQUEST_LIFECYCLE, DATA_MODEL, AUTH_MODEL,
  ADD_A_ROUTE, ADD_A_PROVIDER, ADD_AN_AGENT_TOOL, ADD_A_COMMAND, ADD_A_WORKSPACE, CONTRIBUTE_A_PROJECT,
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
      { slug: "introduction", title: "Introduction", description: "What Ariadne is and the three ideas that shape the codebase.", content: md(INTRODUCTION) },
      { slug: "quickstart", title: "Quickstart", description: "Install, run, and develop with hot reload.", content: md(QUICKSTART) },
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
    id: "extending",
    label: "Extending Ariadne",
    icon: Workflow,
    pages: [
      { slug: "add-a-route", title: "Add a route", description: "Extend the backend — a Fastify plugin plus one registry entry.", content: md(ADD_A_ROUTE) },
      { slug: "add-a-provider", title: "Add a provider", description: "Wire up an AI provider from a single registry descriptor.", content: md(ADD_A_PROVIDER) },
      { slug: "add-an-agent-tool", title: "Add an agent tool", description: "Give the plan-and-execute agent a new built-in tool.", content: md(ADD_AN_AGENT_TOOL) },
      { slug: "add-a-command", title: "Add a command", description: "Contribute to the Cmd+K palette from any component.", content: md(ADD_A_COMMAND) },
      { slug: "add-a-workspace", title: "Add a workspace", description: "Create, scan, and configure a workspace over the API.", content: md(ADD_A_WORKSPACE) },
      { slug: "contribute-a-project", title: "Contribute a project", description: "A self-contained example app that plugs in through registries.", content: md(CONTRIBUTE_A_PROJECT) },
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
 *  node page (the API reference has none). */
export function pageHeadings(page: DocPage): Heading[] {
  if (page.content.kind === "md") return extractHeadings(page.content.body);
  return page.content.headings ?? [];
}
