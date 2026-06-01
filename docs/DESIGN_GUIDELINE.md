# Ariadne DESIGN_GUIDELINE.md

## 0. Design Identity

Ariadne is a local-first AI workspace for traceable, repeatable work.

The interface must not feel like another chat app. It should feel like a quiet, precise, inspectable **run cockpit** for folder-based AI work.

Ariadne combines:

- the calm document structure of Notion;
- the dense and precise workbench feeling of t3code;
- the layered surface language of macOS;
- the command-first speed of Raycast;
- the auditability of a professional workflow tool.

Core design phrase:

> Quiet power. Every output has a trace.

---

## 1. Design Principles

### 1.1 Chat Is the Door, the Run Cockpit Is the Room

Chat is the **entry point** — where users land, ask, and start work. (v0.2:
real users got lost when dropped straight into the cockpit, so chat became
the home.) But chat is the *door*, not the room. The product — the thing of
lasting value — is the **run cockpit**: durable, inspectable records, not a
transcript. Every chat should lead *into* the cockpit, and the cockpit is
where the user should end up living.

The primary durable objects are:

- Workspace;
- Template;
- Context Pick;
- Run;
- Trace;
- Brief;
- Evidence Pack;
- Artifact.

Chat bubbles are fine at the door. But design the lasting surfaces around
durable records, not the transcript — never let the transcript become the
product.

Bad pattern:

```text
User: Summarize this folder.
AI: Sure, here is a summary...
```

Good pattern:

```text
Run #24
Template: Lecture Brief
Context: 5 files selected
Output: artifacts/lecture-brief.md
Evidence: 18 claims mapped
Unsupported: 3 claims
Status: Completed
```

### 1.2 Inspectability First

Every generated output should be inspectable.

The user should always be able to answer:

- What did Ariadne read?
- Why were these files selected?
- What did it ignore?
- What claims are supported?
- Which claims are weak?
- What changed from last run?
- Where is the output stored?

### 1.3 Calm Density

Ariadne should be information-dense, but not visually noisy.

Use:

- compact spacing;
- subtle borders;
- low-contrast surfaces;
- small labels;
- clear hierarchy;
- restrained accent colors.

Avoid:

- large marketing cards inside the product;
- playful AI mascots;
- colorful gradients everywhere;
- heavy glassmorphism;
- excessive shadows;
- chat-bubble dominance.

### 1.4 Local Materiality

The product should feel connected to the user's machine and files.

Use visual metaphors of:

- folders;
- traces;
- snapshots;
- records;
- threads;
- artifacts;
- inspectors;
- manifests.

### 1.5 Evidence Is a First-Class UI Object

Evidence should not be hidden in logs.

Evidence Map, Unsupported Claims, and Sources Used must be visible as first-class tabs or panels in the Run Detail view.

---

## 2. Visual Direction

### 2.1 References

Ariadne's visual direction should sit between:

- **t3code:** dense workbench, sidebar-driven, technical but clean;
- **Notion:** document-first calmness, editable surfaces, structured pages;
- **macOS:** layered surfaces, inspector panels, subtle blur/material only when useful;
- **Linear:** precise spacing, keyboard-first speed, subdued state colors;
- **Raycast:** command-first interactions and fast modal flows.

### 2.2 What to Avoid

Avoid looking like:

- generic ChatGPT clone;
- heavy IDE;
- full developer terminal tool;
- project management dashboard;
- no-code automation canvas;
- flashy SaaS admin panel.

Ariadne should look like a professional local workbench.

---

## 3. Layout System

### 3.1 Primary Layout

Use a four-zone structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ Top Bar                                                     │
├───────────────┬─────────────────────────────┬───────────────┤
│ Sidebar       │ Main Run Canvas             │ Inspector     │
│               │                             │               │
│ Workspaces    │ Brief / Trace / Evidence    │ Context       │
│ Templates     │ Artifact Preview            │ Metadata      │
│ Runs          │                             │ Token Cost    │
│ Artifacts     │                             │ Sources       │
├───────────────┴─────────────────────────────┴───────────────┤
│ Command Bar                                                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Left Sidebar

