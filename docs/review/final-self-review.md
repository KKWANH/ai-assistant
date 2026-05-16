# Productization Self-Review

## Completed In This Pass

- Reframed README and docs around folder-native workspaces, context receipts, runs, and artifacts.
- Added example workspaces for document review, table analysis, and Codex briefs.
- Added install/start/dev/lint/test/build/doctor scripts for open-source onboarding.
- Hardened runtime payloads so public views do not include local paths, localhost URLs, process IDs, admin commands, or diagnostics.
- Added a stable `scripts/doctor.sh` entrypoint and a default Ollama model check.
- Added run-record fields used by the UI and acceptance criteria: `workspace_id`, `session_id`, `action_label`, nested `model`, `context_receipt`, and `steps`.
- Split the context receipt renderer out of `main.jsx` and fixed the Right Inspector diagnostics visibility check.

## Verification Targets

- Python lint: `python -m ruff check src tests`
- Backend tests: `python -m pytest -q`
- Frontend build: `npm run build`
- Shell syntax: `bash -n scripts/*.sh`

## Remaining Risks

- `web/src/main.jsx` still contains large UI sections and should be split further once the current behavior is stable.
- Home actions and project actions still use separate execution paths.
- Docker support is documented as planned, not implemented.
- Public-domain deployments still depend on the operator setting `AIWS_PUBLIC_DEMO=true`, `AIWS_SHOW_DIAGNOSTICS=false`, and authentication.
