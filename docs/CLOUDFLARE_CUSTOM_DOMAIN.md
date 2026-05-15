# AIWS Cloudflare Custom Domain Runbook

This runbook exposes AIWS at:

```text
https://ai.kwanho.dev
```

The future API hostname can be:

```text
https://api.kwanho.dev
```

## Mental Model

```text
Browser
  -> ai.kwanho.dev
  -> Cloudflare DNS
  -> Cloudflare Tunnel
  -> cloudflared on this Mac
  -> http://127.0.0.1:8765
  -> AIWS
```

Spaceship remains the registrar, but Cloudflare should manage DNS for the domain.

## One-Time Cloudflare Setup

1. In Cloudflare, add the site:

```text
kwanho.dev
```

2. Cloudflare will show two nameservers.

3. In Spaceship, open `kwanho.dev` and replace the current nameservers with the two Cloudflare nameservers.

4. Wait until Cloudflare says the site is active.

## One-Time Tunnel Setup: Dashboard Token

This is the easiest setup.

1. Open Cloudflare Zero Trust.

```text
Cloudflare Dashboard
  -> Zero Trust
  -> Networks
  -> Tunnels
  -> Create a tunnel
```

2. Choose `Cloudflared`.

3. Name it:

```text
aiws
```

4. Choose the macOS connector instructions.

5. Copy only the long token from the generated command:

```text
cloudflared tunnel run --token <COPY_THIS_LONG_TOKEN>
```

6. Put it in `.env`:

```bash
AIWS_CLOUDFLARE_TUNNEL_TOKEN=<COPY_THIS_LONG_TOKEN>
AIWS_PUBLIC_HOSTNAME=ai.kwanho.dev
```

7. In the tunnel dashboard, add a Public Hostname:

```text
Subdomain: ai
Domain:    kwanho.dev
Type:      HTTP
URL:       127.0.0.1:8765
```

## Alternative: CLI Certificate Setup

If browser token setup is not desired, use the certificate-based CLI flow:

```bash
cloudflared tunnel login
cloudflared tunnel create aiws
cloudflared tunnel route dns aiws ai.kwanho.dev
```

Then create `~/.cloudflared/aiws.yml`:

```yaml
tunnel: aiws
credentials-file: /Users/YOUR_USER/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: ai.kwanho.dev
    service: http://127.0.0.1:8765
  - service: http_status:404
```

Use the actual credential path printed by `cloudflared tunnel create aiws`.

## Run AIWS

Start AIWS server mode first:

```bash
source .venv/bin/activate
aiws run --root ~/.ai-workspace --mode server --port 8765 --password "$AIWS_SERVER_PASSWORD" --models ollama
```

Start the named tunnel:

```bash
scripts/aiws-cloudflare-named.sh start
```

Open:

```text
https://ai.kwanho.dev
```

## Future API Host

When AIWS has a separate authenticated API surface, add:

```bash
cloudflared tunnel route dns aiws api.kwanho.dev
```

Then add this ingress entry above the 404 rule:

```yaml
  - hostname: api.kwanho.dev
    service: http://127.0.0.1:8765
```

Do not expose API endpoints without authentication, CSRF protection for browser sessions, and rate limits.
