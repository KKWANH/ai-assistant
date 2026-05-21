/**
 * Reading starter — sample files injected when a workspace is created with
 * starter="reading".
 *
 * Provides:
 *   library.csv   — a reading / research library (queued, reading, finished)
 *   surface.tsx   — a reading-tracker dashboard reading library.csv
 *
 * All colours use CSS custom-property tokens (rgb(var(--token))) — no hardcoded
 * hex — so the surface is fully legible in both dark and light mode.
 */

export const LIBRARY_CSV = `title,author,category,status,rating,pages,finished_date
The Pragmatic Programmer,Andrew Hunt,Technology,finished,5,352,2025-12-08
Designing Data-Intensive Applications,Martin Kleppmann,Technology,finished,5,616,2026-01-19
Clean Code,Robert C. Martin,Technology,reading,,464,
The Mythical Man-Month,Frederick P. Brooks Jr.,Technology,queued,,336,
A Brief History of Time,Stephen Hawking,Science,finished,4,256,2025-12-27
The Selfish Gene,Richard Dawkins,Science,finished,4,360,2026-02-14
The Gene,Siddhartha Mukherjee,Science,reading,,608,
Cosmos,Carl Sagan,Science,queued,,384,
"Thinking, Fast and Slow",Daniel Kahneman,Psychology,finished,5,499,2026-01-05
Influence,Robert Cialdini,Psychology,finished,4,336,2026-03-02
Flow,Mihaly Csikszentmihalyi,Psychology,queued,,336,
Sapiens,Yuval Noah Harari,History,finished,5,464,2026-02-26
"Guns, Germs, and Steel",Jared Diamond,History,reading,,498,
The Silk Roads,Peter Frankopan,History,queued,,672,
Zero to One,Peter Thiel,Business,finished,4,224,2026-03-21
Good to Great,Jim Collins,Business,finished,3,320,2026-04-11
The Lean Startup,Eric Ries,Business,reading,,336,
The Three-Body Problem,Liu Cixin,Fiction,finished,5,400,2026-04-29
`;

