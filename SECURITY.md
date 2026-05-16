# Security Model

AI Workbench Studio is local-first software. It is meant to run on a user's own machine against their own files and models. Treat every public tunnel as internet exposure.

## Modes

- Local mode binds to `127.0.0.1`.
- Server mode binds to `0.0.0.0` and requires authentication when accounts or a bootstrap password are configured.
- Cloudflare/Tailscale access should be treated as public or semi-public access.

## Secrets

AIWS must never expose API key values to the frontend. UI payloads may show only:

```text
configured
missing
```

Do not paste `.env` files, SSH keys, browser profiles, private key material, or credential folders into actions. Built-in exclusions block common secret paths, but users should still review context receipts.

Logs and run records redact common API key, bearer token, password, and home-directory patterns before they are returned to the UI.

## Public Tunnel Rules

When using a public domain or tunnel:

- Keep authentication enabled.
- Hide diagnostics from non-admin users.
- Do not expose local absolute paths.
- Do not expose localhost URLs, shell commands, admin scripts, or tunnel tokens.
- Do not send files to cloud models unless the context receipt and confirmation make it clear.

Recommended `.env` flags for public demos:

```bash
AIWS_PUBLIC_DEMO=true
AIWS_SHOW_DIAGNOSTICS=false
AIWS_ALLOW_ADMIN_LINKS=false
```

## File Access

File APIs must resolve paths under the workspace/project roots. They must reject:

- `../` traversal.
- absolute path injection.
- symlink escapes.
- hidden secret files.
- `.env`, `.pem`, `.key`, `.ssh`, browser profiles, and credential folders.

## Action Execution

`shell` and `python` actions execute local code and require explicit confirmation. Keep them disabled in untrusted public demos.

## Viewer Plugins

Workflow App viewers are selected only through the built-in `viewer_id` allowlist. Project folders cannot provide arbitrary frontend JavaScript, `eval`, `new Function`, or remote viewer code.

## Local-Only Projects

Projects may be locked to local-only execution. While locked, cloud model providers are blocked even when a request includes remote confirmation.

## Reporting A Vulnerability

Open a private security advisory or contact the maintainer before filing a public issue with exploit details.