Purpose:

- navigate Workspaces;
- select Templates;
- open Runs;
- view Artifacts;
- access Sources.

Sidebar sections:

- Workspaces
- Templates
- Recent Runs
- Artifacts
- Sources
- Settings

Design:

- dark or muted surface;
- compact tree items;
- hover background subtle;
- active item with soft accent strip or pill;
- icons from lucide-react;
- collapsible groups;
- keyboard navigable.

### 3.3 Main Run Canvas

Purpose:

- show the current working object.

Main canvas modes:

1. Workspace Overview
2. Template Run View
3. Context Pick View
4. Run Detail View
5. Artifact Preview
6. Evidence Map
7. Re-run Diff

The Main Canvas should never feel like a chat transcript. It should feel like a structured work document.

### 3.4 Right Inspector

Purpose:

- show details about the currently selected object.

Inspector content depends on context:

Workspace:

- root path;
- file count;
- last scan;
- include/exclude patterns;
- sensitive file warnings.

Template:

- input schema;
- output contract;
- prompt preview;
- evidence requirements.

Context Pick:

- selected files;
- token estimate;
- file reasons;
- excluded large files;
- manual include/exclude.

Run:

- status;
- model;
- duration;
- selected files;
- artifacts;
- cost estimate;
- previous run.

Evidence:

- selected claim;
- support status;
- source excerpts;
- conservative rewrite.

### 3.5 Command Bar

The Command Bar is not a generic chat input.

It should be context-aware and action-oriented.

Examples:

- “Create a Lecture Brief template for this workspace”
- “Run this template for next week's lecture”
- “Make unsupported claims more conservative”
- “Compare this run with the previous one”
- “Include this source and regenerate”

Design:

- fixed bottom or floating bottom;
- compact text input;
- model/status chip optional;
- primary action button;
- slash commands;
- keyboard shortcut: Cmd+K or Cmd+Enter.

---

## 4. Core Screens

### 4.1 Workspace Overview

Goal:

Show that the folder is understood and ready for repeatable work.

Required elements:

- Workspace name;
- root path;
- file count;
- last snapshot time;
- supported file types count;
- ignored files count;
- sensitive files detected;
- recommended Templates;
- recent Runs.

Primary CTA:

- “Create Brief”
- “Run Template”

Secondary CTA:

- “Scan Again”
- “Edit Include/Exclude”
- “Export Workspace”

### 4.2 Template Run View

Goal:

Make running a repeatable work output feel simple.

Required elements:

- Template title;
- description;
- input form;
- output contract preview;
- evidence requirement toggle/label;
- run button;
- token estimate placeholder.

Do not expose raw YAML by default.

Advanced users can open:

- Template YAML;
- Prompt Markdown;
- Output Contract.

### 4.3 Context Pick View

Goal:

Show which files Ariadne wants to read before generation.

Required elements:

- selected files list;
- selection reason;
- estimated tokens per file;
- total token estimate;
- unsupported/large/sensitive warnings;
- include/exclude checkboxes;
- preview on hover/click;
- continue button.

This screen is essential to Ariadne's trust model.

### 4.4 Run Detail View

Goal:

Show the completed work output and its trace.

Tabs:

- Brief
- Evidence
- Unsupported
- Sources
- Diff
- Trace

Header:

- Run ID;
- Template;
- status;
- duration;
- selected files count;
- evidence count;
- unsupported count;
- output path.

### 4.5 Evidence Map View

Goal:

Make claim-source relationships easy to inspect.

Layout option:

```text
Claims List                Source Inspector
───────────────────        ─────────────────────────
[Supported] Claim A         File: readings/a.md
[Partial]   Claim B         Section: ...
[Inferred]  Claim C         Excerpt: ...
[Unsupported] Claim D       Rewrite suggestion: ...
```

Status visual language:

- supported: subtle green dot or badge;
- partially_supported: amber dot;
- inferred: blue or violet dot;
- unsupported: red dot.

Avoid large colored cards. Use restrained status indicators.

### 4.6 Unsupported Claims View

Goal:

Help users improve trust and precision.

