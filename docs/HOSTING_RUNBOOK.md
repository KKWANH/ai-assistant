# AIWS Hosting Runbook

## Decision

Use **Tailscale first**.

AIWS should run on the Mac mini as the origin server. Tailscale should provide private network access for the family. Cloudflare Tunnel is a later option if browser-only public-domain access is required.

## Why Tailscale First

- AIWS stores canonical data on local files.
- AIWS calls local Ollama on the Mac mini.
- The safest default is no public internet exposure.
- Tailscale Personal is enough for a small family setup.
- Tailscale identity plus AIWS local accounts gives two layers:
  - network membership
  - app-level account and project permissions

## When To Use Cloudflare Tunnel Later

Use Cloudflare Tunnel only when:

- users cannot install Tailscale,
- you need a normal HTTPS domain,
- you are ready to manage Cloudflare Access policies,
- you have reviewed logs, rate limits, and backup strategy.

## Mac Mini Setup

Install Tailscale:

```bash
brew install --cask tailscale
```

On macOS, the cask installer may require an administrator password and kernel/network extension approval in System Settings. If the automated install stops at `sudo: a password is required`, install Tailscale manually from the downloaded package or from the official app.

Open Tailscale and log in with the admin identity.

Confirm the Mac mini is in the tailnet:

```bash
tailscale status
```

If the App Store or `.app` install works but `tailscale` is not in `PATH`, use:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
```

This repository also includes a wrapper:

```bash
scripts/tailscale-status.sh
```

After loading the AIWS shell aliases:

```bash
ts-status
```

Smoke test performed during development:

```text
tailscale not found
brew install --cask tailscale
download succeeded
installer stopped because macOS required an administrator password
```

After interactive app installation and login, this command worked:

```text
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
100.110.111.37  kwanho-macmini  kwanho0096@  macOS  -
```

Start AIWS in server mode:

```bash
source .venv/bin/activate

aiws ui start \
  --root ~/.ai-workspace \
  --mode server \
  --port 8765
```

If the workspace has no accounts yet, create accounts first:

```bash
aiws account create kwanho --root ~/.ai-workspace --password "change-this" --admin
aiws account create parent --root ~/.ai-workspace --password "change-this-too"
```

Access from another Tailscale device:

```text
http://<mac-mini-tailscale-name>:8765
```

or:

```text
http://<mac-mini-tailscale-ip>:8765
```

## Recommended Security Defaults

- Keep AIWS bound to Tailscale/private network only.
- Do not port-forward the Mac mini router.
- Do not expose `8765` directly to the public internet.
- Use unique AIWS passwords per account.
- Keep admin account private.
- Use project `visibility=private` by default.
- Make family-shared projects `visibility=public`.
- Back up `~/.ai-workspace`.

## Cloudflare Tunnel Later

Install:

```bash
brew install cloudflared
```

Login:

```bash
cloudflared tunnel login
```

Create tunnel:

```bash
cloudflared tunnel create aiws
```

Route DNS:

```bash
cloudflared tunnel route dns aiws aiws.example.com
```

Run:

```bash
cloudflared tunnel --url http://127.0.0.1:8765 run aiws
```

Only do this with Cloudflare Access enabled in front of AIWS.
