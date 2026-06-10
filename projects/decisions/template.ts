/**
 * Decisions starter — a workspace shaped like a product / engineering
 * decision log. Ships a sample PRD, two ADRs (one accepted, one
 * superseded), and an open-questions tracker, plus a dashboard surface
 * that surfaces 'what's open', 'recent decisions', and 'pending
 * questions' at a glance.
 *
 * Pairs naturally with scheduled actions ('weekly digest of decisions
 * this week') and the agent's edit_file flow ('rewrite the rationale
 * section to mention the rollback plan').
 */

export const PRD_SAMPLE = `# PRD: Workspace Search Bar

**Status:** draft · 2026-05-23 · @kwanho

## Problem

Users with many workspaces have to navigate via the sidebar dropdown,
which doesn't scale past 10 workspaces. Power users keep asking for
keyboard-driven workspace switching.

## Proposed solution

Add a workspace-scoped search bar pinned to the workspace header. ⌘K
inside a workspace opens it; results are filtered to files within
the current workspace and to recent runs.

## Success criteria

- 80%+ of power-user workspace switches use the search bar within
  the first month of release.
- Median time-to-open-target-file under 800 ms on a workspace with
  1,000 indexed files.

## Open questions

See \`open-questions.md\`.
`;

export const ADR_001 = `# ADR-001 — Use SQLite as the single store

**Status:** accepted · 2026-04-12

## Context

We considered Postgres, MongoDB, and a key/value store. The user
machine is the deployment target, so any networked DB adds operational
weight without a corresponding benefit.

## Decision

Use Node's built-in \`node:sqlite\` for everything: workspaces, runs,
chats, evidence packs, schedules, attempts. One file, zero install.

## Consequences

- Pros: zero-config, portable, the same file is the backup.
- Cons: no concurrent writers (acceptable — Ariadne is single-tenant);
  no full-text search out of the box (we built a small FTS table).
`;

export const ADR_002 = `# ADR-002 — Tree-sitter for symbol search

**Status:** superseded by ADR-003 · 2026-04-29

## Context

The original retrieval ranker is keyword-only. For code workspaces,
function/class names should boost their containing chunks. We
considered shipping web-tree-sitter with 5–6 language grammars.

## Decision

Use tree-sitter to extract symbols at scan time.

## Consequences (revisited)

Each grammar WASM is 0.5–2 MB. Bundling six is ~7 MB of static
assets on first load. We don't have a strong evidence base that the
extra accuracy beats a focused regex extractor.

→ Superseded by **ADR-003**: ship a regex-based extractor first;
revisit tree-sitter when we see a real query that regex misses.
`;

export const OPEN_QUESTIONS = `# Open questions

A scratchpad. Each line is a one-sentence question with an owner
and a target answer date. Move resolved items into an ADR.

- [ ] How do we let an org of 5 share workspaces without inventing
      multi-tenant auth? · @kwanho · 2026-06-01
- [ ] Do we ship the agent's edit_file tool as plan-only or
      full-staging in v0.1? · @kwanho · 2026-05-30 → resolved by
      ADR-???: full-staging via attempts.
- [ ] What's a sane default for schedule timezones? Tied to
      account locale or host clock? · @kwanho · 2026-06-15
`;

export const DECISIONS_README = `# Decisions log

A workspace for product / engineering decisions in one folder.

\`\`\`
prd/                — Product Requirement Docs in progress
decisions/          — ADRs (accepted / superseded / rejected)
open-questions.md   — scratchpad
\`\`\`

Open the **Custom screen** tab for the at-a-glance dashboard.

The seeded actions exercise scheduled summaries and agent edits:
- \`weekly_digest\` runs every Monday at 09:00 and writes a brief to
  \`digests/{date}.md\`.
- \`draft_new_adr\` chains read_file → ask_ai → edit_file (staged) so
  you can review the proposal before it lands.
`;

export const ACTIONS_YAML = `# Decisions starter — seed actions.
# Both demonstrate the new Phase-B/C blocks (write_file, edit_file).

actions:
  - id: weekly_digest
    name: 주간 결정 요약
    description: 지난 7일 동안의 결정과 새로 추가된 PRD/ADR을 요약합니다.
    category: decisions
    blocks:
      - id: read_q
        type: read_file
        config:
          path: open-questions.md
      - id: summarize
        type: ask_ai
        config:
          prompt: |
            아래는 워크스페이스의 open-questions.md입니다. 이번 주에 결정된 항목과
            아직 열려 있는 항목을 표로 정리한 짧은 주간 디지스트를 마크다운으로 작성하세요.
            제목 한 줄 + ## 결정됨 / ## 미정 / ## 다음 주에 결정해야 할 것 섹션.
      - id: archive
        type: write_file
        config:
          path: digests/{date}.md
          mode: replace

  - id: draft_new_adr
    name: 새 ADR 초안
    description: 입력 주제로 ADR-XXX.md 초안을 stage합니다. /runs/<id>/diff에서 검토 후 적용.
    category: decisions
    blocks:
      - id: read_adr
        type: read_file
        config:
          path: decisions/ADR-001-sqlite.md
      - id: propose
        type: ask_ai
        config:
          prompt: |
            아래는 기존 ADR 한 편의 양식입니다. 이 양식을 따라 새 ADR을 작성해 주세요.
            (사용자 입력 주제는 이 블록의 description으로 들어옵니다)
            Status: draft, Context / Decision / Consequences 섹션 포함.
      - id: stage
        type: edit_file
        config:
          path: decisions/ADR-draft.md
          # ask_ai의 결과가 content로 들어가 신규 파일로 stage됩니다.
          content: ""
`;

