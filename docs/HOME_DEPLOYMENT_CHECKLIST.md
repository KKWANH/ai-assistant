# Safe Home Deployment Checklist

AIWS is intended for a private Mac mini or family self-hosted setup, not public SaaS traffic.

## Before Exposing The UI

- Use a long random `AIWS_SERVER_PASSWORD` in `.env`.
- Create named user accounts for family members; do not share the admin account.
- Keep the raw `8765` port closed to the public internet.
- Expose AIWS through Cloudflare Tunnel or Tailscale only.
- Prefer Cloudflare Access in front of server mode for browser access.
- Keep `~/.ai-workspace` backed up.
- Do not put real passwords, API keys, or test credentials in screenshots, README files, or commits.

## Runtime Checks

```bash
aiws-cloudflare status
aiws-cloudflare url
aiws-cloudflare logs
```

Open only the URL reported by `aiws-cloudflare url`; quick tunnel URLs are temporary.

## Secrets

Store local secrets in `.env`, which is ignored by git:

```bash
cp .env.example .env
```

Use either `AIWS_KIMI_API_KEY` or `MOONSHOT_API_KEY` for Kimi. Basic local Ollama usage does not require a cloud key.

## Backups

Create a compressed backup with the AIWS CLI. Runtime logs are skipped; projects, sessions, skills, users, avatars, goals, and config are included:

```bash
aiws backup create --root ~/.ai-workspace --output ~/aiws-workspace-backup
```

Restore to a new workspace:

```bash
aiws backup restore ~/aiws-workspace-backup.tar.gz --root ~/.ai-workspace-restored
```

Restore over an existing workspace only after stopping AIWS and confirming the backup:

```bash
aiws backup restore ~/aiws-workspace-backup.tar.gz --root ~/.ai-workspace --replace
```
