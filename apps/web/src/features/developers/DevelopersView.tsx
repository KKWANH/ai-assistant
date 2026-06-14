/**
 * DevelopersView — the in-app docs site (/developers/<slug>). A documentation
 * shell over the page registry (docsRegistry): a hierarchical sidebar, a
 * scroll-spy "On this page" rail, breadcrumbs, prev/next, and fuzzy search that
 * also feeds the Cmd+K palette. Content is Markdown (docsKit) or the
 * interactive API reference. Adding a page is one registry entry — the nav,
 * routing, TOC, and search all derive from it.
 */
import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useParams, useNavigate, Navigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronRight, Search, FileText, Hash } from "lucide-react";
import { useRegisterCommands, type CommandItem } from "../../lib/commands";
import { DocsMarkdown, useScrollSpy } from "./docsKit";
import {
  DOC_SECTIONS, ALL_PAGES, findPage, pageHeadings, DEFAULT_SLUG,
  type DocPage, type DocSection,
} from "./docsRegistry";

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface Hit { page: DocPage; section: DocSection; score: number }

/** Tiny term-AND fuzzy rank over title/section/description/headings. */
function searchDocs(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const hits: Hit[] = [];
  for (const { page, section } of ALL_PAGES) {
    const title = page.title.toLowerCase();
    const heads = pageHeadings(page).map((h) => h.text.toLowerCase()).join(" ");
    const desc = page.description.toLowerCase();
    const sec = section.label.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inHead = heads.includes(t);
      const inDesc = desc.includes(t);
      const inSec = sec.includes(t);
      if (!(inTitle || inHead || inDesc || inSec)) { ok = false; break; }
      score += (inTitle ? 5 : 0) + (inHead ? 2 : 0) + (inDesc ? 1 : 0) + (inSec ? 1 : 0);
    }
    if (ok) hits.push({ page, section, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchDocs(q), [q]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("mousedown", onDoc); };
  }, []);

  const go = (h: Hit) => {
    navigate(`/developers/${h.page.slug}`);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 focus-within:border-accent/60">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          placeholder="Search docs"
          className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      {open && q && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2.5 text-2xs text-muted-foreground">No matches for “{q}”.</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.page.slug}
                onMouseEnter={() => { setActive(i); }}
                onClick={() => { go(h); }}
                className={[
                  "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                  i === active ? "bg-accent/10" : "hover:bg-surface-2",
                ].join(" ")}
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">{h.page.title}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{h.section.label} · {h.page.description}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ slug }: { slug: string }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
      <div className="shrink-0 space-y-3 border-b border-border p-3">
        <Link to="/" className="flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to app
        </Link>
        <SearchBox />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        {DOC_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <div key={section.id} className="mb-5 last:mb-0">
              <p className="mb-1.5 flex items-center gap-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Icon className="h-3 w-3" /> {section.label}
              </p>
              <div className="space-y-0.5">
                {section.pages.map((page) => {
                  const active = page.slug === slug;
                  return (
                    <Link
                      key={page.slug}
                      to={`/developers/${page.slug}`}
                      className={[
                        "block rounded-md px-2 py-1.5 text-xs transition-colors",
                        active
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-foreground/80 hover:bg-surface-2 hover:text-foreground",
                      ].join(" ")}
                    >
                      {page.title}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// On this page (right rail)
// ---------------------------------------------------------------------------

function OnThisPage({ page, scrollEl }: { page: DocPage; scrollEl: HTMLElement | null }) {
  const headings = useMemo(() => pageHeadings(page), [page]);
  const ids = useMemo(() => headings.map((h) => h.id), [headings]);
  const active = useScrollSpy(ids, scrollEl);
  if (headings.length < 2) return <div className="hidden w-56 shrink-0 xl:block" />;
  return (
    <div className="hidden w-56 shrink-0 xl:block">
      <div className="sticky top-0 max-h-screen overflow-y-auto p-6 pl-2">
        <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Hash className="h-3 w-3" /> On this page
        </p>
        <ul className="space-y-1 border-l border-border">
          {headings.map((h) => (
            <li key={h.id} style={{ paddingLeft: h.depth === 3 ? 14 : 0 }}>
              <a
                href={`#${h.id}`}
                className={[
                  "-ml-px block border-l-2 py-0.5 pl-3 text-2xs leading-snug transition-colors",
                  active === h.id
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

function Breadcrumbs({ section, page }: { section: DocSection; page: DocPage }) {
  return (
    <nav className="mb-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <span>{section.label}</span>
      <ChevronRight className="h-3 w-3" />
      <span className="text-foreground/70">{page.title}</span>
    </nav>
  );
}

function PrevNext({ slug }: { slug: string }) {
  const idx = ALL_PAGES.findIndex((p) => p.page.slug === slug);
  const prev = idx > 0 ? ALL_PAGES[idx - 1] : undefined;
  const next = idx >= 0 && idx < ALL_PAGES.length - 1 ? ALL_PAGES[idx + 1] : undefined;
  return (
    <div className="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6">
      {prev ? (
        <Link to={`/developers/${prev.page.slug}`} className="group flex flex-col rounded-xl border border-border p-3 transition-colors hover:border-accent/50 hover:bg-surface-2">
          <span className="flex items-center gap-1 text-2xs text-muted-foreground"><ArrowLeft className="h-3 w-3" /> Previous</span>
          <span className="mt-0.5 text-sm font-medium text-foreground group-hover:text-accent">{prev.page.title}</span>
        </Link>
      ) : <span />}
      {next ? (
        <Link to={`/developers/${next.page.slug}`} className="group flex flex-col items-end rounded-xl border border-border p-3 text-right transition-colors hover:border-accent/50 hover:bg-surface-2">
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">Next <ArrowRight className="h-3 w-3" /></span>
          <span className="mt-0.5 text-sm font-medium text-foreground group-hover:text-accent">{next.page.title}</span>
        </Link>
      ) : <span />}
    </div>
  );
}

/** Mobile-only page picker (the sidebar is hidden < md). */
function MobilePicker({ slug }: { slug: string }) {
  const navigate = useNavigate();
  return (
    <div className="border-b border-border p-3 md:hidden">
      <select
        value={slug}
        onChange={(e) => { navigate(`/developers/${e.target.value}`); }}
        className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground"
      >
        {DOC_SECTIONS.map((section) => (
          <optgroup key={section.id} label={section.label}>
            {section.pages.map((page) => (
              <option key={page.slug} value={page.slug}>{page.title}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function PageBody({ content }: { content: DocPage["content"] }): ReactNode {
  if (content.kind === "md") return <DocsMarkdown body={content.body} />;
  return content.render();
}

export function DevelopersView() {
  const { "*": splat } = useParams();
  const slug = (splat ?? "").replace(/\/$/, "");
  const navigate = useNavigate();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  // Every page is a Cmd+K target — "register, don't hardcode" for docs search.
  const commands = useMemo<CommandItem[]>(
    () =>
      ALL_PAGES.map(({ page, section }) => ({
        id: `docs:${page.slug}`,
        label: page.title,
        description: `Docs · ${section.label}`,
        section: "Docs",
        icon: <FileText className="h-4 w-4" />,
        onSelect: () => { navigate(`/developers/${page.slug}`); },
      })),
    [navigate],
  );
  useRegisterCommands("docs", commands);

  const found = slug ? findPage(slug) : undefined;

  // Reset scroll to top when the page changes (unless deep-linking to a hash).
  useEffect(() => {
    if (scrollEl && !window.location.hash) scrollEl.scrollTo({ top: 0 });
  }, [slug, scrollEl]);

  if (!slug) return <Navigate to={`/developers/${DEFAULT_SLUG}`} replace />;
  if (!found) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">No docs page at <code className="font-mono">/{slug}</code>.</p>
        <Link to={`/developers/${DEFAULT_SLUG}`} className="text-xs font-medium text-accent hover:underline">Go to the docs home →</Link>
      </div>
    );
  }
  const { page, section } = found;

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar slug={slug} />
      <main ref={setScrollEl} className="min-h-0 flex-1 overflow-y-auto">
        <MobilePicker slug={slug} />
        <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8 lg:px-10">
          <article className="min-w-0 max-w-3xl flex-1">
            <Breadcrumbs section={section} page={page} />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{page.title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{page.description}</p>
            <div className="mt-6">
              <PageBody content={page.content} />
            </div>
            <PrevNext slug={slug} />
          </article>
          <OnThisPage page={page} scrollEl={scrollEl} />
        </div>
      </main>
    </div>
  );
}
