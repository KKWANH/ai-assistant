/**
 * Minimal YAML parser — handles the v2 schema subset only:
 *   - `key: value`            (string / number / bool)
 *   - `key:` with nested keys
 *   - `- ` list items
 *   - `# ...`                  comments stripped
 *   - Quoted strings           "..." stay as-is (quotes removed)
 *
 * NOT a general YAML parser. Lives inside the surface so we don't pull
 * the `yaml` npm package into the surface bundle. If you need general
 * YAML features (anchors, multi-line strings, &c.) you've outgrown this
 * — switch the schema to JSON.
 */

export type YamlValue =
  | string | number | boolean | null
  | YamlValue[]
  | { [k: string]: YamlValue };

export function parseYaml(input: string): YamlValue {
  const lines = input.split("\n").map((l) => l.replace(/\r$/, ""));
  // Strip trailing comments; strip blank + pure-comment lines.
  const tokens = lines
    .map((line) => {
      const commentIdx = line.indexOf(" #");
      const trimmedComment = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
      const sansFullLineComment = trimmedComment.replace(/^(\s*)#.*/, "$1");
      return sansFullLineComment;
    })
    .filter((l) => l.trim() !== "");

  function indentOf(line: string): number {
    let i = 0;
    while (i < line.length && line[i] === " ") i++;
    return i;
  }

  // Split a flow-mapping inner body by commas not inside nested braces,
  // brackets, or quotes. Used for parsing { key: val, key2: val2 }.
  function splitFlowEntries(inner: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (!inSingle && c === "\"" && inner[i - 1] !== "\\") inDouble = !inDouble;
      else if (!inDouble && c === "'" && inner[i - 1] !== "\\") inSingle = !inSingle;
      else if (!inSingle && !inDouble) {
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === "," && depth === 0) {
          out.push(inner.slice(start, i));
          start = i + 1;
        }
      }
    }
    if (start < inner.length) out.push(inner.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
  }

  function coerce(raw: string): YamlValue {
    const t = raw.trim();
    if (t === "") return "";
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if ((t.startsWith("\"") && t.endsWith("\"")) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    if (t.startsWith("[") && t.endsWith("]")) {
      const inner = t.slice(1, -1).trim();
      if (inner === "") return [];
      return splitFlowEntries(inner).map((x) => coerce(x));
    }
    // AK: inline flow mapping `{ key: val, key2: val2 }`. The pre-AK
    // parser fed this whole thing into the list-item object branch
    // with the leading `{` glued to the first key — which produced
    // `{ "{ key": val, "key2": val2 }`. Downstream code expecting
    // `obj.key` then saw undefined and crashed (TriggerGauge regression
    // user reported).
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1).trim();
      if (inner === "") return {};
      const obj: { [k: string]: YamlValue } = {};
      for (const part of splitFlowEntries(inner)) {
        const colon = part.indexOf(":");
        if (colon < 0) continue;
        obj[part.slice(0, colon).trim()] = coerce(part.slice(colon + 1));
      }
      return obj;
    }
    return t;
  }

  let cursor = 0;

  function parseBlock(baseIndent: number): YamlValue {
    if (cursor >= tokens.length) return null;
    const first = tokens[cursor]!;
    const firstIndent = indentOf(first);
    if (firstIndent < baseIndent) return null;
    const body = first.slice(firstIndent);

    if (body.startsWith("- ")) {
      const list: YamlValue[] = [];
      while (cursor < tokens.length) {
        const line = tokens[cursor]!;
        const ind = indentOf(line);
        if (ind < baseIndent) break;
        if (ind !== baseIndent) break;
        const itemBody = line.slice(ind);
        if (!itemBody.startsWith("- ")) break;
        const rest = itemBody.slice(2);
        cursor++;
        // AK: inline flow object `- { k: v, k2: v2 }` — let coerce()
        // parse it as a unit instead of treating the leading `{` as
        // part of the first key (which silently corrupted the row).
        if (rest.startsWith("{") && rest.trimEnd().endsWith("}")) {
          list.push(coerce(rest));
          continue;
        }
        if (rest.includes(":")) {
          const colon = rest.indexOf(":");
          const firstKey = rest.slice(0, colon).trim();
          const firstVal = rest.slice(colon + 1).trim();
          const obj: { [k: string]: YamlValue } = {};
          if (firstVal === "") {
            const child = parseBlock(baseIndent + 4);
            obj[firstKey] = child === null ? "" : child;
          } else {
            obj[firstKey] = coerce(firstVal);
          }
          while (cursor < tokens.length) {
            const cont = tokens[cursor]!;
            const contInd = indentOf(cont);
            if (contInd < baseIndent + 2) break;
            if (contInd === baseIndent && cont.slice(contInd).startsWith("- ")) break;
            if (contInd !== baseIndent + 2) { cursor++; continue; }
            const contBody = cont.slice(contInd);
            const cc = contBody.indexOf(":");
            if (cc < 0) { cursor++; continue; }
            const k = contBody.slice(0, cc).trim();
            const v = contBody.slice(cc + 1).trim();
            cursor++;
            if (v === "") {
              const nested = parseBlock(baseIndent + 4);
              obj[k] = nested === null ? "" : nested;
            } else {
              obj[k] = coerce(v);
            }
          }
          list.push(obj);
        } else {
          list.push(coerce(rest));
        }
      }
      return list;
    }

    const obj: { [k: string]: YamlValue } = {};
    while (cursor < tokens.length) {
      const line = tokens[cursor]!;
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (ind !== baseIndent) break;
      const lineBody = line.slice(ind);
      const colon = lineBody.indexOf(":");
      if (colon < 0) { cursor++; continue; }
      const key = lineBody.slice(0, colon).trim();
      const val = lineBody.slice(colon + 1).trim();
      cursor++;
      if (val === "") {
        const child = parseBlock(baseIndent + 2);
        obj[key] = child === null ? "" : child;
      } else {
        obj[key] = coerce(val);
      }
    }
    return obj;
  }

  return parseBlock(0);
}
