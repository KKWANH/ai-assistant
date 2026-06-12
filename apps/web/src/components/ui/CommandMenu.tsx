import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useUIStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { useRegisteredCommands, type CommandItem } from "../../lib/commands";

// Re-exported so existing imports (`import type { CommandItem } from ".../CommandMenu"`) keep working.
export type { CommandItem };

export interface CommandMenuProps {
  items: CommandItem[];
}

/** Subsequence fuzzy score: every query char must appear in order; contiguous
 *  runs, word-boundary starts, and earlier matches score higher. Returns
 *  -Infinity when the query isn't a subsequence of the text (filtered out). */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  for (let si = 0; si < s.length && qi < q.length; si++) {
    if (s[si] === q[qi]) {
      const contiguous = si === lastMatch + 1;
      const wordStart = si === 0 || /[\s/_\-.]/.test(s[si - 1] ?? "");
      score += 1 + (contiguous ? 3 : 0) + (wordStart ? 4 : 0) - si * 0.01;
      lastMatch = si;
      qi++;
    }
  }
  return qi === q.length ? score : -Infinity;
}

export function CommandMenu({ items }: CommandMenuProps) {
  const { commandMenuOpen, setCommandMenuOpen } = useUIStore();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useT();

  // Merge the shell's built-in commands with anything contributed via the
  // registry (features / projects / surfaces), then fuzzy-rank on a query.
  const registered = useRegisteredCommands();
  const allItems = registered.length ? items.concat(registered) : items;
  const filtered = query
    ? allItems
        .map((item) => ({
          item,
          score: Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.description ?? "") - 4),
        }))
        .filter((x) => x.score > -Infinity)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item)
    : allItems;

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Focus restore — capture wherever focus was when the menu opened,
  // put it back on close. Without this, dismissing the menu drops
  // focus on document.body, breaking keyboard flow.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (commandMenuOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        const prev = previouslyFocusedRef.current;
        if (prev && document.body.contains(prev)) prev.focus();
      };
    }
    return undefined;
  }, [commandMenuOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandMenuOpen(!commandMenuOpen);
      }
      if (!commandMenuOpen) return;
      if (e.key === "Escape") setCommandMenuOpen(false);
      if (e.key === "ArrowDown")
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      if (e.key === "ArrowUp")
        setSelectedIdx((i) => Math.max(i - 1, 0));
      const selectedItem = filtered[selectedIdx];
      if (e.key === "Enter" && selectedItem) {
        selectedItem.onSelect();
        setCommandMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [commandMenuOpen, filtered, selectedIdx, setCommandMenuOpen]);

  if (!commandMenuOpen) return null;

  // With a query the results are fuzzy-RANKED, so show one flat list (grouping
  // would fragment sections and fight the ranking). Empty query → grouped.
  const sections: { label: string; items: CommandItem[] }[] = [];
  if (query) {
    sections.push({ label: "", items: filtered });
  } else {
    const seen = new Set<string>();
    for (const item of filtered) {
      const sec = item.section ?? "Actions";
      if (!seen.has(sec)) {
        seen.add(sec);
        sections.push({ label: sec, items: [] });
      }
      sections.find((s) => s.label === sec)!.items.push(item);
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-command)] flex items-start justify-center px-3 pt-[clamp(1rem,8vh,15vh)] sm:px-0 sm:pt-[15vh]">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => setCommandMenuOpen(false)}
        aria-hidden="true"
      />
      <div
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        role="dialog"
        aria-label={t("commandMenu.ariaLabel")}
        aria-modal="true"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("commandMenu.searchPlaceholder")}
            className={[
              "flex-1 bg-transparent text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus:outline-none",
            ].join(" ")}
            aria-label={t("commandMenu.searchAriaLabel")}
            autoComplete="off"
          />
          <kbd className="text-xs text-muted-foreground font-mono">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {sections.length === 0 ? (
            <p className="px-3 py-6 text-sm text-center text-muted-foreground">
              {t("commandMenu.noResults", { query })}
            </p>
          ) : (
            sections.map((sec) => (
              <div key={sec.label || "results"}>
                {sec.label && (
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {sec.label}
                  </p>
                )}
                {sec.items.map((item) => {
                  const globalIdx = filtered.indexOf(item);
                  const active = globalIdx === selectedIdx;
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setSelectedIdx(globalIdx)}
                      onClick={() => {
                        item.onSelect();
                        setCommandMenuOpen(false);
                      }}
                      className={[
                        "w-full flex items-center gap-3 px-3 py-2 text-left",
                        "transition-colors duration-75",
                        active ? "bg-surface-3 text-foreground" : "text-foreground",
                      ].join(" ")}
                    >
                      {item.icon && (
                        <span className="shrink-0 w-4 h-4 text-muted-foreground">
                          {item.icon}
                        </span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="text-sm">{item.label}</span>
                        {item.description && (
                          <span className="block text-xs text-muted-foreground truncate">
                            {item.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-3 py-1.5 flex gap-3 text-xs text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> {t("commandMenu.hint.navigate")}</span>
          <span><kbd className="font-mono">↵</kbd> {t("commandMenu.hint.select")}</span>
          <span><kbd className="font-mono">Esc</kbd> {t("commandMenu.hint.close")}</span>
        </div>
      </div>
    </div>
  );
}
