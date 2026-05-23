/**
 * WorkspaceSearchView — keyword + semantic search across a workspace's files.
 *
 * Hits GET /api/workspaces/:id/search, which is the same retrieval engine
 * the chat path uses internally to ground its answers (cosine over the
 * embedding index when present, keyword ranker otherwise). Until this
 * page existed, that engine was only accessible by sending a chat message.
 *
 * The root-level /search page is a *web* search (Brave/etc.) and is
 * unrelated. Linked from the workspace header.
 */
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, ArrowLeft, FileText } from "lucide-react";
import { useWorkspace } from "../../lib/queries";
import { searchWorkspace } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/layout/PageHeader";
import { NotFoundRedirect } from "../../components/NotFoundRedirect";

export function WorkspaceSearchView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { data: ws, isLoading: wsLoading } = useWorkspace(id ?? "");

  // Two pieces of state: the input box (live) and the "submitted" query
  // (what react-query keys off). Hitting Enter promotes the box.
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const { data, isLoading: searchLoading, error } = useQuery({
    queryKey: ["workspaceSearch", id, query],
    queryFn: () => searchWorkspace(id ?? "", query, 15),
    enabled: !!id && query.trim().length > 0,
  });

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!ws) return <NotFoundRedirect />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setQuery(draft.trim());
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border bg-background">
        <PageHeader
          icon={<SearchIcon className="h-5 w-5" />}
          title={t("workspace.search.title")}
          description={
            <span className="flex items-center gap-2">
              <Link
                to={`/workspaces/${ws.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← {ws.name}
              </Link>
              <span className="text-2xs text-muted-foreground font-mono">{ws.rootPath}</span>
            </span>
          }
          action={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/workspaces/${ws.id}`)}
            >
              {t("common.back")}
            </Button>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4">
          <form onSubmit={submit} className="flex gap-2">
            <Input
              autoFocus
              placeholder={t("workspace.search.placeholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              leftElement={<SearchIcon className="h-3.5 w-3.5" />}
            />
            <Button type="submit" disabled={draft.trim() === "" || searchLoading}>
              {searchLoading ? t("workspace.search.searching") : t("workspace.search.go")}
            </Button>
          </form>

          {query && (
            <p className="text-xs text-muted-foreground">
              {t("workspace.search.queryLabel")}: <span className="font-mono">{query}</span>
              {data && (
                <>
                  {" · "}
                  {t("workspace.search.resultsLabel", { n: data.chunks.length.toString() })}
                  {data.indexed && (
                    <>
                      {" · "}
                      <span className="text-accent">{t("workspace.search.semantic")}</span>
                    </>
                  )}
                </>
              )}
            </p>
          )}

          {error && (
            <Card className="p-4 border-destructive">
              <p className="text-xs text-destructive">
                {error instanceof Error ? error.message : t("workspace.search.error")}
              </p>
            </Card>
          )}

          {!query && (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("workspace.search.emptyState")}
              </p>
            </Card>
          )}

          {query && data && data.chunks.length === 0 && !searchLoading && (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("workspace.search.noResults")}
              </p>
            </Card>
          )}

          {data?.chunks.map((c, idx) => (
            <Card key={`${c.path}-${idx.toString()}`} className="p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs font-mono text-accent">
                  <FileText className="h-3 w-3" />
                  {c.path}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {t("workspace.search.score")}: {c.score.toFixed(2)}
                </span>
              </div>
              <pre
                className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed text-foreground"
                style={{ maxHeight: "220px", overflow: "auto" }}
              >
                {c.chunk.length > 600 ? c.chunk.slice(0, 600) + "…" : c.chunk}
              </pre>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
