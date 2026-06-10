/**
 * Research papers starter — workspace shaped like a personal research
 * library. Ships three sample paper notes (with intentional citation
 * links between them so the citation graph isn't trivial), a small
 * .bib references file, and a surface that surfaces 'what I'm reading',
 * citation count per paper, and an open-question scratchpad.
 *
 * Real PDFs are NOT bundled (would inflate the repo); papers live as
 * markdown notes that reference the PDF by path. Users drop their own
 * PDFs into `papers/pdfs/` — the chat-context parser already handles
 * PDFs (with OCR fallback for scans).
 */

export const PAPERS_README = `# Research papers

A workspace shaped like a personal research library. The structure:

\`\`\`
papers/notes/         — markdown notes per paper (citations as [Smith24])
papers/pdfs/          — drop your actual PDFs here (parsed automatically
                        on chat attach, OCR-fallback for scans)
references.bib        — BibTeX
reading-queue.md      — what's next, with priorities
\`\`\`

Open the **Custom screen** tab for the dashboard — papers list with
inbound citation count, the reading queue, and recent notes.

Seeded actions:
- \`summarize_paper\` reads a chosen notes file and produces a
  150-word lay summary (write_file to \`summaries/{date}-<slug>.md\`).
- \`citation_audit\` reads every note and asks the model to flag
  citations that don't actually resolve to anything in references.bib.
`;

export const NOTES_SMITH24 = `# Smith24 — Retrieval-Augmented Generation: a survey

**Authors:** A. Smith, B. Lee, C. Park · **Year:** 2024
**Status:** read · **My rating:** ★★★★☆

## TL;DR

A taxonomy of RAG approaches: dense retrieval (DPR-style), sparse
retrieval (BM25 plus learned variants), hybrid (RRF / weighted),
and graph-based. Argues that "best" is workload-dependent — purely
factual lookup leans dense, multi-hop reasoning benefits from graph
edges.

## Key claims

1. Dense retrieval generalises better across domains than BM25 alone
   (cites [Karpukhin20]).
2. Reranking (cross-encoder) recovers most of the gap between sparse
   and dense for short queries.
3. Adding a small graph layer over retrieved chunks helps multi-hop
   QA more than scaling up retrieval count.

## My notes

Reads similarly to [Park23]'s argument that hybrid > pure-dense for
production systems. Worth re-reading after [Lee24].

## References

- [Karpukhin20] Karpukhin et al., "Dense Passage Retrieval for Open-Domain QA"
- [Park23] Park et al., "Hybrid retrieval for production search"
- [Lee24] Lee et al., "Graph-augmented retrieval for multi-hop QA"
`;

export const NOTES_PARK23 = `# Park23 — Hybrid retrieval for production search

**Authors:** D. Park, E. Kim · **Year:** 2023
**Status:** read · **My rating:** ★★★★★

## TL;DR

A case study on a 100M-doc production system showing that RRF
(reciprocal rank fusion) of BM25 + dense beats either alone by
~12% NDCG@10 at the same latency budget.

## Key claims

1. Sparse retrieval is essential as a fallback for out-of-domain
   queries the dense encoder hasn't seen.
2. Indexing cost dominates serving cost — dense indexes are 5–10×
   heavier than BM25, so a hybrid is also cheaper to maintain.
3. Latency budget is the real design constraint, not "best NDCG".

## My notes

Foundational — every "hybrid retrieval" paper since (including
[Smith24]'s survey) cites this. Doesn't address agent-driven multi-
hop; see [Lee24] for that.

## References

- [Lee24] Lee et al., "Graph-augmented retrieval for multi-hop QA"
`;

export const NOTES_LEE24 = `# Lee24 — Graph-augmented retrieval for multi-hop QA

**Authors:** G. Lee, H. Hwang · **Year:** 2024
**Status:** reading · **My rating:** ?

## TL;DR (so far)

Adds a small graph layer over retrieved chunks where edges encode
"these chunks were retrieved together for similar queries". Reports
a 4–6 pt EM gain on HotpotQA over a dense-only baseline at matched
retrieval cost.

## Open questions

- How does the graph stay fresh as the corpus grows? Authors say
  "rebuild nightly" — operationally that's a lot.
- Compare to [Smith24]'s graph section — Smith24 is more skeptical.

## References

- [Smith24] Smith et al., "Retrieval-Augmented Generation: a survey"
- [Park23] Park et al., "Hybrid retrieval for production search"
`;

