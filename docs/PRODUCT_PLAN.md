# Ariadne PRODUCT_PLAN.md

## 0. Product Identity

**Product name:** Ariadne  
**Concept line:** Local-first AI workspace for traceable, repeatable work.  
**Core metaphor:** Ariadne's thread. A path through messy local folders, fragmented files, repeated decisions, and AI-generated outputs.

Ariadne is not another chat assistant, coding agent, or workflow automation platform.

Ariadne turns local folders into **source-backed, repeatable AI work briefs**. It helps users create work outputs that are not only generated, but also traceable, inspectable, and re-runnable.

The core loop is:

**Workspace → Template → Context Pick → Brief → Evidence Pack → Trace → Re-run Diff**

The product must avoid becoming a generic AI agent. The first version should prove one sharp value:

> Users want AI-generated work outputs that are tied to local files, supported by evidence, and repeatable over time.

---

## 1. Why Ariadne Exists

Most AI tools can now read files, run code, modify repositories, and operate in loops. These capabilities are no longer sufficient differentiation.

The real unresolved problem is not simply:

> Can AI do the work?

The harder and more valuable problem is:

> Can users trust, inspect, reproduce, and refine the AI-generated work?

Ariadne exists because many knowledge workers already use AI, but still face the same recurring problems:

- They repeatedly re-explain the same folder context to ChatGPT or Claude.
- AI outputs often mix evidence-backed statements with unsupported assumptions.
- Generated reports are hard to verify.
- There is no stable trace of what files were used.
- Re-running the same task next week or next month is awkward.
- Outputs are not packaged as durable work artifacts.
- Sharing or moving an automation setup across machines is difficult.

Ariadne focuses on **proof, repeatability, and local context discipline**.

---

## 2. Market Positioning

### 2.1 What Ariadne Is Not

Ariadne is not:

- a coding agent like Codex, Claude Code, Cursor, Windsurf, or OpenCode;
- a general-purpose chat app;
- a Zapier/n8n-style workflow automation tool;
- a document Q&A product only;
- a full RAG platform;
- a no-code app builder;
- a desktop shell runner;
- a team collaboration suite in v0.1.

### 2.2 What Ariadne Is

Ariadne is a **proof layer for AI-generated work**.

It creates structured outputs from local folders and attaches the following:

- source files used;
- claim-to-source mapping;
- unsupported claims;
- folder snapshot;
- run trace;
- diff from previous run;
- portable workspace files.

### 2.3 Positioning Statement

**English:**

> Ariadne turns messy local folders into source-backed, repeatable work briefs.

Alternative:

> Not another agent. A proof layer for AI-generated work.

**Korean:**

> Ariadne는 흩어진 로컬 폴더를 근거가 연결된 반복 업무 산출물로 바꾸는 도구다.

Alternative:

> AI가 만든 결과물을 다시 믿을 수 있게 만드는 로컬 우선 작업공간.

---

## 3. Core Differentiation

### 3.1 Agent Capability Is Not the Differentiator

Many tools can already:

- read local files;
- edit files;
- run commands;
- loop through tasks;
- connect to remote environments;
- use multiple models;
- call tools;
- automate workflows.

Ariadne should not compete primarily on these features.

### 3.2 Ariadne's Differentiation

Ariadne differentiates through five pillars:

1. **Evidence-first output**  
   Every important claim should be tied to source files or marked as weak/unsupported.

2. **Run trace by default**  
   Every run leaves behind a durable trace of selected context, input, model call, output, and artifacts.

3. **Re-run diff**  
   A repeated task should show what changed since the previous run.

4. **Token-saving context discipline**  
   Ariadne does not blindly dump entire folders into the model. It uses a staged Gasp Filter before focused reading.

5. **Portable workspace**  
   The `.ariadne` workspace folder should be copyable, inspectable, versionable, and restorable.

---

## 4. Initial Target Users

Ariadne v0.1 targets **Technical Power Users**, not full mainstream users.

These users:

- manage work through local folders;
- understand files, folders, Markdown, CSV, and simple structured data;
- already use ChatGPT/Claude but feel friction from repeated context setup;
- care about source grounding and verifiability;
- repeatedly produce briefs, reports, lecture notes, research summaries, decision memos, or review documents;
- are comfortable editing prompts, but should not be forced to write YAML manually.

### 4.1 Primary User Segments

