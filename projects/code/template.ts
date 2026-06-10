/**
 * Code starter — sample workspace shaped like a tiny TypeScript project.
 *
 * Provides:
 *   src/index.ts, src/utils.ts, package.json, README.md
 *   .ariadne/actions.yaml — a 'fix-readme-typos' action that exercises
 *     the new edit_file + run_tests blocks end-to-end.
 *   .ariadne/surface.tsx — a code-shaped dashboard: file tree on the
 *     left, a "Latest staged edits" summary in the middle, and a
 *     workspace history panel on the right.
 *
 * The README ships with three deliberate typos so the demo 'fix-typos'
 * action has something to find on the first run.
 */

export const README_MD = `# Sample Project

A small TypeScript demo workspace seeded by the Ariadne code starter.

## Features

- Sample funtions in \`src/utils.ts\`
- Entry point in \`src/index.ts\`
- A tiny test command in \`package.json\`

## What to try

Click into the **Actions** tab and run \`fix-readme-typos\` — Ariadne will
read this file, propose typo fixes, and stage them for your review at
the run's diff page. Nothing is written to disk until you click Apply.

This is also a good place to play with the agent: ask it to "rename
\`add\` to \`sum\` everywhere and update the README" and watch it propose
the edit set as a series of staged changes you can accept selectively.
`;

export const PACKAGE_JSON = `{
  "name": "ariadne-code-starter",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "test": "node -e \\"console.log('ok')\\""
  }
}
`;

export const INDEX_TS = `import { add, multiply } from "./utils.js";

const a = 3;
const b = 4;

console.log(\`\${a} + \${b} = \${add(a, b)}\`);
console.log(\`\${a} * \${b} = \${multiply(a, b)}\`);
`;

export const UTILS_TS = `/** Sum two integers. */
export function add(x: number, y: number): number {
  return x + y;
}

/** Multiply two integers. */
export function multiply(x: number, y: number): number {
  return x * y;
}
`;

export const ACTIONS_YAML = `# Code starter — seed actions for the 'Create & Run' tab.
# Both demonstrate the Claude-Code Phase A blocks (edit_file, run_tests).
# Run them, then review the proposed edits at /runs/<id>/diff before applying.

actions:
  - id: fix_readme_typos
    name: README 오타 고치기
    description: README.md를 읽고 오타를 찾아 수정안을 stage합니다 (디스크에 직접 쓰지 않음).
    category: code
    blocks:
      - id: read_readme
        type: read_file
        config:
          path: README.md
      - id: propose_fixes
        type: ask_ai
        config:
          prompt: |
            아래는 README.md의 현재 내용입니다. 오타·문법 오류 후보를 찾고, 각각에 대해
            한 줄짜리 search/replace 페어를 정확히 JSON 한 줄로만 반환하세요. 형식:

            [{"search": "...", "replace": "..."}, ...]

            중요:
            - search 문자열은 README에 정확히 한 번만 등장해야 합니다.
            - 의미가 바뀌지 않도록 가장 안전한 수정만.
            - 만약 오타가 없으면 빈 배열 [] 만 출력.
      # Phase B step: a write_file that turns the JSON into a generated
      # patch file the user can inspect. (Phase C will replace this with
      # a real apply-loop block — for now it's a debug aid.)
      - id: archive_proposal
        type: write_file
        config:
          path: .ariadne/last-fix-proposal.json
          mode: replace

  - id: smoke_tests
    name: 스모크 테스트 실행
    description: package.json의 'npm test'를 실행합니다.
    category: code
    blocks:
      - id: tests
        type: run_tests
        config:
          command: npm test
          timeout_seconds: 60
`;

export const SURFACE_TSX = `/**
 * Code workspace surface — file tree + latest staged edits + history.
 *
 * Reads the workspace via the SDK:
 *   ariadne.listFiles()              → tree
 *   ariadne.readText(".ariadne/last-fix-proposal.json")
 *     → the latest fix-typos proposal (debug aid; gone once Phase C
 *       replaces it with a real loop).
 *
 * Edit this file freely; click Build in the editor tab to recompile.
 */

import { useState, useEffect, useAriadne } from "@ariadne/surface";

interface FileNode {
  path: string;
  size: number;
}

const cardStyle = {
  border: "1px solid rgb(var(--border))",
  borderRadius: "10px",
  background: "rgb(var(--card))",
  padding: "14px 16px",
};

const muted = { color: "rgb(var(--muted-foreground))", fontSize: "12px" };

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

export default function CodeDashboard() {
  const ariadne = useAriadne();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [proposal, setProposal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const list = await ariadne.listFiles();
        setFiles(list.map((f: any) => ({ path: f.path, size: f.size })));
        try {
          const prop = await ariadne.readText(".ariadne/last-fix-proposal.json");
          setProposal(prop);
        } catch {
          setProposal(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "rgb(var(--muted-foreground))" }}>
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "20px", color: "rgb(var(--destructive))" }}>
        {error}
      </div>
    );
  }

  // Group by top-level directory for a friendlier tree.
  const byDir = new Map<string, FileNode[]>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.split("/")[0] : "(root)";
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }
  const dirs = Array.from(byDir.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const totalFiles = files.length;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  return (
    <div style={{ padding: "20px 24px", color: "rgb(var(--foreground))", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Code workspace</h1>
        <p style={{ ...muted, margin: "4px 0 0" }}>
          {totalFiles} files · {formatBytes(totalBytes)}
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "12px" }}>
        {/* File tree */}
        <section style={{ ...cardStyle, padding: "10px 12px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
            Files
          </div>
          {dirs.length === 0 ? (
            <p style={muted}>No files indexed yet — run "Scan files" on the workspace header.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontFamily: "ui-monospace, SF Mono, monospace", fontSize: "12px" }}>
              {dirs.map(([dir, items]) => (
                <li key={dir} style={{ marginBottom: "6px" }}>
                  <div style={{ color: "rgb(var(--accent))", marginBottom: "2px" }}>📁 {dir}/</div>
                  {items.map((f) => (
                    <div key={f.path} style={{ paddingLeft: "16px", display: "flex", justifyContent: "space-between" }}>
                      <span>{f.path.replace(dir + "/", "")}</span>
                      <span style={{ color: "rgb(var(--muted-foreground))" }}>{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Latest proposal */}
        <section style={cardStyle}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
            Latest fix proposal
          </div>
          {proposal === null ? (
            <p style={muted}>
              Run the "README 오타 고치기" action to populate this panel.
            </p>
          ) : (
            <pre style={{
              fontFamily: "ui-monospace, SF Mono, monospace",
              fontSize: "12px",
              background: "rgb(var(--surface-2))",
              border: "1px solid rgb(var(--border))",
              borderRadius: "6px",
              padding: "10px",
              overflow: "auto",
              maxHeight: "300px",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {proposal}
            </pre>
          )}
        </section>
      </div>

      <p style={{ ...muted, marginTop: "16px", lineHeight: 1.6 }}>
        💡 This surface is a starting point. The next step is to fetch the staged
        manifest for the most recent run (Phase C feature) and render the diff inline
        here so the dashboard becomes a self-contained code review surface.
      </p>
    </div>
  );
}
`;
