# OpenClaw Local Runbook

OpenClaw is installed as a local CLI for UI testing, browser/control research, and future AIWS workflow integration.

## Current Local Setup

- CLI: `openclaw`
- Gateway mode: `local`
- Gateway bind: `loopback`
- Gateway URL: `http://127.0.0.1:18789/`
- State: `~/.openclaw`
- AIWS integration:
  - read-only status endpoint at `/api/openclaw`
  - automation project endpoint at `/api/automations`
  - default project: `AIWS UI Self Check`

## Useful Commands

```bash
openclaw --version
openclaw doctor --non-interactive
openclaw gateway status
openclaw sessions --json --limit 10
openclaw dashboard
```

AIWS automation smoke check:

```bash
python - <<'PY'
from aiws import automations
run = automations.run_project("~/.ai-workspace", automations.DEFAULT_OPENCLAW_SLUG, actor="local")
print(run["status"])
print("\n".join(run["observations"]))
PY
```

If LaunchAgent start fails, run a local background gateway:

```bash
nohup openclaw gateway run > ~/.openclaw/gateway-aiws.log 2>&1 &
echo $! > ~/.openclaw/gateway-aiws.pid
```

Stop that fallback gateway:

```bash
kill "$(cat ~/.openclaw/gateway-aiws.pid)"
```

## AIWS Integration Policy

AIWS should treat OpenClaw as a local tool runtime, not as a public service.

- Keep OpenClaw bound to loopback by default.
- Do not expose OpenClaw Gateway through Cloudflare Tunnel.
- Do not copy OpenClaw secrets or tokens into AIWS logs.
- Do not pipe API keys into `openclaw models auth paste-token` in a non-interactive shell. In this OpenClaw version, that prompt can echo typed input to the terminal.
- In AIWS, show OpenClaw status, session counts, and dashboard link only in Power/developer UI.
- Future write actions should require explicit confirmation.

## Auth Setup Note

OpenClaw keeps model auth separately from AIWS `.env`.
AIWS can use `AIWS_OPENAI_API_KEY`, `AIWS_KIMI_API_KEY`, and `AIWS_GEMINI_API_KEY`, but OpenClaw's own `openclaw agent ...` command does not automatically inherit those keys.

Current safe status checks:

```bash
openclaw models status --json
openclaw models auth list
```

If OpenClaw needs an OpenAI key, use an interactive terminal flow and confirm the prompt masks input before pasting any real key. If a key is ever echoed to terminal output, rotate that key immediately.

Observed requirement:

- OpenClaw default agent currently uses `openai/gpt-5.5`.
- Without an OpenClaw model auth profile, `openclaw agent ...` fails with "No API key found for provider openai".
- Therefore, for OpenClaw browser/agent diagnostics, you need either:
  - a separate OpenAI API key registered in OpenClaw, or
  - a supported OpenClaw auth flow such as GitHub Copilot login if you choose to use that route.

Do not reuse a key that has appeared in terminal output. Revoke and recreate it first.

## Next Integration Steps

1. Store OpenClaw task summaries in AIWS sessions, not raw secrets or full trajectories.
2. Add a UI testing workflow:
   - create task
   - open target URL
   - record observations
   - attach screenshot/report to current AIWS session
3. Add explicit start/stop controls only after permission and safety rules are clear.
