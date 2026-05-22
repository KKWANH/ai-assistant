import { useState } from "react";
import { Search, ExternalLink, Loader2 } from "lucide-react";
import { useSearch } from "../../lib/queries";
import { useT } from "../../lib/i18n";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/layout/PageHeader";
import type { SearchResult } from "@ariadne/shared";

function SearchResultItem({ result }: { result: SearchResult }) {
  return (
    <Card className="px-4 py-3 gap-1 flex flex-col">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-accent hover:underline flex items-center gap-1.5 min-w-0"
      >
        <span className="truncate">{result.title}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      <p className="text-xs font-mono text-muted-foreground truncate">{result.url}</p>
      {result.snippet && (
        <p className="text-xs text-foreground mt-1 line-clamp-3">{result.snippet}</p>
      )}
    </Card>
  );
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const searchMutation = useSearch();
  const { t } = useT();

  const handleSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate(query.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const results = searchMutation.data;

  return (
    <div className="flex flex-col gap-5 p-5 max-w-3xl overflow-y-auto h-full">
      <PageHeader
        icon={<Search className="h-5 w-5" />}
        title={t("search.title")}
        description={t("search.description")}
      />

      {/* Search input */}
      <div className="flex gap-2">
        <Input
          className="flex-1"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="primary"
          size="md"
          leftIcon={
            searchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )
          }
          onClick={handleSearch}
          disabled={!query.trim() || searchMutation.isPending}
        >
          {t("search.button")}
        </Button>
      </div>

      {/* Results */}
      {searchMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("search.searching")}
        </div>
      )}

      {searchMutation.isError && (
        <Card className="px-4 py-3 border-destructive/40">
          <p className="text-sm text-destructive">
            {t("search.failed", {
              error:
                searchMutation.error instanceof Error
                  ? searchMutation.error.message
                  : t("common.unknown"),
            })}
          </p>
        </Card>
      )}

      {results && !searchMutation.isPending && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {results.results.length !== 1
                ? t("search.resultsPlural", { n: results.results.length })
                : t("search.results", { n: results.results.length })}
            </span>
            <Badge variant="default" className="text-2xs">
              {results.provider}
            </Badge>
            {results.error && (
              <span className="text-xs text-warning">({results.error})</span>
            )}
          </div>

          {results.results.length === 0 ? (
            <div className="rounded-xl border border-border border-dashed px-6 py-8 text-center">
              <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("search.noResults")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {results.results.map((r, i) => (
                <SearchResultItem key={`${r.url}-${i}`} result={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
