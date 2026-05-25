<!-- One-paragraph PR description per CONTRIBUTING.md: what, why, how tested. -->

## What
<!-- One sentence. -->

## Why
<!-- The user-visible / dev-visible problem this solves. Link any related issue with "Fixes #N" or "Closes #N". -->

## How tested
<!-- Specific commands / steps. "npm run typecheck" alone isn't enough for non-trivial changes. -->

- [ ] `npm run typecheck` passes
- [ ] `npm run eval:retrieval:ci` passes (only if retrieval-touching)
- [ ] Manual smoke against `./ops/ariadne.sh start` (if user-visible)

## DCO sign-off
<!-- CONTRIBUTING.md requires a Signed-off-by line on each commit. -->

- [ ] Each commit has `Signed-off-by: …` (use `git commit -s`)
