# AIWS Security Test Plan

This checklist is written from a defensive security review perspective. Run it before exposing AIWS outside the Mac mini.

## 1. Network Exposure

- Verify local mode binds only to `127.0.0.1`.
- Verify server mode binds to `0.0.0.0` only when intentionally started.
- Verify no router port-forward exposes AIWS directly.
- Verify access from outside LAN fails unless Tailscale or Cloudflare Tunnel is used.
- Verify Tailscale ACL allows only expected family accounts.
- Verify Cloudflare Tunnel, if used, is protected by Cloudflare Access.

## 2. Authentication

- Verify server mode refuses unauthenticated access.
- Verify login accepts valid username/password.
- Verify login rejects wrong password.
- Verify no plaintext password appears in `users.json`.
- Verify password hashes use PBKDF2-SHA256 with unique salts.
- Verify signed cookies cannot be forged by changing the username.
- Verify cookies are `HttpOnly` and `SameSite=Lax`.
- Verify logout is implemented before broad internet exposure.
- Verify brute-force rate limiting is added before broad internet exposure.

## 3. Authorization

- Verify admin can see all projects.
- Verify normal users cannot see another user's private project.
- Verify normal users can see public projects.
- Verify project detail, session create, manual append, and ask endpoints enforce project access.
- Verify a forged URL to `/project/private-project` is rejected for non-owner users.
- Verify direct POSTs to `/append/...` and `/ask/...` are rejected for unauthorized users.

## 4. Account Profile And Memory

- Verify profile fields are escaped in HTML output.
- Verify saved memory is included only in that user's model context.
- Verify another user cannot read private profile memory.
- Verify admin visibility into usage does not leak passwords.
- Verify profile updates cannot change admin status.
- Verify future automatic memory updates are auditable and can be deleted.

## 5. Avatar Upload

- Verify only `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` extensions are accepted.
- Verify file magic bytes match extension.
- Verify uploads over 2MB are rejected.
- Verify uploaded files are stored outside project/session content.
- Verify uploaded SVG/HTML/script files are rejected.
- Verify avatar serving returns an image content type.
- Verify filenames cannot perform path traversal.

## 6. Data Storage

- Verify `messages.jsonl` remains valid JSONL after appends.
- Verify `session.md` is regenerated from stored messages.
- Verify backups include `projects/`, `skills/`, `users.json`, `config.json`, and `avatars/`.
- Verify secrets and API keys are never committed.
- Verify corrupted JSON files fail loudly rather than silently creating invalid state.

## 7. Model Provider Calls

- Verify provider/model metadata is stored with assistant messages.
- Verify account usage increments on ask.
- Verify provider errors do not write fake assistant messages.
- Verify future cloud API keys are read only from environment or local ignored config.
- Verify model output is HTML-escaped in UI.

## 8. Search And Attachments, Before Release

- Verify URL fetches have allowlists or safe outbound policies.
- Verify PDF/Word parsing has size limits.
- Verify image parsing strips metadata where appropriate.
- Verify attachments cannot overwrite workspace files.
- Verify extracted text is stored with source metadata.
- Verify search sources are stored and displayed.
- Verify search mode `off` never sends search context.
- Verify search mode `auto` triggers only on freshness-sensitive prompts.
- Verify search mode `always` records search metadata on every assistant response.
- Verify attachment upload accepts only supported extensions.
- Verify attachment serving checks project authorization.
- Verify DOCX text extraction handles malformed archives safely.
- Verify PDF fallback extraction does not execute embedded content.

## 9. Operational Monitoring

- Verify admin usage dashboard shows per-account message/ask counts.
- Verify logs do not include passwords or API keys.
- Verify logs are rotated or bounded.
- Verify failed logins are observable.
- Verify backup restore has been tested.
- Verify supervisor writes status JSON.
- Verify supervisor restarts a stopped process.
- Verify supervisor can be stopped cleanly without orphaning child processes.

## 10. Release Gate

Do not expose AIWS beyond Tailscale until:

- all tests pass,
- admin account exists,
- default project visibility is private,
- Cloudflare Access or Tailscale ACL is configured,
- rate limiting and logout are implemented,
- backup/restore has been tested.
