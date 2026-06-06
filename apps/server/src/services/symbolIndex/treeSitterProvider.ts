/**
 * Tree-sitter symbol provider — accurate AST extraction for TS/JS/Python.
 *
 * The `tree-sitter` runtime and the per-language grammars are declared
 * as `optionalDependencies` in apps/server/package.json. When a platform
 * (Alpine musl, exotic ARM, very new Node ABI without a prebuild) can't
 * load them, the chooser falls through to the regex provider.
 *
 * The dynamic imports are wrapped in try/catch so module resolution
 * failures never crash the server. Type-check errors from the missing
 * package are silenced with `@ts-ignore` on the import lines; the AST
 * surface we use is captured in the local `TSNode` interface below so
 * the rest of the file stays typed.
 */
import type { SymbolDraft, SymbolRow } from "../../db/repo.js";
import logger from "../../logger.js";

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

// ── AST node-type constants ────────────────────────────────────────────
//
// Local inventory of the tree-sitter node types we care about. Using
// const refs instead of bare string literals turns typos into compile
// errors — `NodeType.EXPRT_STATEMENT` fails to resolve where
// `"exprot_statement"` would silently never match.
//
// Tree-sitter has no upstream NodeType enum; the grammars ship a
// node-types.json but it's a runtime artefact. Keeping this list
// matched against the JSON is a manual step, but trivial — these
// names change roughly once per grammar major version.

const NODE_TYPE = {
  // TypeScript / JavaScript
  EXPORT_STATEMENT: "export_statement",
  INTERNAL_MODULE: "internal_module",
  MODULE: "module",
  FUNCTION_DECLARATION: "function_declaration",
  CLASS_DECLARATION: "class_declaration",
  METHOD_DEFINITION: "method_definition",
  METHOD_SIGNATURE: "method_signature",
  INTERFACE_DECLARATION: "interface_declaration",
  TYPE_ALIAS_DECLARATION: "type_alias_declaration",
  LEXICAL_DECLARATION: "lexical_declaration",
  VARIABLE_DECLARATION: "variable_declaration",
  VARIABLE_DECLARATOR: "variable_declarator",
  // Python
  DECORATED_DEFINITION: "decorated_definition",
  FUNCTION_DEFINITION: "function_definition",
  CLASS_DEFINITION: "class_definition",
} as const;

// ── Shared helpers ─────────────────────────────────────────────────────

/** Iterate a node's named children, skipping nulls. The native binding
 *  returns null for out-of-range indices; the explicit guard keeps the
 *  callers free of `if (child)` repetition. */
function forEachNamedChild(node: TSNode, fn: (child: TSNode) => void): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) fn(child);
  }
}

/**
 * Walk context threaded through the recursive visitors. `rows` and
 * `source` are scan-wide constants; `parent` and `exported` change
 * with scope (export_statement, class body, namespace). Passing one
 * object instead of five positional args makes state changes explicit
 * — the only mutating recursion creates `{ ...ctx, exported: true }`
 * etc., which is harder to do wrong than threading five args by hand.
 */
interface VisitCtx {
  rows: SymbolDraft[];
  source: string;
  /** Enclosing class name for methods, null at top level. */
  parent: string | null;
  /** TS: in an `export ...` wrapper. Python: enclosing scope is public. */
  exported: boolean;
}

/**
 * Build and push a SymbolDraft row. Both visitors funnel through this
 * so the row shape is described in exactly one place — if SymbolRow
 * grows a new column, only this function needs to learn it.
 */
function pushRow(
  ctx: VisitCtx,
  node: TSNode,
  name: string,
  kind: SymbolRow["kind"],
  signature: string | null,
): void {
  ctx.rows.push({
    name,
    kind,
    line: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    parent: ctx.parent,
    signature,
    exported: ctx.exported,
  });
}

// ── TypeScript / JavaScript extraction ─────────────────────────────────

function extractTypeScript(root: TSNode, source: string): SymbolDraft[] {
  // Walk only the program's direct children — local `const`s inside
  // function/method bodies aren't useful for a retrieval-time index.
  const ctx: VisitCtx = { rows: [], source, parent: null, exported: false };
  forEachNamedChild(root, (child) => visitTSTopLevel(ctx, child));
  return ctx.rows;
}

