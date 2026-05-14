# AI Workbench Studio Branding And Architecture Plan

## 1. Current UI Structure

The React app is currently centered in `web/src/main.jsx` with supporting project/action components:

- `TopBar` renders the product brand, runtime status, mode, and context drawer toggle.
- `Sidebar` renders Home, New Chat, Projects, general chats, and automation shortcuts.
- `CenterPane` switches between Home, Project Workbench, Chat, and Action Library.
- `ContextPanel` is the right inspector drawer for files, context, memory, goal, and debug tools.
- `ProjectDashboard.jsx` renders project overview, action status, runs, artifacts, and the architecture diagram.
- `ActionPanels.jsx` renders project actions from `aiws.yaml` and action previews/results.

The UI has a working dark workbench shell, but visible copy still mixes "Assistant", Korean personal-assistant language, and workbench concepts.

## 2. Current Backend API Structure

`src/aiws/ui.py` is the main HTTP handler and currently owns many route responsibilities:

- session/chat APIs
- project APIs
- home/starter action APIs
- project action run/artifact APIs
- goal/profile APIs
- runtime/openclaw/automation APIs
- admin HTML page

This works for the MVP, but route/service boundaries should eventually split into modules for chat, projects, actions, diagnostics, and files.

## 3. Current Action/Recipe System

`src/aiws/core/action_registry.py` already supports the core configurable-workbench idea:

- `aiws.yaml` parsing
- `views`, `panels`, `commands`
- command kinds such as `prompt_recipe`, `shell`, `python`, `file_index`, `codex_prompt`, and `openclaw_status`
- permissions and blocked secret-path checks
- run storage, run detail, artifact preview, and project context summaries

`src/aiws/core/home_workbench.py` provides projectless starter actions with runs, artifacts, and planner-style steps, but this is separate from project actions. A future pass should unify Home Actions and Project Actions under one Action/Run/Artifact service.

## 4. Current Diagnostics/Admin System

`src/aiws/admin_monitor.py` provides a local-only diagnostics dashboard on `127.0.0.1` with:

- runtime status
- model usage and failures
- log tails
- structured analysis form

The main app also has debug/runtime cards in `ContextPanel`. Public-facing copy should call this area "Diagnostics" rather than "Admin Analyzer", and it should warn when a Cloudflare public tunnel is active.

## 5. Missing Parts For Agent Plan

The current `src/aiws/core/chat_orchestrator.py` creates a conservative plan preview for general chat:

- requirements analysis
- optional file read
- optional web search as planned/approval-gated
- optional containerized code as planned/approval-gated
- synthesis and final response

Missing pieces:

- persistent `AgentPlan`, `AgentStep`, and `RunEvent` records for chat-driven agent runs
- approval gate UI for file-write, shell, Python, and network steps
- live step event streaming
- artifact creation from chat agent runs
- model-policy/cost budget enforcement across multi-call workflows

## 6. Proposed Implementation Order

1. Rebrand visible product identity to **AI Workbench Studio (AIWS)**.
2. Move high-level UI copy into `web/src/copy.js`.
3. Normalize App Shell / Left Rail / Main Workbench / Right Inspector labels.
4. Surface `aiws.yaml` as the configurable manifest layer in README and UI.
5. Upgrade the Right Inspector tabs to Context, Files, Memory, Runs, Artifacts, Diagnostics.
6. Add persistent Agent Plan / Step / Event models and connect them to chat runs.
7. Unify Home and Project action runs behind a shared Action/Run/Artifact service.
8. Integrate local admin monitor as Diagnostics while preserving local-only access.
