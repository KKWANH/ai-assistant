/**
 * Tiny demo symbol index — name extraction for the eval fixture.
 * Real one lives at apps/server/src/services/symbolIndex.ts.
 */
export interface SymbolRow {
  path: string;
  name: string;
  kind: "function" | "class" | "method";
}

export function extractSymbols(source: string, path: string): SymbolRow[] {
  const out: SymbolRow[] = [];
  const fnRe = /^export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/gm;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    if (name) out.push({ path, name, kind: "function" });
  }
  return out;
}
