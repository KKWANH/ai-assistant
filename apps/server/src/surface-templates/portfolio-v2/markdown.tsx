/**
 * Minimal markdown renderer for the analysis panes (news + thesis).
 *
 * Built to handle the markdown shape we actually see in
 * analysis/news/<key>.md and analysis/micro/<thesis>.md:
 *
 *   - H1/H2/H3
 *   - tables (analyst-target grids — the most important case)
 *   - bullet lists with `- ` or `* `
 *   - **bold**, *italic*, `code`, [text](url)
 *   - block quotes (`> `)
 *   - paragraphs
 *
 * Deliberately NOT a full CommonMark implementation:
 *   - no nested lists (analyst notes don't nest)
 *   - no fenced code blocks (we don't expect them in finance notes)
 *   - no HTML passthrough (everything escapes to text)
 *
 * Returns React elements so styling lives in the consumer's CSS-var
 * tokens instead of a fragile rehype-style HTML string.
 */
import { React } from "@ariadne/surface";

// ─ Inline formatter ──────────────────────────────────────────────────────
// Walks the line once and emits a tagged array of spans / links / code.
// Order of patterns matters: code first (so backticks aren't reinterpreted
// inside emphasis), then links, then bold, italic.
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = "";
  let nodeIdx = 0;
  const flush = () => {
    if (buf.length > 0) {
      out.push(buf);
      buf = "";
    }
  };
  const push = (node: React.ReactNode) => {
    flush();
    out.push(<React.Fragment key={`${keyPrefix}-${nodeIdx++}`}>{node}</React.Fragment>);
  };

  while (i < text.length) {
    const ch = text[i];
    // `code`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        push(<code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.92em", background: "rgb(var(--surface-2))", padding: "1px 4px", borderRadius: 3 }}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    // [text](url)
    if (ch === "[") {
      const close = text.indexOf("]", i + 1);
      if (close > i && text[close + 1] === "(") {
        const paren = text.indexOf(")", close + 2);
        if (paren > close) {
          const linkText = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren);
          // Allow only http(s)/mailto schemes — defence-in-depth even
          // though the source file is the user's own.
          const safe = /^(https?:|mailto:)/i.test(url);
          if (safe) {
            push(<a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "rgb(var(--accent))" }}>{linkText}</a>);
            i = paren + 1;
            continue;
          }
        }
      }
    }
    // **bold**
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        push(<strong>{renderInline(text.slice(i + 2, end), `${keyPrefix}-b${i}`)}</strong>);
        i = end + 2;
        continue;
      }
    }
    // *italic*  (or _italic_)
    if ((ch === "*" || ch === "_") && text[i + 1] !== ch) {
      const end = text.indexOf(ch!, i + 1);
      if (end > i + 1) {
        push(<em>{renderInline(text.slice(i + 1, end), `${keyPrefix}-i${i}`)}</em>);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ─ Table row parser ──────────────────────────────────────────────────────
// `| col | col |` → ["col", "col"]. Handles trailing-pipe shapes both with
// and without leading pipe.
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

// Parse the alignment row (`---`, `:--`, `--:`, `:--:`).
function parseAlign(cells: string[]): Array<"left" | "right" | "center"> {
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function isAlignRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

// ─ Block parser ──────────────────────────────────────────────────────────
export function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;
  const key = () => `md-${blockIdx++}`;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();

    // Blank → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings  # / ## / ### / ####
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length;
      const Tag = (`h${Math.min(level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6";
      const size = level === 1 ? 16 : level === 2 ? 14 : 13;
      const weight = level <= 2 ? 600 : 500;
      blocks.push(
        <Tag key={key()} style={{ fontSize: size, fontWeight: weight, margin: `${level === 1 ? 12 : 10}px 0 6px`, lineHeight: 1.3 }}>
          {renderInline(h[2]!, key())}
        </Tag>,
      );
      i++;
      continue;
    }

    // Tables — header line followed by an alignment line. The most
    // important block in finance notes (analyst-target grids).
    if (line.includes("|") && i + 1 < lines.length) {
      const headerCells = splitRow(line);
      const alignCells = splitRow(lines[i + 1] ?? "");
      if (headerCells.length > 1 && isAlignRow(alignCells)) {
        const aligns = parseAlign(alignCells);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && (lines[j] ?? "").includes("|") && (lines[j] ?? "").trim() !== "") {
          rows.push(splitRow(lines[j]!));
          j++;
        }
        blocks.push(
          <div key={key()} style={{ overflowX: "auto", margin: "8px 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                  {headerCells.map((c, ci) => (
                    <th key={ci} style={{ padding: "6px 8px", textAlign: aligns[ci] ?? "left", fontWeight: 600 }}>
                      {renderInline(c, `${key()}-th-${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                    {row.map((c, ci) => (
                      <td key={ci} style={{ padding: "5px 8px", textAlign: aligns[ci] ?? "left", color: "rgb(var(--foreground))" }}>
                        {renderInline(c, `${key()}-td-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        i = j;
        continue;
      }
    }

    // Bullet list — `- ` or `* `. Collects consecutive lines.
    if (/^(\s*)[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(\s*)[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^(\s*)[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key()} style={{ margin: "6px 0 6px 18px", padding: 0, lineHeight: 1.55 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "2px 0" }}>{renderInline(it, `${key()}-li-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list — `1. `, `2. ` etc.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key()} style={{ margin: "6px 0 6px 22px", padding: 0, lineHeight: 1.55 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "2px 0" }}>{renderInline(it, `${key()}-li-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Block quote — `> `
    if (line.startsWith("> ")) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        quoted.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push(
        <blockquote key={key()} style={{
          margin: "8px 0",
          padding: "4px 12px",
          borderLeft: "3px solid rgb(var(--accent))",
          color: "rgb(var(--muted-foreground))",
          fontStyle: "italic",
        }}>
          {renderInline(quoted.join(" "), key())}
        </blockquote>,
      );
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$|^\*{3,}$/.test(line.trim())) {
      blocks.push(<hr key={key()} style={{ border: 0, borderTop: "1px solid rgb(var(--border))", margin: "10px 0" }} />);
      i++;
      continue;
    }

    // Paragraph — consume consecutive non-block lines.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") break;
      if (/^#{1,4}\s+/.test(next)) break;
      if (/^(\s*)[-*]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      if (next.includes("|")) break;
      if (next.startsWith("> ")) break;
      para.push(next);
      i++;
    }
    blocks.push(
      <p key={key()} style={{ margin: "6px 0", lineHeight: 1.55 }}>
        {renderInline(para.join(" "), key())}
      </p>,
    );
  }

  return <div style={{ fontSize: 12 }}>{blocks}</div>;
}