- researchers;
- professors and lecturers;
- consultants;
- investment-oriented personal users;
- job seekers managing applications through local folders;
- analysts and report-heavy professionals;
- technically capable writers;
- developers who want non-code folder workflows.

### 4.2 Users to Avoid in v0.1

Do not optimize v0.1 for:

- fully non-technical users;
- large teams;
- enterprise admins;
- marketplace sellers;
- developers who only want coding agents;
- users who primarily need API workflow automation;
- users who need full cloud collaboration.

---

## 5. Core Product Loop

The primary user flow must be simple:

1. User creates a Workspace from a local folder.
2. Ariadne scans the folder and creates a Folder Snapshot.
3. User chooses a Template.
4. Ariadne runs the Gasp Filter to select relevant files.
5. User reviews or accepts selected context files.
6. Ariadne generates a Brief.
7. Ariadne extracts key claims.
8. Ariadne maps claims to sources.
9. Ariadne separates unsupported claims.
10. Ariadne stores the Evidence Pack and Run Trace.
11. User re-runs the same Template later.
12. Ariadne shows Re-run Diff.

The product should make this loop feel faster and more reliable than manually uploading files to ChatGPT.

---

## 6. Core Concepts

### 6.1 Workspace

A Workspace is a local folder registered in Ariadne.

Example:

```text
~/Documents/investment
~/Documents/lecture-2026
~/Documents/job-search
~/Documents/research-paper
```

A Workspace contains a `.ariadne` folder.

Example:

```text
.ariadne/
  workspace.yaml
  templates/
  prompts/
  runs/
  artifacts/
  evidence/
  snapshots/
  indexes/
  exports/
```

### 6.2 Template

A Template defines the structure and rules of a repeatable work output.

Templates are not exposed as raw YAML first. Users interact through a form-based editor called **Template Settings**.

Built-in v0.1 Templates:

- Research Brief
- Lecture Brief
- Investment Decision Memo
- Job Search Review
- Source Audit

### 6.3 Brief

A Brief is the main generated artifact.

It is usually Markdown in v0.1.

Standard sections:

- Summary
- Key Findings
- Evidence-backed Claims
- Risks / Uncertainties
- Unsupported Claims
- Missing Information
- Next Actions
- Sources Used

### 6.4 Evidence Pack

An Evidence Pack is the proof bundle behind the Brief.

It includes:

- `evidence.json`
- `sources.md`
- `unsupported-claims.md`
- `folder-snapshot.json`
- `selected-context.json`
- `run-summary.md`
- `diff-from-last-run.md`

### 6.5 Trace

A Trace is the run history of a generated output.

A Trace should show:

- when the run happened;
- which template was used;
- what input was provided;
- what files were candidates;
- what files were selected;
- what files were sent to the model;
- what artifacts were created;
- what changed compared to the previous run.

### 6.6 Context Pick

Context Pick is the user-visible result of the Gasp Filter.

It shows:

- selected files;
- why each file was selected;
- excluded files;
- token estimate;
- warning for large files;
- option to manually include/exclude files.

---

## 7. Token-Saving Gasp Filter

### 7.1 Problem

Local folders can contain tens or hundreds of thousands of tokens even when limited to Markdown, TXT, CSV, JSON, and YAML.

Blindly combining entire folder contents into a prompt will cause:

- context window overload;
- high API cost;
- lost-in-the-middle effects;
- slow execution;
- unreliable outputs;
- poor user trust.

Therefore v0.1 must include a token-saving file selection layer from the beginning.

### 7.2 Gasp Filter Definition

The Gasp Filter is a lightweight, non-vector, staged context selection system.

It is a v0.1 alternative to full RAG.

The Gasp Filter does not try to understand everything. It tries to avoid sending unnecessary content.

### 7.3 Gasp Filter Pipeline

#### Step 1: Metadata Scan

Collect cheap metadata without reading entire files:

- file path;
- filename;
- extension;
- size;
- modified time;
- hash;
- first 3 lines;
- Markdown headings;
- CSV headers;
- CSV row count;
- JSON top-level keys;
- YAML top-level keys;
- rough token estimate;
- detected sensitivity flags.

#### Step 2: Manifest Creation

Create `manifest.json` from metadata.

Example:

```json
{
  "files": [
    {
      "path": "notes/site-specificity.md",
      "extension": "md",
      "size": 18422,
      "headings": ["Miwon Kwon", "Discursive Site", "Mobility"],
      "first_lines": ["This note summarizes..."],
      "estimated_tokens": 4100
    }
  ]
}
```

#### Step 3: Candidate Selection

Send only the manifest to the LLM.

Ask the model to select a small set of candidate files for the current Template and input.

Default limits:

- small workspace: maximum 8 files;
- medium workspace: maximum 5 files;
- large workspace: maximum 3 files;
- manual override available.

#### Step 4: Focused Read

Read selected files with format-specific strategies.

Markdown:

- read selected headings/sections;
- include table of contents;
- include intro and conclusion if present.

TXT:

- read first part, last part, and keyword-adjacent slices.

CSV:

- read headers;
- row count;
- sample rows;
- numeric summaries;
- selected columns only when possible.

JSON/YAML:

- read top-level structure first;
- read selected keys only;
- collapse deeply nested fields.

#### Step 5: User Review

Before generation, show:

- selected files;
- estimated tokens;
- selection reason;
- skipped large files;
- sensitive file warnings.

The user can manually include or exclude files.

---

## 8. Evidence System

### 8.1 Claim Extraction

After generating the Brief, Ariadne extracts important claims.

Claims include:

- interpretive statements;
- comparative judgments;
- risk statements;
- recommendations;
- factual summaries;
- conclusions;
- next-action justifications.

### 8.2 Evidence Mapping

Each claim receives a support status:

- `supported`
- `partially_supported`
- `inferred`
- `unsupported`

Example:

```json
{
  "claim": "Site-specificity shifted from fixed physical place to discursive and institutional context.",
  "status": "supported",
  "sources": [
    {
      "path": "readings/miwon-kwon-summary.md",
      "locator": "section: One Place After Another",
      "excerpt": "..."
    }
  ]
}
```

### 8.3 Unsupported Claims

Unsupported claims are not hidden. They become a separate artifact.

`unsupported-claims.md` includes:

- claim;
- reason;
- missing evidence;
- suggested source type;
- conservative rewrite suggestion.

Example:

```markdown
## Unsupported Claim

**Claim:** This artist is one of the most important participatory artists in Korean contemporary art.

**Reason:** The selected folder contains notes about the artist's participatory methods, but no source establishing art-historical ranking or broad field recognition.

**Suggested rewrite:** This artist has consistently explored participatory structures within contemporary art practice.
```

### 8.4 Conservative Rewrite

Ariadne should help users lower unsupported language.

Examples:

- “the most important” → “a significant”
- “proves” → “suggests”
- “clearly shows” → “indicates”
- “caused by” → “may be related to”

This feature is essential for academic, investment, legal-adjacent, and professional documents.

---

## 9. Re-run Diff

### 9.1 Purpose

The product's long-term value depends on repeated use.

Ariadne must make repeated runs useful.

### 9.2 Diff Types

Re-run Diff should show:

- newly added files;
- removed files;
- modified files;
- newly selected context;
- dropped context;
- new claims;
- removed claims;
- changed conclusions;
- stronger evidence;
- weaker evidence;
- new unsupported claims;
- resolved unsupported claims.

### 9.3 Output

`diff-from-last-run.md` example:

```markdown
# Diff from Previous Run

## New Files Considered
- notes/kwon-discursive-site.md
- lecture/week-08-outline.md

## Changed Conclusions
- The previous run emphasized physical site. This run shifts emphasis toward discursive and institutional context.

## Evidence Strength Changes
- Claim about Miwon Kwon's argument changed from partially_supported to supported due to new source file.

## New Unsupported Claims
- Claim about “dominant paradigm after 1990” lacks direct source support.
```

---

## 10. Portability and Reproducibility

### 10.1 Principle

Ariadne workspaces should be file-based and portable.

The `.ariadne` folder should be:

- inspectable;
- copyable;
- versionable;
- exportable;
- restorable;
- mostly human-readable.

### 10.2 Why It Matters

Portability is not a minor feature. It is part of Ariadne's market differentiation.

A user should be able to:

- compress `.ariadne` and move it to another machine;
- store it in Git;
- share a Template with another user;
- reproduce previous runs if the same source folder exists;
- inspect outputs without Ariadne lock-in.

### 10.3 Export Format

Ariadne should support exporting:

```text
ariadne-export.zip
  workspace.yaml
  templates/
  prompts/
  runs/
  artifacts/
  evidence/
  snapshots/
  README.md
```

---

## 11. MCP-Compatible Tool Layer

### 11.1 Strategy

Ariadne v0.1 should not build a large plugin ecosystem.

However, it should design its internal tool layer to be compatible with MCP-style concepts.

This enables future expansion without redesigning the backend.

### 11.2 Internal Tool Interface

Initial tools:

```text
filesystem.list
filesystem.read_metadata
filesystem.read_manifest
filesystem.read_text
filesystem.read_slice
filesystem.write_artifact
filesystem.write_evidence
filesystem.create_snapshot
filesystem.estimate_tokens
```

### 11.3 Future MCP Integration

Future tool servers may include:

- filesystem;
- git;
- fetch;
- database;
- notes;
- browser;
- enterprise document stores.

v0.1 goal:

> Build an MCP-compatible abstraction, not a full MCP marketplace.

---

## 12. Security and Permission Model

Ariadne v0.1 uses a conservative permission model.

Rules:

1. No original file modification.
2. No shell execution.
3. No delete, move, or overwrite.
4. Write only inside `.ariadne/artifacts`, `.ariadne/evidence`, `.ariadne/runs`, and `.ariadne/snapshots`.
5. AI API calls are the only allowed network use.
6. Show files that will be sent to the model.
7. Show token estimate before execution.
8. Exclude sensitive patterns by default.
9. Require explicit user action for manually including sensitive files.

Default sensitive patterns:

```text
*.env
*secret*
*password*
credentials.*
private_key.*
id_rsa
.ssh/**
bank/**
tax/**
passport/**
visa/**
```

---

## 13. v0.1 Technical Scope

### 13.1 Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui or internal UI primitives
- TanStack Query
- Zustand
- CodeMirror

### 13.2 Backend

- Node.js
- TypeScript
- Fastify
- SQLite
- Drizzle ORM
- chokidar
- zod
- csv-parse
- gray-matter
- unified/remark

### 13.3 Search / Index

v0.1:

- file metadata table;
- path search;
- filename search;
- SQLite FTS5;
- heading index;
- manifest search.

Not in v0.1:

- vector DB;
- reranker;
- semantic chunking;
- full document parser for PDF/DOCX/PPTX.

### 13.4 AI Provider

v0.1 supports one provider first.

Recommended:

- OpenAI API or Anthropic API.

Architecture should define a thin provider interface, but not expose multi-model routing in the UI.

AI task types:

- Template generation;
- file candidate selection;
- Brief generation;
- claim extraction;
- evidence mapping;
- unsupported claim detection;
- conservative rewrite;
- re-run diff summarization.

---

## 14. Data Structure

### 14.1 Workspace

```yaml
id: lecture-2026
name: Lecture 2026
root_path: /Users/user/Documents/lecture-2026
created_at: 2026-05-20T10:00:00Z
include:
  - "**/*.md"
  - "**/*.txt"
  - "**/*.csv"
  - "**/*.json"
  - "**/*.yaml"
exclude:
  - ".git/**"
  - "node_modules/**"
  - ".ariadne/**"
  - "*.env"
```

### 14.2 Template

```yaml
id: lecture-brief
name: Lecture Brief
description: Generate a source-backed lecture preparation brief.
inputs:
  topic:
    type: string
    required: true
  duration:
    type: string
    required: false
    default: 90 minutes
  audience:
    type: string
    required: false
output_contract:
  sections:
    - summary
    - learning_objectives
    - key_concepts
    - lecture_flow
    - evidence_backed_claims
    - unsupported_claims
    - missing_information
    - next_actions
evidence_required: true
unsupported_claims_required: true
rerun_diff_required: true
```

### 14.3 Run

```yaml
id: 2026-05-20-001
template_id: lecture-brief
status: completed
started_at: 2026-05-20T10:00:00Z
completed_at: 2026-05-20T10:02:12Z
input:
  topic: "New media sculpture and site-specificity"
  duration: "90 minutes"
manifest: snapshots/2026-05-20-001-manifest.json
candidate_files:
  - notes/site-specificity.md
  - readings/miwon-kwon-summary.md
selected_files:
  - readings/miwon-kwon-summary.md
  - lecture/week-05.md
artifacts:
  brief: artifacts/2026-05-20-lecture-brief.md
  evidence: evidence/2026-05-20-evidence.json
  unsupported: artifacts/2026-05-20-unsupported-claims.md
  diff: artifacts/2026-05-20-diff-from-last-run.md
```