export const SURFACE_TSX = `/**
 * Reading Library — custom Ariadne surface (reading / research tracker).
 *
 * Reads library.csv and renders KPIs, status & category breakdowns, a
 * books-finished trend and a sortable library table.
 *
 * This file lives at .ariadne/surface.tsx. Edit it freely, then click "Build"
 * to recompile and see the result in the workspace's Custom screen tab.
 *
 * The "@ariadne/surface" import gives you:
 *   - React (re-exported) + useState / useEffect
 *   - useAriadne()  → SDK: readCsv, readText, listFiles, runTemplate, theme
 *   - LineChart, BarChart, PieChart  → token-aware SVG charts
 *
 * All colours use CSS variables: rgb(var(--token)). Available tokens include
 * --background, --foreground, --card, --card-foreground, --border, --muted,
 * --muted-foreground, --accent, --success, --destructive, --warning, --info.
 */

import { useState, useEffect, useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

// ── Types ──────────────────────────────────────────────────────────────────

interface Book {
  title: string;
  author: string;
  category: string;
  status: string;
  rating: number;
  pages: number;
  finished: string;
}

interface Point {
  label: string;
  value: number;
}

type SortKey = "title" | "author" | "category" | "status" | "rating" | "pages";

// ── Helpers ────────────────────────────────────────────────────────────────

function num(s: string | undefined): number {
  const n = parseFloat(s || "0");
  return isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusColor(status: string): string {
  if (status === "finished") return "rgb(var(--success))";
  if (status === "reading") return "rgb(var(--info))";
  return "rgb(var(--warning))";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthKey(date: string): string {
  // date is YYYY-MM-DD; return "YYYY-MM" for grouping/sorting
  return date.length >= 7 ? date.slice(0, 7) : "";
}

function monthLabel(key: string): string {
  // key is "YYYY-MM" → "Mon 'YY"
  const parts = key.split("-");
  const m = parseInt(parts[1] || "1", 10) - 1;
  const yy = (parts[0] || "").slice(2);
  return (MONTHS[m] || "?") + " '" + yy;
}

const cardStyle = {
  border: "1px solid rgb(var(--border))",
  borderRadius: "10px",
  background: "rgb(var(--card))",
  padding: "14px 16px",
};

const muted = { color: "rgb(var(--muted-foreground))" };

// ── Parse ───────────────────────────────────────────────────────────────────

function parseLibrary(rows: Record<string, string>[]): Book[] {
  return rows.map((r) => ({
    title: r["title"] || "",
    author: r["author"] || "",
    category: r["category"] || "Other",
    status: (r["status"] || "queued").toLowerCase(),
    rating: num(r["rating"]),
    pages: num(r["pages"]),
    finished: r["finished_date"] || "",
  }));
}

// ── Small components ─────────────────────────────────────────────────────────

function Centered(props: { text: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px" }}>
      <p style={{ color: props.tone === "error" ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
        {props.text}
      </p>
    </div>
  );
}

function Kpi(props: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...cardStyle, flex: "1 1 158px", minWidth: "158px" }}>
      <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {props.label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.1, color: props.color || "rgb(var(--card-foreground))" }}>
        {props.value}
      </div>
      {props.sub ? (
        <div style={{ fontSize: "12px", marginTop: "3px", color: "rgb(var(--muted-foreground))" }}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

function Pill(props: { status: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        color: "rgb(var(--background))",
        background: statusColor(props.status),
      }}
    >
      {titleCase(props.status)}
    </span>
  );
}

function Stars(props: { rating: number }) {
  if (props.rating <= 0) {
    return <span style={{ color: "rgb(var(--muted-foreground))" }}>{"—"}</span>;
  }
  const filled = "★".repeat(props.rating);
  const empty = "☆".repeat(Math.max(0, 5 - props.rating));
  return (
    <span style={{ color: "rgb(var(--warning))", letterSpacing: "1px" }}>
      {filled}
      <span style={{ color: "rgb(var(--border))" }}>{empty}</span>
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function LibraryDashboard() {
  const ariadne = useAriadne();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    async function load() {
      try {
        const csv = await ariadne.readCsv("library.csv");
        setBooks(parseLibrary(csv.rows));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) return <Centered text="Loading library…" />;
  if (error) return <Centered text={"Error: " + error} tone="error" />;
  if (books.length === 0) return <Centered text="No rows in library.csv" />;

  // Aggregates
  const finished = books.filter((b) => b.status === "finished");
  const reading = books.filter((b) => b.status === "reading");
  const queued = books.filter((b) => b.status === "queued");
  const pagesRead = finished.reduce((s, b) => s + b.pages, 0);
  const rated = finished.filter((b) => b.rating > 0);
  const avgRating = rated.length > 0
    ? rated.reduce((s, b) => s + b.rating, 0) / rated.length
    : 0;

  // Status breakdown (pie)
  const statusData: Point[] = [
    { label: "Finished", value: finished.length },
    { label: "Reading", value: reading.length },
    { label: "Queued", value: queued.length },
  ].filter((d) => d.value > 0);

  // Category breakdown (bar)
  const categoryMap: Record<string, number> = {};
  for (const b of books) {
    categoryMap[b.category] = (categoryMap[b.category] || 0) + 1;
  }
  const categoryData: Point[] = Object.keys(categoryMap)
    .map((k) => ({ label: k, value: categoryMap[k] || 0 }))
    .sort((a, b) => b.value - a.value);

  // Books finished per month (line) — derived from finished_date
  const monthMap: Record<string, number> = {};
  for (const b of finished) {
    const key = monthKey(b.finished);
    if (key) monthMap[key] = (monthMap[key] || 0) + 1;
  }
  const monthData: Point[] = Object.keys(monthMap)
    .sort()
    .map((k) => ({ label: monthLabel(k), value: monthMap[k] || 0 }));

  // Table sort
  const sorted = [...books].sort((a, b) => {
    let cmp: number;
    if (sortKey === "rating" || sortKey === "pages") {
      cmp = (a[sortKey] as number) - (b[sortKey] as number);
    } else {
      cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "rating" || k === "pages" ? "desc" : "asc");
    }
  }

  const cols: Array<{ key: SortKey; label: string; align: string }> = [
    { key: "title", label: "Title", align: "left" },
    { key: "author", label: "Author", align: "left" },
    { key: "category", label: "Category", align: "left" },
    { key: "status", label: "Status", align: "left" },
    { key: "rating", label: "Rating", align: "left" },
    { key: "pages", label: "Pages", align: "right" },
  ];

  const th = {
    padding: "8px 10px",
    borderBottom: "2px solid rgb(var(--border))",
    fontWeight: 600,
    fontSize: "11px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "rgb(var(--muted-foreground))",
    whiteSpace: "nowrap" as const,
    cursor: "pointer",
  };
  const td = {
    padding: "7px 10px",
    borderBottom: "1px solid rgb(var(--border))",
    color: "rgb(var(--foreground))",
    fontSize: "13px",
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "20px 24px", maxWidth: "1140px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Reading Library</h1>
      <p style={{ fontSize: "12px", margin: "4px 0 0", ...muted }}>
        {books.length + " items across " + Object.keys(categoryMap).length + " categories · tracked in library.csv"}
      </p>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label="Total Items" value={fmt(books.length)} sub={queued.length + " in queue"} />
        <Kpi
          label="Finished"
          value={fmt(finished.length)}
          sub={avgRating > 0 ? avgRating.toFixed(1) + " avg rating" : undefined}
          color="rgb(var(--success))"
        />
        <Kpi
          label="Currently Reading"
          value={fmt(reading.length)}
          sub={reading.length === 1 ? "1 book in progress" : reading.length + " books in progress"}
          color="rgb(var(--info))"
        />
        <Kpi label="Pages Read" value={fmt(pagesRead)} sub="across finished books" />
      </div>

      {/* Status + category breakdown */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={statusData} title="Items by Status" width={320} height={270} />
        </div>
        <div style={{ ...cardStyle, flex: "2 1 460px", overflowX: "auto" }}>
          <BarChart data={categoryData} title="Items by Category" width={640} height={270} />
        </div>
      </div>

      {/* Books finished per month */}
      {monthData.length > 1 ? (
        <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
          <LineChart data={monthData} title="Books Finished per Month" width={1050} height={240} color="rgb(var(--success))" />
        </div>
      ) : (
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <p style={{ fontSize: "13px", margin: 0, ...muted }}>
            Finish more books to see a monthly trend.
          </p>
        </div>
      )}

      {/* Library table */}
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 8px" }}>Library</h2>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.label}
                  onClick={() => toggleSort(c.key)}
                  style={{ ...th, textAlign: c.align as "left" | "right" }}
                >
                  {c.label}
                  {c.key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => (
              <tr key={b.title + "-" + i}>
                <td style={{ ...td, fontWeight: 600 }}>{b.title}</td>
                <td style={{ ...td, color: "rgb(var(--muted-foreground))" }}>{b.author}</td>
                <td style={td}>{b.category}</td>
                <td style={td}>
                  <Pill status={b.status} />
                </td>
                <td style={td}>
                  <Stars rating={b.rating} />
                </td>
                <td style={{ ...td, textAlign: "right" }}>{fmt(b.pages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        Edit <code>library.csv</code> in your workspace, then click <strong>Build</strong> to
        refresh. Click a column header to sort.
      </p>
    </div>
  );
}
`;
