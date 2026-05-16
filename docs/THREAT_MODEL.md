# Threat Model

AIWS runs on a local machine and may access private project files. The primary risk is accidental data exposure through public tunnels, cloud model calls, artifact sharing, logs, or overly broad project links.

## Trust Boundaries

- Local browser to local AIWS server.
- Public tunnel or LAN client to AIWS server.
- AIWS server to local filesystem.
- AIWS server to local model runtime.
- AIWS server to BYOK cloud model providers.
- Project to linked project resource boundary.

## Main Risks

- Path traversal or symlink escape reading files outside the workspace.
- Secret-bearing files sent to a cloud model.
- API keys or bearer tokens leaking into logs or run records.
- Public tunnel exposing diagnostics, local paths, admin scripts, or localhost URLs.
- Project links allowing unintended cross-project reads.
- Viewer customization becoming arbitrary JavaScript execution.

## Controls

- Server mode requires authentication.
- Mutations require CSRF when auth is enabled.
- File uploads enforce size, extension, and content checks.
- Common secret patterns are blocked or redacted.
- Cloud calls require explicit confirmation and are blocked by project local-only lock.
- Project links are explicit, scoped by resource type, and deny-by-default.
- Viewer plugins are allowlisted by id.

## Non-Goals

AIWS is not a multi-tenant SaaS security boundary. Do not run untrusted users or untrusted shell/python workflow apps on the same machine.
