# Contributing to Ariadne

Thanks for considering a contribution. Ariadne is a small, single-maintainer
project; that's an asset, not an apology — it means feedback turns into shipped
code fast, and PRs get a real read.

## Quick start

1. Fork → branch off `main` → keep changes small + focused.
2. `npm install` at the repo root (npm workspaces — installs all packages).
3. `npm run typecheck && npm run eval:retrieval:ci` should pass.
4. Open a PR with a one-paragraph description: **what** changed, **why**,
   **how you tested**.
5. End every commit message with the DCO sign-off (see below).

## Developer Certificate of Origin (DCO)

By signing off, you certify the origin of your contribution under the terms of
the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
We use DCO instead of a CLA — no paperwork, no separate account, just a line
at the end of each commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Most git clients can append this automatically:

```bash
git commit -s -m "feat(workspace): your change"
```

If you forget on a commit and have already pushed, amend + force-push your
branch (`git commit --amend --signoff`). For older commits, an interactive
rebase with `--signoff` will fix the whole branch.

## What gets accepted, what doesn't

We say **yes** to:

- Bug fixes with a reproduction (failing test, screenshot, or repro steps).
- Documentation improvements — typos, clarifications, missing examples.
- New eval cases in `apps/server/src/eval/cases/` — these are how the project
  measurably improves over time.
- MCP server integrations, action templates, workspace starter packs.
- Localization fixes (Korean ↔ English).
- Accessibility improvements — keyboard, screen reader, focus management.

We say **maybe** to:

- New features outside the scope in [`docs/POSITIONING.md`](docs/POSITIONING.md).
  Open an issue first so we can talk through it before you build.
- Larger refactors. Same — talk first. Ariadne's surface is small enough that
  a refactor that's right in isolation can be wrong in the larger plan.

We say **no** (or "not yet") to:

- Telemetry, analytics, crash reporters. Local-first means local-only.
- Multi-tenant SaaS plumbing. See [`docs/POSITIONING.md`](docs/POSITIONING.md)
  §2.3 for why.
- Tight coupling to a single provider — the multi-provider abstraction in
  `apps/server/src/providers/` is load-bearing.

## Coding style

- TypeScript everywhere. No `any` without a comment explaining why.
- React + Vite on the web side, Fastify + node:sqlite on the server.
- Run `npm run typecheck` before you push. The harness is the CI gate.
- Comments explain *why*, not *what* — naming + code should answer *what*.
- Match the existing style in the file you're editing, even if you'd do it
  differently in a green-field project.

## Testing

- Retrieval: `npm run eval:retrieval` (no AI keys needed).
- Strategy comparison: `npm run eval:strategy -- --use-db` (needs Ollama).
- RAG end-to-end: `npm run eval:rag` (no keys) or `npm run eval:rag -- --live`
  (uses your active provider).
- Manual: `./ops/ariadne.sh start` → <http://localhost:4319>.

If you fix a bug that the eval harness didn't catch, **add a case** that would
have caught it. That's how the harness gets better over time.

## Reporting security issues

Do **not** open a public issue. Email <kwanho0096@gmail.com> with details and
we'll respond inside 72 hours. See [`SECURITY.md`](SECURITY.md) for scope.

## License

By contributing, you agree your contribution is licensed under the same GNU
Affero General Public License v3.0-or-later (AGPL-3.0) that covers the rest of
the repository.

---

Questions? Open an issue or a draft PR — both are fine.
