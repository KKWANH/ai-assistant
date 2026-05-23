/**
 * Tree-sitter symbol provider — accurate AST extraction for TS/JS/Python.
 *
 * The `tree-sitter` runtime and the per-language grammars are declared
 * as `optionalDependencies` in apps/server/package.json. When a platform
 * (Alpine musl, exotic ARM, very new Node ABI without a prebuild) can't
 * load them, the chooser falls through to the regex provider — see
 * docs/SYMBOL_INDEX_PLAN.md §8 for the architecture choice.
 *
 * The dynamic imports are wrapped in try/catch so module resolution
 * failures never crash the server. Type-check errors from the missing
 * package are silenced with `@ts-ignore` on the import lines; the AST
 * surface we use is captured in the local `TSNode` interface below so
 * the rest of the file stays typed.
 */
import type { SymbolRow } from "../../db/repo.js";
import logger from "../../logger.js";

type SymbolDraft = Omit<SymbolRow, "workspaceId" | "path">;

/** Subset of the tree-sitter Node API we actually call. */
interface TSNode {
  type: string;
  /** Lazy native getter — only read for short fields like an identifier. */
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(i: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
}

interface TSParser {
  setLanguage(lang: unknown): void;
  parse(source: string): { rootNode: TSNode };
}

interface TSConstructor {
  new (): TSParser;
}

type LanguageHandle = unknown;

interface LoadedRuntime {
  Parser: TSConstructor;
  langs: Record<string, LanguageHandle>;
}

/**
 * Cache the *promise* (not just the resolved value) so concurrent
 * first callers share one import dance. Sticky on both success and
 * failure — we never retry the import.
 */
let runtimeCache: Promise<LoadedRuntime | null> | null = null;

async function loadRuntime(): Promise<LoadedRuntime | null> {
  if (runtimeCache) return runtimeCache;
  runtimeCache = doLoadRuntime();
  return runtimeCache;
}

async function doLoadRuntime(): Promise<LoadedRuntime | null> {
  try {
    // @ts-ignore — optional dependency; may not resolve at typecheck time
    const tsRuntime = (await import("tree-sitter")).default as TSConstructor;
    // @ts-ignore — optional dependency
    const tsGrammar = (await import("tree-sitter-typescript")).default as {
      typescript: LanguageHandle;
      tsx: LanguageHandle;
    };
    // @ts-ignore — optional dependency
    const pyGrammar = (await import("tree-sitter-python")).default as LanguageHandle;

    // Sanity-parse — catches ABI mismatches that don't surface until
    // setLanguage. If this throws, we treat the whole stack as unloadable.
    const probe = new tsRuntime();
    probe.setLanguage(tsGrammar.typescript);
    probe.parse("const x = 1;");

    const langs: Record<string, LanguageHandle> = {
      ts: tsGrammar.typescript,
      cts: tsGrammar.typescript,
      mts: tsGrammar.typescript,
      // Plain JS is parsed with the TS grammar — every valid JS construct
      // is valid TS, so we don't pay for a separate JS grammar package.
      js: tsGrammar.typescript,
      cjs: tsGrammar.typescript,
      mjs: tsGrammar.typescript,
      tsx: tsGrammar.tsx,
      jsx: tsGrammar.tsx,
      py: pyGrammar,
    };
    logger.info({ langs: Object.keys(langs) }, "tree-sitter symbol provider ready");
    return { Parser: tsRuntime, langs };
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message ?? String(err) },
      "tree-sitter optional deps unavailable — falling back to regex symbol provider",
    );
    return null;
  }
}

export interface TreeSitterProvider {
  id: "tree-sitter";
  /** True only when all grammars loaded successfully. */
  ready: boolean;
  supports(ext: string): boolean;
  extract(text: string, ext: string): SymbolDraft[];
}

/**
 * Ensure the runtime is loaded and return a provider snapshot. Cheap
 * after the first call (cached). The caller passes the result down a
 * scan loop so we don't pay the import dance per file.
 */
export async function getTreeSitterProvider(): Promise<TreeSitterProvider> {
  const runtime = await loadRuntime();
  if (!runtime) {
    return {
      id: "tree-sitter",
      ready: false,
      supports: () => false,
      extract: () => [],
    };
  }
  // One parser instance per call site is fine — setLanguage swaps the
  // grammar in-place and parsing is single-threaded anyway.
  const parser = new runtime.Parser();
  return {
    id: "tree-sitter",
    ready: true,
    supports: (ext: string) => ext in runtime.langs,
    extract: (text: string, ext: string) => {
      const lang = runtime.langs[ext];
      if (!lang) return [];
      try {
        parser.setLanguage(lang);
        const tree = parser.parse(text);
        return ext === "py"
          ? extractPython(tree.rootNode, text)
          : extractTypeScript(tree.rootNode, text);
      } catch (err) {
        // A single bad file shouldn't poison the whole scan.
        logger.debug(
          { err: (err as Error)?.message ?? String(err), ext },
          "tree-sitter parse failure — skipping file",
        );
        return [];
      }
    },
  };
}

// ── TypeScript / JavaScript extraction ─────────────────────────────────

function extractTypeScript(root: TSNode, source: string): SymbolDraft[] {
  const rows: SymbolDraft[] = [];
  // Walk only the program's direct children — we don't extract symbols
  // from function/method bodies. (Local `const`s aren't useful in a
  // retrieval-time symbol index; they'd flood the table.)
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    if (child) visitTSTopLevel(child, rows, source, null, false);
  }
  return rows;
}