Each unsupported claim card should include:

- original claim;
- reason;
- missing evidence;
- suggested source type;
- conservative rewrite;
- action buttons:
  - Accept rewrite;
  - Copy rewrite;
  - Mark as acceptable;
  - Add source and regenerate.

### 4.7 Re-run Diff View

Goal:

Make repeated execution valuable.

Sections:

- New files considered;
- Removed files;
- Modified files;
- New claims;
- Removed claims;
- Changed conclusions;
- Evidence strength changes;
- New unsupported claims;
- Resolved unsupported claims.

Use a timeline or grouped diff cards.

---

## 5. Component System

### 5.1 UI Primitive Strategy

Follow a t3code-like approach:

- build a small internal UI primitive layer;
- use Tailwind tokens;
- use headless components where appropriate;
- avoid large opinionated UI frameworks;
- keep variants explicit.

Core primitives:

- Button
- IconButton
- Input
- Textarea
- Select
- Checkbox
- Tabs
- Card
- Surface
- SidebarItem
- Badge
- Tooltip
- Dialog
- Sheet
- Toast
- CommandMenu
- FileRow
- RunCard
- EvidenceBadge
- TokenEstimate
- TraceTimeline

### 5.2 Button

Variants:

- primary
- secondary
- ghost
- outline
- destructive
- subtle

Sizes:

- xs
- sm
- md
- lg
- icon

States:

- hover;
- active;
- disabled;
- loading;
- focus-visible.

Primary buttons should be used sparingly.

Primary actions:

- Run Template
- Continue
- Generate Brief
- Export Workspace

### 5.3 Card / Surface

Cards should feel like subtle surfaces, not heavy containers.

Recommended style:

- rounded-xl or rounded-2xl;
- 1px border;
- low-contrast background;
- subtle shadow only on floating panels;
- hover border change for interactive cards.

### 5.4 Badges

Badge types:

- supported;
- partial;
- inferred;
- unsupported;
- running;
- completed;
- failed;
- read-only;
- sensitive;
- large-file;
- estimated.

Badges should be small and quiet.

### 5.5 Timeline / Trace

Trace Timeline items:

- Workspace scanned;
- Manifest created;
- Candidate files selected;
- User approved context;
- Brief generated;
- Claims extracted;
- Evidence mapped;
- Unsupported claims generated;
- Diff generated;
- Artifacts written.

Each timeline item should show:

- timestamp;
- status;
- short label;
- expandable details.

---

## 6. Design Tokens

### 6.1 Color Philosophy

Use mostly neutral colors.

Accent colors should communicate state, not decoration.

Base palette should support light and dark mode.

Recommended semantic tokens:

```css
--background
--foreground
--surface-1
--surface-2
--surface-3
--card
--card-foreground
--muted
--muted-foreground
--border
--border-strong
--ring
--accent
--accent-foreground
--success
--success-foreground
--warning
--warning-foreground
--destructive
--destructive-foreground
--info
--info-foreground
```

### 6.2 Dark Mode Direction

Dark mode should be the default development target.

Suggested feel:

- background: near black, but not pure black;
- surfaces: subtle elevation steps;
- borders: low alpha;
- text: high readability;
- muted text: not too dim;
- accent: restrained blue/violet or cyan.

### 6.3 Light Mode Direction

Light mode should feel like Notion/macOS.

Suggested feel:

- background: warm off-white or neutral light;
- surfaces: white or very subtle gray;
- borders: soft gray;
- shadows: minimal;
- accent: same semantic hue as dark mode.

### 6.4 Typography

Recommended fonts:

- UI Sans: Inter, Geist, or system San Francisco;
- Mono: SF Mono, JetBrains Mono, or Geist Mono;
- Markdown content: same UI sans or slightly more document-friendly sans.

Typography hierarchy:

- Page title: 20-24px;
- Section title: 14-16px semibold;
- Body: 13-15px;
- Metadata: 11-12px;
- Code/paths: 12-13px mono.

Use mono font for:

- file paths;
- run IDs;
- hashes;
- token estimates;
- YAML/JSON;
- command snippets.

