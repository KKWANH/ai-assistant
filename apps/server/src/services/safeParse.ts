/**
 * Document-parsing error envelope. The PDF / DOCX / XLSX / etc. parsers
 * each follow the same shape: try to dynamic-import the optional npm
 * library + do the parse, fall back to a friendly "[Could not parse X]"
 * string when anything throws.
 *
 * This helper captures the catch arm in one place so the placeholder
 * string format is owned by exactly one file. The try still wraps both
 * the import and the parse work (a tryImport-style helper would force
 * splitting them, which would be worse — see commit history).
 */

/**
 * Run `parse` and return its result. If it throws, return the friendly
 * "[Could not parse <label>]" placeholder instead. `label` is whatever
 * the caller wants displayed — usually `path.basename(absPath)` or an
 * uploaded filename.
 */
export async function tryParseDocument(
  label: string,
  parse: () => Promise<string>,
): Promise<string> {
  try {
    return await parse();
  } catch {
    return `[Could not parse ${label}]`;
  }
}