function visitTSTopLevel(ctx: VisitCtx, node: TSNode): void {
  const t = node.type;
  // `export ...` wraps the actual declaration; recurse with exported flag.
  if (t === NODE_TYPE.EXPORT_STATEMENT) {
    const childCtx: VisitCtx = { ...ctx, exported: true };
    forEachNamedChild(node, (c) => visitTSTopLevel(childCtx, c));
    return;
  }

  // Namespaces / modules can nest declarations — walk into them.
  if (t === NODE_TYPE.INTERNAL_MODULE || t === NODE_TYPE.MODULE) {
    const body = node.childForFieldName("body");
    if (body) {
      const childCtx: VisitCtx = { ...ctx, parent: nameOf(node) ?? ctx.parent };
      forEachNamedChild(body, (c) => visitTSTopLevel(childCtx, c));
    }
    return;
  }

  if (t === NODE_TYPE.FUNCTION_DECLARATION) {
    const name = nameOf(node);
    if (name) pushRow(ctx, node, name, "function", signatureOf(node, ctx.source, "function"));
    return;
  }
  if (t === NODE_TYPE.CLASS_DECLARATION) {
    const className = nameOf(node);
    if (!className) return;
    pushRow(ctx, node, className, "class", signatureOf(node, ctx.source, "class"));
    const body = node.childForFieldName("body");
    if (body) {
      const methodCtx: VisitCtx = { ...ctx, parent: className };
      forEachNamedChild(body, (child) => {
        if (
          child.type !== NODE_TYPE.METHOD_DEFINITION &&
          child.type !== NODE_TYPE.METHOD_SIGNATURE
        ) return;
        const methodName = nameOf(child);
        if (methodName) {
          pushRow(methodCtx, child, methodName, "method", signatureOf(child, ctx.source, "method"));
        }
      });
    }
    return;
  }
  if (t === NODE_TYPE.INTERFACE_DECLARATION) {
    const name = nameOf(node);
    if (name) pushRow(ctx, node, name, "interface", null);
    return;
  }
  if (t === NODE_TYPE.TYPE_ALIAS_DECLARATION) {
    const name = nameOf(node);
    if (name) pushRow(ctx, node, name, "type", null);
    return;
  }
  if (t === NODE_TYPE.LEXICAL_DECLARATION || t === NODE_TYPE.VARIABLE_DECLARATION) {
    // const/let at top level — one row per declarator.
    forEachNamedChild(node, (decl) => {
      if (decl.type !== NODE_TYPE.VARIABLE_DECLARATOR) return;
      const name = nameOf(decl);
      if (name) pushRow(ctx, decl, name, "const", null);
    });
    return;
  }
  // Anything else at top level (import_statement, expressions, …) — skip.
}

// ── Python extraction ──────────────────────────────────────────────────

function extractPython(root: TSNode, source: string): SymbolDraft[] {
  // Top-level Python scope is public by convention — parentExported = true.
  const ctx: VisitCtx = { rows: [], source, parent: null, exported: true };
  visitPy(ctx, root);
  return ctx.rows;
}

/**
 * Python "exported" is a convention, not a keyword — anything that
 * doesn't start with `_` is considered public IF its enclosing scope is
 * also public. `ctx.exported` carries that down: a non-underscore method
 * of a `_Internal` class is still effectively private.
 */
function visitPy(ctx: VisitCtx, node: TSNode): void {
  const t = node.type;
  // @decorator def foo(): / @decorator class C: — unwrap to the inner def.
  if (t === NODE_TYPE.DECORATED_DEFINITION) {
    const inner = node.childForFieldName("definition");
    if (inner) visitPy(ctx, inner);
    return;
  }
  if (t === NODE_TYPE.FUNCTION_DEFINITION) {
    const name = nameOf(node);
    if (!name) return;
    const exported = ctx.exported && !name.startsWith("_");
    const kind = ctx.parent ? "method" : "function";
    pushRow({ ...ctx, exported }, node, name, kind, signatureOf(node, ctx.source, kind));
    return; // don't descend into function bodies — nested defs are uncommon
  }
  if (t === NODE_TYPE.CLASS_DEFINITION) {
    const name = nameOf(node);
    if (!name) return;
    const exported = ctx.exported && !name.startsWith("_");
    pushRow({ ...ctx, exported }, node, name, "class", null);
    const body = node.childForFieldName("body");
    if (body) {
      const childCtx: VisitCtx = { ...ctx, parent: name, exported };
      forEachNamedChild(body, (c) => visitPy(childCtx, c));
    }
    return;
  }
  // Module-level descent only — we don't walk into function bodies.
  if (t === NODE_TYPE.MODULE) {
    forEachNamedChild(node, (c) => visitPy(ctx, c));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function nameOf(node: TSNode): string | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  // Tree-sitter returns byte-precise identifiers — no surrounding
  // whitespace ever lives inside a `name` field, so no .trim() needed.
  const text = nameNode.text;
  return text.length > 0 ? text : null;
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
