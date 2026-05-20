import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useUIStore } from "../../lib/store";
import { useT } from "../../lib/i18n";

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
  section?: string;
}

export interface CommandMenuProps {
  items: CommandItem[];
}

export function CommandMenu({ items }: CommandMenuProps) {
  const { commandMenuOpen, setCommandMenuOpen } = useUIStore();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useT();

  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      item.description?.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (commandMenuOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
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

  // Group by section
  const sections: { label: string; items: CommandItem[] }[] = [];
  const seen = new Set<string>();
  for (const item of filtered) {
    const sec = item.section ?? "Actions";
    if (!seen.has(sec)) {
      seen.add(sec);
      sections.push({ label: sec, items: [] });
    }
    sections.at(-1)!.items.push(item);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
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
              <div key={sec.label}>
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {sec.label}
                </p>
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
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
