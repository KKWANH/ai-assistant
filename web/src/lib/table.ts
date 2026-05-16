export function looksLikePastedTable(value: unknown): boolean {
  const lines = String(value || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 && lines.some((line) => line.includes("\t"));
}

export function pastedTableToCsv(value: unknown): string {
  return String(value || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("\t").map(csvCell).join(","))
    .join("\n") + "\n";
}

export function parseCsvRows(value: unknown): string[][] {
  return String(value || "").trim().split(/\r?\n/).filter(Boolean).map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
