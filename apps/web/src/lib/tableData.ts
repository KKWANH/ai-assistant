/**
 * Lightweight table helpers — parse delimited text (CSV / TSV) into a raw
 * `string[][]` grid and serialise it back to CSV.
 *
 * The grid keeps the header as row 0 so the table editor can edit header
 * cells like any other cell. RFC 4180 double-quote quoting is handled.
 */

/** Parse delimited text into a raw grid (newlines normalised, quotes handled). */
function parseDelimited(text: string, delim: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ",");
}

export function parseTsv(text: string): string[][] {
  return parseDelimited(text, "\t");
}

/** Serialise a grid back to CSV, quoting cells that need it. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell ?? "";
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        })
        .join(","),
    )
    .join("\n");
}

/**
 * Heuristic: does pasted text look like a tab-separated table?
 * Two or more non-empty lines, every non-empty line containing a tab.
 */
export function looksLikeTable(text: string): boolean {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.length > 0);
  return lines.length >= 2 && lines.every((l) => l.includes("\t"));
}

/** Pad every row to the width of the widest row, so the grid is rectangular. */
export function normalizeGrid(rows: string[][]): string[][] {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  return rows.map((r) => {
    const padded = r.slice();
    while (padded.length < cols) padded.push("");
    return padded;
  });
}

/** Is this attachment a table file (CSV/TSV)? — drives the table editor/viewer. */
export function isTableFile(name: string, mediaType?: string): boolean {
  return (
    /\.(csv|tsv)$/i.test(name) ||
    mediaType === "text/csv" ||
    mediaType === "text/tab-separated-values"
  );
}

/** UTF-8-safe base64 encode (btoa alone mangles non-Latin1 text, e.g. Hangul). */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** UTF-8-safe base64 decode — inverse of textToBase64. */
export function base64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