---

## 15. MVP Development Plan

### Week 1: Workspace and Snapshot

Goals:

- create local workspace;
- create `.ariadne` folder;
- scan files;
- generate folder snapshot;
- display file list.

Deliverables:

- workspace creation UI;
- `workspace.yaml`;
- `snapshot.json`;
- basic file browser.

### Week 2: Gasp Filter v1

Goals:

- extract metadata;
- create manifest;
- estimate tokens;
- detect sensitive files;
- expose candidate selection UI.

Deliverables:

- `manifest.json`;
- Gasp Filter service;
- context pick UI;
- token estimate panel.

### Week 3: Template-first Flow

Goals:

- implement built-in templates;
- generate input forms from template schema;
- connect prompt files;
- add Template Settings UI.

Deliverables:

- Research Brief template;
- Lecture Brief template;
- Investment Memo template;
- form-based run screen.

### Week 4: Candidate Selection and Brief Generation

Goals:

- LLM-based candidate selection from manifest;
- user approval of selected context;
- focused file reading;
- Brief generation.

Deliverables:

- selected context view;
- generated `brief.md`;
- artifact preview.

### Week 5: Evidence Map

Goals:

- extract claims from Brief;
- map claims to sources;
- assign support status;
- display evidence map.

Deliverables:

- `evidence.json`;
- Evidence Map UI;
- source inspector.

### Week 6: Unsupported Claims and Rewrite

Goals:

- generate unsupported claim report;
- provide conservative rewrites;
- suggest missing evidence.

Deliverables:

- `unsupported-claims.md`;
- rewrite suggestion panel;
- missing evidence list.

### Week 7: Re-run Diff and Portability

Goals:

- compare current run with previous run;
- show file/context/claim changes;
- export `.ariadne` workspace.

Deliverables:

- `diff-from-last-run.md`;
- Run comparison UI;
- workspace export zip.

### Week 8: Dogfooding and Polish

Goals:

- test on real lecture, investment, and job-search folders;
- improve UX;
- refine error messages;
- prepare demo workspace.

Deliverables:

- sample workspaces;
- README;
- demo video script;
- Go/No-Go report.

---

## 16. Success Metrics

v0.1 succeeds if:

1. Users re-run the same Template at least 3 times.
2. Users inspect the Evidence Map.
3. Users act on Unsupported Claims.
4. Users use the generated Brief in real work.
5. Users compare runs over time.
6. Users preserve or export `.ariadne` workspaces.
7. Users feel it is better than manually pasting files into ChatGPT.

---

## 17. No-Go Criteria

Stop or pivot if:

1. Users treat Ariadne as a normal chat app.
2. Users do not re-run Templates.
3. Evidence Map is ignored.
4. Unsupported Claims are not trusted.
5. Gasp Filter misses important files too often.
6. Generated Briefs are indistinguishable from generic ChatGPT outputs.
7. Token cost remains too high.
8. The product feels harder than manual AI use.
9. Users do not care about portability.

---

## 18. v0.2 Roadmap

Only after v0.1 validation:

1. PDF/DOCX/PPTX parsing;
2. vector search;
3. simple chart artifacts;
4. Git-backed workspace history;
5. diff-approved original file write;
6. scheduler;
7. second AI provider;
8. desktop wrapper;
9. external MCP server integration;
10. review/share mode.

---

## 19. v0.3+ Roadmap

Long-term candidates:

- custom dashboard surfaces;
- local model support;
- remote execute mode;
- team workspace;
- template marketplace;
- advanced plugin system;
- browser fetch;
- database connectors;
- enterprise evidence audit.

---

## 20. Product Philosophy

Ariadne is not an agent.

Ariadne is a compiler for evidence-backed work.

Input:

- messy local folder;
- selected Template;
- user goal.

Processing:

- metadata scan;
- Gasp Filter;
- focused reading;
- Brief generation;
- claim extraction;
- evidence mapping;
- unsupported claim detection;
- re-run diff.

Output:

- source-backed Brief;
- Evidence Pack;
- Trace;
- portable workspace.

The product must stay disciplined:

> Do not chase agent features before proving evidence-backed repeatable work.

