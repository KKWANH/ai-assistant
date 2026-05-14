# AI Workbench Studio UI Design Philosophy

AI Workbench Studio (AIWS) is a local-first AI workspace, not a generic SaaS dashboard or chatbot clone. The UI should feel calm, precise, and trustworthy: a dark developer workbench where projects, context, files, actions, runs, artifacts, and diagnostics are always visible.

## Direction

- **Primary mood:** modern dark workspace with blue graphite accents.
- **Avoid:** brown-heavy leather, retro decoration, generic gray cards, marketing hero pages.
- **Keep:** local-first clarity, visible project/session hierarchy, transparent context, developer metadata.
- **Feel:** ChatGPT Projects plus Claude context transparency, with a right-side workbench for files and prompt context.

## Palette

```css
:root {
  --bg: #050812;
  --bg-soft: #09111f;
  --surface: rgba(13, 22, 38, .84);
  --surface-solid: #0d1626;
  --surface-raised: #111f35;
  --border: rgba(120, 166, 230, .18);
  --border-strong: rgba(92, 154, 255, .64);
  --text: #f3f7ff;
  --muted: #9aabc6;
  --faint: #65758d;
  --blue: #4f8cff;
  --blue-deep: #2569e8;
  --cyan: #63d7ff;
  --green: #5ee2a0;
  --amber: #f0c674;
  --danger: #ff6978;
  --shadow-low: 0 8px 22px rgba(0, 0, 0, .24);
  --shadow-mid: 0 18px 54px rgba(0, 0, 0, .34);
  --shadow-high: 0 30px 90px rgba(0, 0, 0, .48);
}
```

## Materials

- **Graphite shell:** the global workspace background, app chrome, and deep panels.
- **Blue glass:** selected project/session state, workbench panels, active controls.
- **Paper-lite cards:** message bodies should be readable, but stay dark and modern.
- **Metal controls:** attach/send/model/search controls should feel tactile through subtle shadows and pressed states.

## Layout

Desktop uses three regions:

1. **Left project rail:** workspace actions, project tree, session list, search.
2. **Center chat:** breadcrumb, context chips, messages, sticky composer.
3. **Right workbench:** context, files, prompt, dev metadata.

Mobile collapses into a single-column app with rail/workbench drawers.

## Attachment Semantics

Selected files belong only to the current composer submission.

- A selected file appears in the composer preview.
- The user can remove it before sending.
- On submit, React snapshots the file into `FormData`, immediately clears the input state, then sends.
- The saved attachment is rendered only on the message that created it.
- It must never remain selected for the next message.

## Interaction Principles

- Send never redirects the page.
- Sending locks the composer once.
- The user message appears optimistically.
- The assistant bubble shows a small animated loading state.
- Errors appear in the conversation as system messages.
- Images open in an in-app lightbox, not a new tab.