export const REFERENCES_BIB = `@article{Smith24,
  author    = {Smith, A. and Lee, B. and Park, C.},
  title     = {Retrieval-Augmented Generation: a survey},
  journal   = {Foundations and Trends in IR},
  year      = {2024},
  volume    = {17},
  number    = {1},
  pages     = {1--98}
}

@inproceedings{Park23,
  author    = {Park, D. and Kim, E.},
  title     = {Hybrid retrieval for production search},
  booktitle = {SIGIR 2023},
  year      = {2023}
}

@inproceedings{Lee24,
  author    = {Lee, G. and Hwang, H.},
  title     = {Graph-augmented retrieval for multi-hop QA},
  booktitle = {ACL 2024},
  year      = {2024}
}

@inproceedings{Karpukhin20,
  author    = {Karpukhin, V. and Oguz, B. and others},
  title     = {Dense Passage Retrieval for Open-Domain Question Answering},
  booktitle = {EMNLP 2020},
  year      = {2020}
}
`;

export const READING_QUEUE = `# Reading queue

Drop a paper into \`papers/pdfs/\` and add a one-line entry below.
Move to \`papers/notes/\` once you start reading.

- [ ] **high** — Borgeaud22 "Improving language models by retrieving from trillions of tokens"
- [ ] **high** — Izacard23 "Atlas: Few-shot Learning with Retrieval Augmented Language Models"
- [ ] mid  — Asai23 "Self-RAG: Self-Reflective Retrieval"
- [ ] mid  — Glass22 "Re2G: Retrieve, Rerank, Generate"
- [ ] low  — Khattab22 "Demonstrate-Search-Predict"
`;

export const ACTIONS_YAML = `# Research papers starter — seed actions.

actions:
  - id: summarize_paper
    name: 논문 한 줄 요약
    description: 선택한 노트 파일을 150자 내외 평이체로 정리해 summaries/에 저장.
    category: papers
    blocks:
      - id: read_note
        type: read_file
        config:
          path: papers/notes/Smith24-rag-survey.md
      - id: summarize
        type: ask_ai
        config:
          prompt: |
            아래는 한 논문에 대한 내 노트입니다. 비전공자도 이해할 수 있는 평이체로
            150자 내외 한 단락 요약을 작성해 주세요. 단정적 어조 X, 인용은 노트에 있는
            그대로 보존.
      - id: archive
        type: write_file
        config:
          path: summaries/{date}-summary.md
          mode: replace

  - id: citation_audit
    name: 인용 점검
    description: 노트의 [Author23] 형태 인용 중 references.bib에 없는 항목을 찾아냅니다.
    category: papers
    blocks:
      - id: read_refs
        type: read_file
        config:
          path: references.bib
      - id: read_smith
        type: read_file
        config:
          path: papers/notes/Smith24-rag-survey.md
      - id: audit
        type: ask_ai
        config:
          prompt: |
            references.bib에 있는 키 목록과, 노트에서 사용된 [Key] 형태 인용을 비교해서
            'references.bib에 없는 키' / '사용되지 않은 키' 두 표를 마크다운으로
            만들어 주세요.
`;

