import fs from "node:fs";
import path from "node:path";

export type LogName = "server" | "tunnel" | "supervisor";

/**
 * Rotate a single log: if logs/<name>.log exists, move it to
 * logs/archive/<name>-<ISO>.log, then create a fresh empty file.
 */
function rotateOne(logsDir: string, archiveDir: string, name: LogName): void {
  const logPath = path.join(logsDir, `${name}.log`);
  if (fs.existsSync(logPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = path.join(archiveDir, `${name}-${ts}.log`);
    fs.renameSync(logPath, archivePath);
  }
  // Touch a fresh file
  fs.writeFileSync(logPath, "");
}

/**
 * Rotate all known logs. Creates logs/ and logs/archive/ if missing.
 */
export function rotateLogs(logsDir: string, archiveDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const name of ["server", "tunnel", "supervisor"] as LogName[]) {
    rotateOne(logsDir, archiveDir, name);
  }
}

/**
 * Return the path for a given log name.
 */
export function logPath(logsDir: string, name: LogName): string {
  return path.join(logsDir, `${name}.log`);
}

/**
 * Read the last N lines from a log file. Returns an empty array if the file
 * does not exist.
 */
export function tailLog(logsDir: string, name: LogName, lines: number): string[] {
  const p = path.join(logsDir, `${name}.log`);
  if (!fs.existsSync(p)) return [];
  const content = fs.readFileSync(p, "utf8");
  const all = content.split("\n");
  // Remove trailing empty line from split
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  return all.slice(-lines);
}
