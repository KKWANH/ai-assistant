# AIWS Agent Operating Rules

You are working on AI Workbench Studio, a local-first AI workbench for trusted personal/team use.
This is NOT a generic chatbot skin and NOT a public multi-tenant SaaS.
Optimize for clarity, inspectability, extensibility, and honest UI state.

## Product truth

AIWS has only two real product surfaces:

1. Chat
   - exploratory conversation
   - one-off file understanding
   - lightweight tool use inside the composer

2. Project App
   - repeatable task flow
   - structured inputs
   - runs + artifacts + viewers
   - optional scoped debug chat

Do not introduce or preserve a third ambiguous surface called "Action" unless it is explicitly defined as one of the two above.

## Non-negotiable behavior

If the request is about confusion in menu, IA, action meaning, workflow meaning, project meaning, or tool meaning,
you MUST make structural changes.
Do not solve a structural problem with copy edits, spacing tweaks, or tiny cosmetic patches.

A change is incomplete if you only:
- rename labels
- move buttons by a few pixels
- adjust colors
- add explanatory text without changing information architecture
- add a new card but keep the same broken concept underneath

## Structural-change trigger

When any of the following is true, you must modify the main product surface, not only leaf components:

- the user says the menu is confusing
- the user says Action / Project / Chat boundaries are unclear
- the user says a feature "still just ends up as chat"
- the user asks for stronger customization / workflow / viewer behavior
- the user says the app feels like neither a chat tool nor a workbench

In those cases, you must inspect and change as needed:

- route structure
- left navigation
- dashboard structure
- app/view manifest contracts
- backend API contracts
- viewer/runtime contracts
- tests and docs for the changed behavior

## Required implementation mindset

Prefer high-leverage edits over timid edits.

If the problem lives in:
- the home launcher -> change the home launcher
- the project dashboard -> change the dashboard
- the route model -> change route model
- app contracts -> change contracts
- data flow -> change data flow

Do not keep the old shape simply to minimize diff size.
Minimize unnecessary churn, but do not preserve broken concepts.

## Internal-use bias

Because AIWS is for trusted local/internal use:
- prioritize hackability and owner productivity
- allow opinionated workflows
- favor file-based customization
- prefer explicit local extension points over fake universal abstractions

But still keep:
- path confinement
- local/cloud transparency
- explicit approval for dangerous execution
- deny-by-default project links
- no secret leakage into UI payloads

## Viewer customization rule

Do NOT implement arbitrary runtime eval or project-provided JS execution inside the main app shell.

If custom viewers are required, implement them as:
- trusted workspace-installed viewer packages
- local filesystem only
- startup/discrete reload compilation
- explicit manifest registration
- backend API bridge
- preferably sandboxed rendering boundary
- typed viewer payload contract
- tests for invalid viewer ids / payload failures

Do not fake “custom viewer support” by just adding new static cards.
Do not fake it by rendering markdown and calling it a viewer.

## Chat vs Project App rule

One-off tools belong inside Chat.
Repeatable workflows belong inside Project Apps.

If a feature:
- has structured inputs
- has named artifacts
- has a dedicated layout/viewer
- has repeat execution value
- benefits from run history

then it must be implemented as a Project App, not as a chat shortcut.

## Debug chat rule

Every Project App may include a scoped debug chat.
This chat is for:
- explaining artifacts
- debugging failures
- partial follow-up edits
- asking about one run/resource

This debug chat must not erase the app concept.
It supports the app; it does not replace the app.

## Project-link rule

For cross-project reuse, prefer explicit project links and resource imports.
Do not make every project see every other project automatically.
Do not solve reusable data flow with hidden global state.

## TypeScript migration rule

This repo is moving to TypeScript.
When editing runtime-critical frontend paths:

- prefer `.ts` / `.tsx`
- add proper types
- remove broad `any` shapes when reasonable
- use typed client helpers instead of pushing generic `fetchJson` everywhere
- do not add new `.jsx` files to primary runtime paths

## Delivery format for substantial tasks

Before coding, write a short plan with:

- what concept is broken
- what product surface must change
- which files must be edited
- which files/components/contracts should be removed, merged, or renamed
- what tests must change

After coding, report:

- structural changes made
- old concept removed or preserved
- routes/components/contracts affected
- tests added/updated
- what remains intentionally deferred

## Minimum bar for acceptance

A change is acceptable only if:
- the requested behavior is visible in the main UI
- the core concept is clearer than before
- empty states are honest
- misleading states are removed
- docs are updated if contracts changed
- tests cover the new behavior

If the request is structural, and your patch is only cosmetic, your patch is wrong.