export const SURFACE_TSX = `/**
 * Research papers — workspace dashboard.
 *
 * Lists notes from papers/notes/, counts inbound citations (how many
 * OTHER notes cite each paper), shows reading-queue items, and reads
 * the references.bib key set. All via the SDK; no special server work.
 */

import { useState, useEffect, useAriadne } from "@ariadne/surface";

interface Note {
  path: string;
  title: string;
  status: string;
  rating: number;
  /** Citation keys this note USES (in body or refs section). */
  cites: string[];
  /** Citation key OF this note itself, derived from filename. */
  key: string;
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
function extractRating(body: string): number {
  const m = body.match(/★+/);
  return m ? m[0].length : 0;
}
function extractCitationKeys(body: string): string[] {
  const out = new Set<string>();
  // Match [Key] tokens that look like AuthorYY (not generic [1] [2]).
  const re = /\\[([A-Z][A-Za-z]+\\d{2})\\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.add(m[1]!);
  }
  return Array.from(out);
}
/** Derive the note's own citation key from its filename. */
function keyFromPath(path: string): string {
  const base = path.split("/").pop() ?? "";
  const m = base.match(/^([A-Z][A-Za-z]+\\d{2})/);
  return m ? m[1]! : base.replace(/\\..+$/, "");
}

async function loadNotes(ariadne: any): Promise<Note[]> {
  try {
    const list = await ariadne.listFiles();
    const inDir = list.filter((f: any) =>
      f.path.startsWith("papers/notes/") && f.path.endsWith(".md"),
    );
    const out: Note[] = [];
    for (const f of inDir) {
      try {
        const body = await ariadne.readText(f.path);
        out.push({
          path: f.path,
          title: extractTitle(body, f.path),
          status: extractStatus(body),
          rating: extractRating(body),
          cites: extractCitationKeys(body),
          key: keyFromPath(f.path),
        });
      } catch {
        // skip
      }
    }
    return out;
  } catch {
    return [];
  }
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("read") && !s.includes("reading")) return "rgb(var(--success))";
  if (s.includes("reading")) return "rgb(var(--info))";
  if (s.includes("queued")) return "rgb(var(--warning))";
  return "rgb(var(--muted-foreground))";
}

export default function PapersDashboard() {
  const ariadne = useAriadne();
  const [notes, setNotes] = useState<Note[]>([]);
  const [queue, setQueue] = useState<string>("");
  const [bibKeys, setBibKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const n = await loadNotes(ariadne);
        setNotes(n);
        try { setQueue(await ariadne.readText("reading-queue.md")); } catch { setQueue(""); }
        try {
          const bib = await ariadne.readText("references.bib");
          const keys = (bib.match(/@\\w+\\{([^,]+),/g) ?? []).map(
            (m: string) => (m.match(/@\\w+\\{([^,]+),/)?.[1] ?? "").trim(),
          );
          setBibKeys(keys.filter(Boolean));
        } catch { setBibKeys([]); }
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

  // Build inbound-citation count per note key.
  const inbound = new Map<string, number>();
  for (const n of notes) {
    for (const cite of n.cites) {
      inbound.set(cite, (inbound.get(cite) ?? 0) + 1);
    }
  }

  // Sort notes by inbound citation desc — most-cited surface first.
  const sortedNotes = notes.slice().sort((a, b) => (inbound.get(b.key) ?? 0) - (inbound.get(a.key) ?? 0));

  // Queue items: count [ ] vs [x]
  let queueOpen = 0;
  let queueDone = 0;
  for (const line of queue.split("\\n")) {
    if (/^\\s*-\\s*\\[\\s*\\]/.test(line)) queueOpen++;
    else if (/^\\s*-\\s*\\[x\\]/i.test(line)) queueDone++;
  }

  // Cite keys that aren't in references.bib.
  const allCites = new Set<string>();
  for (const n of notes) for (const c of n.cites) allCites.add(c);
  const orphanCites = Array.from(allCites).filter((c) => !bibKeys.includes(c));

  return (
    <div style={{ padding: "20px 24px", color: "rgb(var(--foreground))", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Research papers</h1>
        <p style={{ ...muted, margin: "4px 0 0" }}>
          {notes.length} notes · {bibKeys.length} bib entries · {queueOpen} queued
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Notes — ranked by inbound citations */}
        <section style={cardStyle}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
            Notes — sorted by inbound citations
          </div>
          {sortedNotes.length === 0 ? (
            <p style={muted}>No notes yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sortedNotes.map((n) => (
                <li key={n.path} style={{ padding: "6px 0", borderBottom: "1px dashed rgb(var(--border))" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: "13px" }}>{n.title}</span>
                    <span style={{ fontSize: "11px", color: "rgb(var(--accent))" }}>
                      ← {inbound.get(n.key) ?? 0} citations
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "2px" }}>
                    <span style={{ color: statusTone(n.status), marginRight: "8px" }}>{n.status}</span>
                    <span style={{ color: "rgb(var(--warning))" }}>{"★".repeat(n.rating)}{"☆".repeat(Math.max(0, 5 - n.rating))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Queue */}
        <section style={cardStyle}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
            <span>Reading queue</span>
            <span style={{ color: "rgb(var(--muted-foreground))" }}>
              {queueOpen} open · {queueDone} done
            </span>
          </div>
          <pre style={{
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: "12px",
            whiteSpace: "pre-wrap",
            margin: 0,
            lineHeight: 1.5,
          }}>
            {queue || "reading-queue.md is empty."}
          </pre>
        </section>
      </div>

      {/* Citation audit */}
      <section style={{
        ...cardStyle,
        borderColor: orphanCites.length > 0 ? "rgb(var(--warning))" : "rgb(var(--border))",
        background: orphanCites.length > 0 ? "rgb(var(--warning) / 0.08)" : "rgb(var(--card))",
      }}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "8px" }}>
          Citation audit
        </div>
        {orphanCites.length === 0 ? (
          <p style={{ ...muted, color: "rgb(var(--success))" }}>
            ✓ Every cited key resolves in references.bib.
          </p>
        ) : (
          <div>
            <p style={muted}>These keys are cited in notes but missing from references.bib:</p>
            <ul style={{ fontSize: "12px", margin: "4px 0 0 16px", padding: 0 }}>
              {orphanCites.map((k) => <li key={k}>{k}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
`;