export const SURFACE_TSX = `/**
 * Decisions Log — workspace dashboard.
 *
 * Lists open PRDs, recent ADRs, and the open-questions tracker. All
 * read via the SDK's listFiles + readText; no special server work.
 */

import { useState, useEffect, useAriadne } from "@ariadne/surface";

interface DocFile {
  path: string;
  title: string;
  status: string;
}

const cardStyle = {
  border: "1px solid rgb(var(--border))",
  borderRadius: "10px",
  background: "rgb(var(--card))",
  padding: "14px 16px",
};
const muted = { color: "rgb(var(--muted-foreground))", fontSize: "12px" };

function extractTitle(body: string, fallback: string): string {
  const m = body.split("\\n").find((l) => l.startsWith("# "));
  return m ? m.slice(2).trim() : fallback;
}
function extractStatus(body: string): string {
  const m = body.match(/\\*\\*Status:\\*\\*\\s+([^\\n·]+)/i);
  return m ? (m[1] ?? "").trim() : "—";
}
function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("accepted")) return "rgb(var(--success))";
  if (s.includes("draft")) return "rgb(var(--info))";
  if (s.includes("rejected")) return "rgb(var(--destructive))";
  if (s.includes("superseded")) return "rgb(var(--muted-foreground))";
  return "rgb(var(--foreground))";
}

async function loadFolder(ariadne: any, dir: string): Promise<DocFile[]> {
  try {
    const list = await ariadne.listFiles();
    const inDir = list.filter((f: any) => f.path.startsWith(dir + "/") && f.path.endsWith(".md"));
    const out: DocFile[] = [];
    for (const f of inDir) {
      try {
        const body = await ariadne.readText(f.path);
        out.push({
          path: f.path,
          title: extractTitle(body, f.path),
          status: extractStatus(body),
        });
      } catch {
        // skip unreadable
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default function DecisionsDashboard() {
  const ariadne = useAriadne();
  const [prds, setPrds] = useState<DocFile[]>([]);
  const [adrs, setAdrs] = useState<DocFile[]>([]);
  const [questions, setQuestions] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [p, a] = await Promise.all([
          loadFolder(ariadne, "prd"),
          loadFolder(ariadne, "decisions"),
        ]);
        setPrds(p);
        setAdrs(a);
        try {
          setQuestions(await ariadne.readText("open-questions.md"));
        } catch {
          setQuestions("");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) return <div style={{ padding: "40px", textAlign: "center", color: "rgb(var(--muted-foreground))" }}>Loading…</div>;
  if (error) return <div style={{ padding: "20px", color: "rgb(var(--destructive))" }}>{error}</div>;

  // Count open vs resolved questions — really tiny parser, just looks
  // for [ ] / [x] in the markdown.
  let openCount = 0;
  let doneCount = 0;
  for (const line of questions.split("\\n")) {
    if (/^\\s*-\\s*\\[\\s*\\]/.test(line)) openCount++;
    else if (/^\\s*-\\s*\\[x\\]/i.test(line)) doneCount++;
  }

  return (
    <div style={{ padding: "20px 24px", color: "rgb(var(--foreground))", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Decisions log</h1>
        <p style={{ ...muted, margin: "4px 0 0" }}>
          {adrs.length} ADRs · {prds.length} PRDs · {openCount} open questions
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "12px", marginBottom: "16px" }}>
        {/* PRDs */}
        <section style={cardStyle}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
            PRDs
          </div>
          {prds.length === 0 ? (
            <p style={muted}>No PRDs yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {prds.map((p) => (
                <li key={p.path} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed rgb(var(--border))" }}>
                  <span style={{ fontSize: "13px" }}>{p.title}</span>
                  <span style={{ fontSize: "11px", color: statusTone(p.status) }}>{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ADRs */}
        <section style={cardStyle}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
            ADRs
          </div>
          {adrs.length === 0 ? (
            <p style={muted}>No ADRs yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {adrs.map((a) => (
                <li key={a.path} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed rgb(var(--border))" }}>
                  <span style={{ fontSize: "13px" }}>{a.title}</span>
                  <span style={{ fontSize: "11px", color: statusTone(a.status) }}>{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Open questions */}
      <section style={cardStyle}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
          <span>Open questions</span>
          <span style={{ color: "rgb(var(--muted-foreground))" }}>
            {openCount} open · {doneCount} resolved
          </span>
        </div>
        <pre style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: "13px",
          whiteSpace: "pre-wrap",
          margin: 0,
          lineHeight: 1.5,
          color: "rgb(var(--foreground))",
        }}>
          {questions || "open-questions.md is empty."}
        </pre>
      </section>
    </div>
  );
}
`;
