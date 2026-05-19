# AIWS Operations

## Local Daemon

Start the app as one background program:

```bash
.venv/bin/python -m aiws.cli.main start --host 127.0.0.1 --port 8787
```

Start it with a Cloudflare Quick Tunnel for a temporary public URL:

```bash
.venv/bin/python -m aiws.cli.main start --host 127.0.0.1 --port 8787 --cloudflare
```

Stop both the local API and Cloudflare tunnel:

```bash
.venv/bin/python -m aiws.cli.main stop
```

Inspect status and logs:

```bash
.venv/bin/python -m aiws.cli.main status
.venv/bin/python -m aiws.cli.main logs
.venv/bin/python -m aiws.cli.main logs --cloudflare
```

## URLs

- Workbench: `http://127.0.0.1:8787`
- Administrator dashboard: `http://127.0.0.1:8787/admin`
- API health: `http://127.0.0.1:8787/api/health`

When `--cloudflare` is enabled, the temporary `trycloudflare.com` URL appears in:

```text
.aiws/runtime/logs/cloudflared.log
```

Quick Tunnels are useful for temporary demos and testing. They are not the
production path; production should use a named Cloudflare Tunnel with access
controls.

## Development

Backend dev server:

```bash
./scripts/dev.sh
```

Frontend dev server:

```bash
npm --prefix web run dev
```

Verification:

```bash
./scripts/test.sh
./scripts/lint.sh
./scripts/build.sh
```