### 6.5 Spacing

Use compact but breathable spacing.

Suggested scale:

- 4px micro gap;
- 8px compact spacing;
- 12px default component spacing;
- 16px section spacing;
- 24px page grouping;
- 32px major layout separation.

### 6.6 Radius

Recommended:

- small controls: 8px;
- cards: 12-16px;
- large panels: 16-20px;
- modals/sheets: 20-24px.

Do not overuse fully rounded pills except for small badges.

---

## 7. Interaction Design

### 7.1 Keyboard First

Important shortcuts:

- Cmd+K: command menu;
- Cmd+Enter: run current Template;
- Cmd+Shift+F: search files;
- Cmd+Shift+R: open recent Runs;
- Cmd+Shift+E: open Evidence Map;
- Esc: close panel/dialog;
- J/K or arrow keys: navigate lists.

### 7.2 Progressive Disclosure

Do not show all technical details at once.

Default user sees:

- Template;
- selected files;
- output;
- evidence status.

Advanced user can expand:

- prompt;
- YAML;
- manifest;
- raw evidence JSON;
- run trace;
- token estimate details.

### 7.3 Confirmation Points

Require user confirmation before:

- sending selected file contents to AI;
- including sensitive files;
- exporting workspace;
- deleting run history;
- regenerating and replacing artifact output.

### 7.4 Loading States

Each run should show phase-based progress:

1. Scanning workspace;
2. Creating manifest;
3. Selecting context;
4. Reading selected files;
5. Generating Brief;
6. Extracting claims;
7. Mapping evidence;
8. Creating diff;
9. Writing artifacts.

Avoid vague “AI is thinking...” states.

### 7.5 Empty States

Empty states should guide action.

Examples:

Workspace empty:

> Choose a local folder to create your first workspace.

No template:

> Start with a built-in template or ask Ariadne to generate one.

No runs:

> Run a template once to create your first traceable brief.

No evidence:

> Evidence mapping will appear after a completed run.

---

## 8. Content and Microcopy

### 8.1 Voice

Ariadne's voice should be:

- calm;
- precise;
- transparent;
- non-hype;
- action-oriented;
- slightly technical but understandable.

Avoid:

- “magic” language;
- overpromising;
- cute AI personality;
- exaggerated productivity claims.

### 8.2 Preferred Terms

Use:

- Workspace
- Template
- Context Pick
- Brief
- Evidence Pack
- Trace
- Artifact
- Source
- Unsupported Claim
- Re-run Diff

Avoid overusing:

- Chat
- Bot
- Agent
- Automation platform
- Workflow canvas

### 8.3 Status Copy

Good examples:

- “5 files selected for this run.”
- “Estimated 8.2k tokens will be sent.”
- “3 claims need stronger evidence.”
- “This conclusion changed since the previous run.”
- “This file was skipped because it exceeds the size limit.”
- “No original files will be modified.”

Bad examples:

- “Let me magically analyze everything.”
- “AI has fully understood your folder.”
- “This is definitely correct.”
- “No need to verify.”

---

## 9. Information Architecture

### 9.1 Sidebar IA

```text
Workspace Name
├─ Overview
├─ Templates
│  ├─ Research Brief
│  ├─ Lecture Brief
│  └─ Investment Memo
├─ Runs
│  ├─ Today
│  ├─ This Week
│  └─ Older
├─ Artifacts
├─ Sources
└─ Settings
```

### 9.2 Run Detail IA

```text
Run Header
├─ Brief
├─ Evidence
├─ Unsupported
├─ Sources
├─ Diff
└─ Trace
```

### 9.3 Template Settings IA

```text
Template Settings
├─ Basic Info
├─ Inputs
├─ Output Contract
├─ Source Selection Rules
├─ Evidence Rules
├─ Prompt
└─ Advanced YAML
```

---

## 10. Frontend Architecture Guidelines

### 10.1 Folder Structure

Suggested frontend structure:

```text
src/
  app/
    routes/
    providers/
  components/
    ui/
    layout/
    workspace/
    template/
    run/
    evidence/
    artifact/
    command/
  features/
    workspace/
    templates/
    runs/
    evidence/
    context-pick/
    artifacts/
  lib/
    api/
    stores/
    utils/
    tokens/
  styles/
    globals.css
    tokens.css
```

### 10.2 Component Rules

- UI primitives should not know business logic.
- Feature components can call hooks and APIs.
- Run state should be query-driven, not deeply prop-drilled.
- Use Zustand only for UI state and transient selections.
- Use TanStack Query for server state.
- Keep file paths and run IDs visually monospaced.

### 10.3 State Categories

Server state:

- Workspaces;
- Templates;
- Runs;
- Artifacts;
- Evidence;
- Snapshots.

Client UI state:

- selected sidebar item;
- open inspector panel;
- selected claim;
- selected source file;
- command menu open;
- temporary include/exclude selections.

---

## 11. Artifact Blocks

v0.1 should not support arbitrary custom React UI.

Instead, use controlled Artifact Blocks.

Supported v0.1 blocks:

- MarkdownBlock
- TableBlock
- KeyValueBlock
- ChecklistBlock
- EvidenceMapBlock
- UnsupportedClaimsBlock
- TraceTimelineBlock
- DiffBlock
- SourceListBlock

Future blocks:

- ChartBlock
- FileDiffBlock
- PDFPreviewBlock
- CustomSurfaceBlock

---

## 12. Accessibility

Minimum standards:

- all interactive elements keyboard accessible;
- visible focus states;
- sufficient color contrast;
- non-color indicators for evidence status;
- ARIA labels for icon buttons;
- resizable panels;
- reduced motion support;
- semantic headings in Brief preview;
- screen-reader-friendly status text.

Evidence status should not rely only on color.

Use labels:

- Supported
- Partial
- Inferred
- Unsupported

---

## 13. Motion and Feedback

Motion should be minimal and functional.

Use motion for:

- panel open/close;
- command menu;
- progress phase transition;
- subtle artifact appearance;
- selected claim highlight.

Avoid:

- bouncing animations;
- large page transitions;
- flashy AI loading effects;
- decorative particle effects.

Loading indicator should be phase-based, not mysterious.

---

## 14. Theming

Ariadne should support dark and light mode.

Default for MVP: dark mode.

Theme should be token-based.

Do not hardcode colors in components.

Example token use:

```tsx
<div className="bg-background text-foreground border-border" />
<Card className="bg-card text-card-foreground" />
<Badge variant="unsupported" />
```

---

## 15. MVP UI Priorities

Build in this order:

1. App shell with sidebar, main canvas, inspector.
2. Workspace creation and file list.
3. Template run form.
4. Context Pick screen with token estimate.
5. Run Detail with Brief tab.
6. Evidence Map tab.
7. Unsupported Claims tab.
8. Re-run Diff tab.
9. Trace Timeline tab.
10. Command Bar.

Do not build:

- custom dashboard system;
- drag-and-drop workflow canvas;
- marketplace UI;
- team collaboration UI;
- arbitrary plugin UI;
- terminal panel.

> Updated (v0.3, 2026-06-01): chat-first *home* stands, but see §1.1 — "Chat
> Is the Door, the Run Cockpit Is the Room." Chat is the entry point; the run
> cockpit is the product and the destination, never just a transcript.

---

## 16. Design QA Checklist

Before shipping a screen, check:

- Does this screen prioritize Run/Trace over Chat?
- Can the user see what files were used?
- Can the user inspect evidence?
- Is token cost or context size visible when relevant?
- Are unsupported claims visible?
- Can the user re-run or compare?
- Is the interface calm and dense, not noisy?
- Does the UI work without arbitrary custom UI plugins?
- Are advanced details available but not forced?
- Does the screen feel like Ariadne, not a generic AI chat app?

---

## 17. Final Design Statement

Ariadne's interface is a run cockpit for evidence-backed local work.

It should feel like opening a precise macOS-native workbench where every AI output is tied to files, claims, evidence, and a reproducible trace.

The user should not feel that they are chatting with a bot.

The user should feel that they are operating a reliable local system that turns messy folders into verifiable work artifacts.