function visitTSTopLevel(
  node: TSNode,
  rows: SymbolDraft[],
  source: string,
  parentName: string | null,
  exported: boolean,
): void {
  const t = node.type;
  // `export ...` wraps the actual declaration; recurse with exported flag.
  if (t === "export_statement") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visitTSTopLevel(child, rows, source, parentName, true);
    }
    return;
  }

  // Namespaces / modules can nest declarations — walk into them.
  if (t === "internal_module" || t === "module") {
    const body = node.childForFieldName("body");
    if (body) {
      const nsName = nameOf(node) ?? parentName;
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i);
        if (child) visitTSTopLevel(child, rows, source, nsName, exported);
      }
    }
    return;
  }

  if (t === "function_declaration") {
    pushTS(node, rows, source, "function", parentName, exported);
    return;
  }
  if (t === "class_declaration") {
    const className = nameOf(node);
    pushTS(node, rows, source, "class", parentName, exported, className);
    const body = node.childForFieldName("body");
    if (body && className) {
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i);
        if (!child) continue;
        if (
          child.type === "method_definition" ||
          child.type === "method_signature"
        ) {
          pushTS(child, rows, source, "method", className, exported);
        }
      }
    }
    return;
  }
  if (t === "interface_declaration") {
    pushTS(node, rows, source, "interface", parentName, exported);
    return;
  }
  if (t === "type_alias_declaration") {
    pushTS(node, rows, source, "type", parentName, exported);
    return;
  }
  if (t === "lexical_declaration" || t === "variable_declaration") {
    // const/let at top level — one row per declarator.
    for (let i = 0; i < node.namedChildCount; i++) {
      const decl = node.namedChild(i);
      if (!decl || decl.type !== "variable_declarator") continue;
      pushTS(decl, rows, source, "const", parentName, exported);
    }
    return;
  }
  // Anything else at top level (import_statement, expressions, …) — skip.
}

function pushTS(
  node: TSNode,
  rows: SymbolDraft[],
  source: string,
  kind: SymbolRow["kind"],
  parentName: string | null,
  exported: boolean,
  /** Pre-extracted name — pass when the caller already looked it up
   *  (e.g. a class node's name is read before recursing into the body). */
  cachedName?: string | null,
): void {
  const name = cachedName !== undefined ? cachedName : nameOf(node);
  if (!name) return;
  rows.push({
    name,
    kind,
    line: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parent: parentName,
    signature: signatureOf(node, source, kind),
    exported,
  });
}

// ── Python extraction ──────────────────────────────────────────────────

function extractPython(root: TSNode, source: string): SymbolDraft[] {
  const rows: SymbolDraft[] = [];
  visitPy(root, rows, source, null, /*parentExported*/ true);
  return rows;
}

/**
 * Python "exported" is a convention, not a keyword — anything that
 * doesn't start with `_` is considered public IF its enclosing scope is
 * also public. `parentExported` carries that down: a non-underscore
 * method of a `_Internal` class is still effectively private.
 */
function visitPy(
  node: TSNode,
  rows: SymbolDraft[],
  source: string,
  parentName: string | null,
  parentExported: boolean,
): void {
  const t = node.type;
  // @decorator def foo(): / @decorator class C: — unwrap to the inner def.
  if (t === "decorated_definition") {
    const inner = node.childForFieldName("definition");
    if (inner) visitPy(inner, rows, source, parentName, parentExported);
    return;
  }
  if (t === "function_definition") {
    const name = nameOf(node);
    if (name) {
      const exported = parentExported && !name.startsWith("_");
      const kind = parentName ? "method" : "function";
      rows.push({
        name,
        kind,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parent: parentName,
        signature: signatureOf(node, source, kind),
        exported,
      });
    }
    return; // don't descend into function bodies — nested defs are uncommon
  }
  if (t === "class_definition") {
    const name = nameOf(node);
    if (name) {
      const exported = parentExported && !name.startsWith("_");
      rows.push({
        name,
        kind: "class",
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parent: parentName,
        signature: null,
        exported,
      });
      const body = node.childForFieldName("body");
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const child = body.namedChild(i);
          if (child) visitPy(child, rows, source, name, exported);
        }
      }
    }
    return;
  }
  // Module-level descent only — we don't walk into function bodies.
  if (t === "module") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visitPy(child, rows, source, parentName, parentExported);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function nameOf(node: TSNode): string | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const text = nameNode.text.trim();
  return text || null;
}

/**
 * Best-effort signature snippet — the first line of the symbol's body
 * trimmed and truncated. Good enough for tooltips.
 *
 * Reads from the original source via byte offsets instead of `node.text`
 * because the native getter materializes the *entire* node body as a
 * string just so we can drop 99% of it on `.split("\n")`. For a long
 * function or class declaration that's a lot of wasted allocation.
 */
function signatureOf(
  node: TSNode,
  source: string,
  kind: SymbolRow["kind"],
): string | null {
  if (kind === "const" || kind === "type" || kind === "interface") return null;
  // Read only up to the first newline after startIndex (or end of node).
  const start = node.startIndex;
  const cap = Math.min(node.endIndex, start + 300);
  const nl = source.indexOf("\n", start);
  const lineEnd = nl === -1 || nl > cap ? cap : nl;
  const firstLine = source.slice(start, lineEnd).trim();
  if (!firstLine) return null;
  const trimmed = firstLine.replace(/\s*\{?\s*$/, "");
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}
