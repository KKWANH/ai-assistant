import fs from "node:fs";
import path from "node:path";
import type { LogName } from "./logManager.js";

export interface ErrorEntry {
  message: string;
  count: number;
  lastSeen: string; // ISO timestamp
  diagnosis: string;
}

export interface ErrorReport {
  generatedAt: string;
  errors: ErrorEntry[];
}

// ── Heuristic diagnoses ───────────────────────────────────────────────────

function diagnose(line: string): string {
  if (/EADDRINUSE/.test(line)) return "Port already in use — another process is occupying the port.";
  if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|apiKey|api_key|401/.test(line))
    return "AI provider key missing or invalid — check Settings.";
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(line))
    return "Dependency missing — run npm install in the repo root.";
  if (/node:sqlite|better-sqlite3|sqlite/.test(line))
    return "SQLite module issue — Node built-in sqlite may not be available, or the DB file is corrupt.";
  if (/Unable to reach|connection refused|ERR_CONNECTION_REFUSED|tunnelconnect|cloudflare/i.test(line))
    return "Tunnel connectivity problem — check internet connection or restart cloudflared.";
  if (/ENOENT/.test(line)) return "File or directory not found — check paths and workspace configuration.";
  if (/ENOMEM|heap out of memory/.test(line)) return "Out of memory — reduce workspace size or restart the server.";
  if (/EACCES|EPERM/.test(line)) return "Permission denied — check file system permissions.";
  if (/SyntaxError/.test(line)) return "Syntax error in server code — check recent edits.";
  if (/TypeError/.test(line)) return "Type error in server code — a value was null, undefined, or the wrong type.";
  if (/UnhandledPromiseRejection/.test(line)) return "Unhandled promise rejection — review server logs for the root cause.";
  return "Unexpected error — review the log for full context.";
}

const ERROR_PATTERN =
  /\b(error|err|exception|uncaught|unhandled|fatal|TypeError|ReferenceError|SyntaxError|ENOENT|EADDRINUSE|ENOMEM|EACCES|EPERM)\b/i;

const STACK_PATTERN = /^\s+at\s+/;

/**
 * Normalise a line for grouping: strip timestamps, memory addresses, and
 * file:line:col references so similar errors collapse together.
 */
function normalise(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<ts>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/:\d+:\d+\)?/g, ":<loc>")
    .trim();
}

function readLog(logsDir: string, name: LogName): string[] {
  const p = path.join(logsDir, `${name}.log`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n");
}

export function analyzeErrors(logsDir: string): ErrorReport {
  const lines: string[] = [
    ...readLog(logsDir, "server"),
    ...readLog(logsDir, "tunnel"),
  ];

  // Collect error lines (skip pure stack frames)
  const grouped = new Map<string, { raw: string; count: number; lastSeen: string }>();

  for (const line of lines) {
    if (!line.trim()) continue;
    if (STACK_PATTERN.test(line)) continue; // stack frame — attribute to prior error
    if (!ERROR_PATTERN.test(line)) continue;

    const key = normalise(line);
    const ts = new Date().toISOString();
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = ts;
    } else {
      grouped.set(key, { raw: line.trim(), count: 1, lastSeen: ts });
    }
  }

  const errors: ErrorEntry[] = Array.from(grouped.values()).map((e) => ({
    message: e.raw.length > 200 ? e.raw.slice(0, 200) + "…" : e.raw,
    count: e.count,
    lastSeen: e.lastSeen,
    diagnosis: diagnose(e.raw),
  }));

  // Most frequent first
  errors.sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    errors: errors.slice(0, 50), // cap at 50 distinct errors
  };
}
