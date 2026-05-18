import { useEffect, useMemo, useRef, useState } from "react";

export type CommandPaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  action: () => void;
};

type AppCommandPaletteProps = {
  open: boolean;
  items: CommandPaletteItem[];
  onClose: () => void;
};

export function AppCommandPalette({ open, items, onClose }: AppCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 8);
    return items.filter((item) => `${item.title} ${item.subtitle || ""} ${(item.keywords || []).join(" ")}`.toLowerCase().includes(needle)).slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="command-palette-layer" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands, projects, chats..."
          aria-label="Search commands"
        />
        <div className="command-list" role="listbox">
          {filtered.length === 0 && <p className="command-empty">No matching commands.</p>}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="command-item"
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              <span>{item.title}</span>
              {item.subtitle && <small>{item.subtitle}</small>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
