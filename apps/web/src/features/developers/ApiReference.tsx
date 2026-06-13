/**
 * API Reference — the auto-generated inventory (every endpoint, always in sync)
 * grouped into human categories, with a filter and expandable per-endpoint
 * detail (param/query/body types from the generator + curated summary, response,
 * and examples from apiMeta).
 */
import { useMemo, useState } from "react";
import { ChevronRight, Search, Copy, Check } from "lucide-react";
import { API_ENDPOINTS, DOMAIN_DESCRIPTIONS, type ApiEndpoint } from "./apiInventory.generated";
import { API_CATEGORIES, DOMAIN_BLURBS, ENDPOINT_DETAILS } from "./apiMeta";

/** Domain description — sourced from the route registry (single source of
 *  truth), falling back to apiMeta for the few non-registry domains. */
const domainBlurb = (domain: string) => DOMAIN_DESCRIPTIONS[domain] ?? DOMAIN_BLURBS[domain];

const METHOD_CLS: Record<string, string> = {
  GET: "text-success border-success/40 bg-success/10",
  POST: "text-info border-info/40 bg-info/10",
  PUT: "text-warning border-warning/40 bg-warning/10",
  PATCH: "text-warning border-warning/40 bg-warning/10",
  DELETE: "text-destructive border-destructive/40 bg-destructive/10",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function TypeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-2xs">
      <span className="shrink-0 w-16 text-muted-foreground">{label}</span>
      <code className="font-mono text-foreground break-all">{value}</code>
    </div>
  );
}

function EndpointCard({ ep }: { ep: ApiEndpoint }) {
  const [open, setOpen] = useState(false);
  const detail = ENDPOINT_DETAILS[`${ep.method} ${ep.path}`];
  const hasDetail = !!(detail || ep.params || ep.query || ep.body);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={["w-full flex items-center gap-2.5 px-3 py-2 text-left", hasDetail ? "hover:bg-surface-2" : ""].join(" ")}
      >
        <span className={["shrink-0 rounded border px-1.5 py-0.5 font-mono text-2xs font-bold", METHOD_CLS[ep.method] ?? ""].join(" ")}>
          {ep.method}
        </span>
        <code className="flex-1 font-mono text-xs text-foreground break-all">{ep.path}</code>
        {detail?.access && <span className="shrink-0 text-2xs text-warning">{detail.access.includes("Local") ? "local-only" : ""}</span>}
        {hasDetail && (
          <ChevronRight className={["h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open ? "rotate-90" : ""].join(" ")} />
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2.5 space-y-2.5">
          {detail?.summary && <p className="text-xs text-foreground leading-relaxed">{detail.summary}</p>}
          {(ep.params || ep.query || ep.body) && (
            <div className="space-y-1">
              {ep.params && <TypeRow label="Params" value={ep.params} />}
              {ep.query && <TypeRow label="Query" value={ep.query} />}
              {ep.body && <TypeRow label="Body" value={ep.body} />}
            </div>
          )}
          {detail?.response && <TypeRow label="Returns" value={detail.response} />}
          {detail?.access && <p className="text-2xs text-muted-foreground">🔒 {detail.access}</p>}
          {detail?.example && (
            <div className="relative">
              <pre className="rounded-md bg-surface-2 p-2.5 pr-9 text-2xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                {detail.example}
              </pre>
              <CopyButton text={detail.example} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiReference() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // domain → endpoints, sorted; then grouped into categories.
  const byDomain = useMemo(() => {
    const m = new Map<string, ApiEndpoint[]>();
    for (const ep of API_ENDPOINTS) {
      if (q && !ep.path.toLowerCase().includes(q) && !ep.method.toLowerCase().includes(q)) continue;
      (m.get(ep.domain) ?? m.set(ep.domain, []).get(ep.domain)!).push(ep);
    }
    return m;
  }, [q]);

  const uncategorized = useMemo(() => {
    const known = new Set(API_CATEGORIES.flatMap((c) => c.domains));
    return [...byDomain.keys()].filter((d) => !known.has(d)).sort();
  }, [byDomain]);

  const total = API_ENDPOINTS.length;
  const shown = [...byDomain.values()].reduce((n, a) => n + a.length, 0);

  const renderDomain = (domain: string) => {
    const eps = byDomain.get(domain);
    if (!eps?.length) return null;
    return (
      <div key={domain} className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <h4 className="font-mono text-xs font-semibold text-accent">{domain}</h4>
          <span className="text-2xs text-muted-foreground">{eps.length}</span>
        </div>
        {domainBlurb(domain) && <p className="text-2xs text-muted-foreground leading-snug">{domainBlurb(domain)}</p>}
        <div className="space-y-1">{eps.map((ep) => <EndpointCard key={`${ep.method} ${ep.path}`} ep={ep} />)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">API Reference</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every HTTP endpoint, scanned straight from <code className="font-mono text-xs">apps/server/src/routes</code> so it
          never drifts. All paths are under <code className="font-mono text-xs">/api</code> (cookie or local-admin auth);
          exceptions are noted. {total} endpoints.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter endpoints — e.g. /git, terminal, POST"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
          />
          {q && <span className="text-2xs text-muted-foreground shrink-0">{shown}/{total}</span>}
        </div>
      </div>

      {API_CATEGORIES.map((cat) => {
        const domains = cat.domains.filter((d) => byDomain.get(d)?.length);
        if (!domains.length) return null;
        return (
          <section key={cat.id} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
              {cat.label}
            </h3>
            {domains.map(renderDomain)}
          </section>
        );
      })}

      {uncategorized.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1">
            Other
          </h3>
          {uncategorized.map(renderDomain)}
        </section>
      )}
    </div>
  );
}
