# Budget tracker

An **example project** built on the Ariadne platform — not a core feature.

A personal budget as a workspace: one `budget.csv` of income/expense rows, and
a custom screen (`template.ts` → `SURFACE_TSX`) that reads it into a cashflow +
savings-rate dashboard.

- `template.ts` — the seed file(s) + the custom screen source.
- `server.ts` — registers it as a create-flow starter (category `finance`).
- `web.ts` — the card shown in the New Workspace dialog.

Core scaffolds this when you pick "Budget tracker" at workspace creation; it
uses only general platform capabilities (surfaces, file reads, charts).
