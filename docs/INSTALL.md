# Install — Ariadne 5-minute setup

> macOS / Linux only for v0.1. Windows works if you have WSL.

## What you'll have at the end

- Ariadne supervisor running on `http://localhost:4319`
- Admin dashboard at `http://localhost:7459`
- Optional Cloudflare tunnel exposing `https://your-name.kwanho.dev` (or your own)
- A first workspace, scanned and ready to chat against

Time: **5 min** without a tunnel, **~10 min** with one.

---

## 1. Prerequisites

```bash
# Required
node --version   # ≥ 22
npm --version    # ≥ 10
git --version    # any recent

# Recommended (for free local AI — skip if you only want hosted providers)
# https://ollama.com → install → then:
ollama pull llama3.2:3b
ollama pull nomic-embed-text   # used by the RAG embedding index

# Optional (if you want a public URL — see §4)
brew install cloudflared       # macOS
# or: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

## 2. Clone + install

```bash
git clone https://github.com/KKWANH/ai-assistant.git ariadne
cd ariadne
npm install          # installs all workspaces (server + web + admin + shared)
npm run build:web    # one-time build of the React bundle into apps/web/dist
```

The web build is checked into the supervisor's serving path, not into git, so
you'll need to re-run `build:web` after pulling significant UI changes.

## 3. First run

```bash
./ops/ariadne.sh start
```

What this does:

1. Boots the supervisor (PID file under `run/supervisor.pid`).
2. Starts the API server on `127.0.0.1:4319` and serves the SPA from the same port.
3. Starts the admin dashboard on `127.0.0.1:7459`.
4. If `cloudflared` is installed AND your `.env` has tunnel config, starts the tunnel.

Output looks like:

```
✓ Supervisor started (PID 12345)
  Local server:  http://localhost:4319
  Admin:         http://localhost:7459
✓ Ariadne is ready.
```

Open `http://localhost:4319` — you'll land directly in the app (loopback auth, no
login needed locally).

### Stopping / restarting

```bash
./ops/ariadne.sh status
./ops/ariadne.sh stop
./ops/ariadne.sh restart       # use this after any code change
./ops/ariadne.sh logs server   # tail server.log (also: tunnel, supervisor)
```

## 4. (Optional) Cloudflare tunnel for a public URL

If you want to reach Ariadne from your phone, share with collaborators, or just
have a clean URL:

```bash
# 1. Authenticate cloudflared with your Cloudflare account.
cloudflared tunnel login

# 2. Create a named tunnel.
cloudflared tunnel create ariadne-mine

# 3. Map a hostname to the tunnel.
cloudflared tunnel route dns ariadne-mine ariadne.<your-zone>.com

# 4. Write the config file (the script picks this up via .env).
# See ops/setup-tunnel.sh for the helper that does this end-to-end.
./ops/setup-tunnel.sh ariadne-mine ariadne.<your-zone>.com
```

After `./ops/ariadne.sh restart`, the supervisor picks up the tunnel and prints
the URL.

> **Security note**: with the tunnel up, write actions (file edits, scans,
> deletes, scripts) refuse to run from non-loopback connections — you can browse
> from your phone, but only your local session can mutate. Account auth is
> required from the tunnel; loopback is implicitly the seeded admin.

## 5. Bring your own AI keys

Ariadne reads provider keys from your shell environment (NOT the DB):

```bash
# pick the ones you actually use
export ANTHROPIC_API_KEY=sk-ant-…
export OPENAI_API_KEY=sk-…
export GEMINI_API_KEY=…
export MOONSHOT_API_KEY=…
# Ollama needs no key — just run `ollama serve` on the default port.
```

Put these in your shell's rc file (`~/.zshrc` / `~/.bashrc`) so they survive
restarts, then `./ops/ariadne.sh restart` to pick them up.

The settings UI inside Ariadne (top-right gear icon) lets you switch active
provider/model per session, but the **keys themselves** must come from env vars —
this is intentional.

### Optional: self-hosted vLLM on a Linux/GPU box

If you have a Linux box with a CUDA GPU on the same LAN, you can point Ariadne
at a `vllm serve …` process and let it do agentic bursts + eval concurrency
against your own hardware — worth it on a Linux box you own, not on a Mac mini.

```bash
# On the GPU box (Linux):
pip install vllm
vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000

# On the Ariadne box:
export VLLM_BASE_URL=http://<gpu-box-hostname-or-ip>:8000
# (optional) only if you launched vllm with --api-key
export VLLM_API_KEY=…
./ops/ariadne.sh restart
```

Then pick "vLLM (self-hosted)" + the matching model id in the chat model
picker. The model id must match what `vllm serve` was launched with — vLLM
does not hot-swap models in one process.

## 6. First sanity check

```bash
# Server health
curl -s http://localhost:4319/healthz

# RAG eval harness — runs in ~3 seconds, no AI keys needed
npm run eval:retrieval

# Strategy comparison — needs Ollama running locally for the semantic leg
npm run eval:strategy -- --use-db
```

If `eval:retrieval` prints a 26-case summary with `Hit@6: 80%+`, you have a
working install.

---

## Common install issues

**`tsx: command not found`** — you ran `npx tsx` outside the repo. From the
repo root, `npx tsx <file>` works after `npm install`.

**`EADDRINUSE :4319`** — another supervisor (or anything) is on that port.
`./ops/ariadne.sh stop` first. If the PID file is stale,
`rm run/supervisor.pid && ./ops/ariadne.sh start`.

**Web shows "Server is running. The web UI has not been built yet."** — run
`npm run build:web` and restart. The supervisor falls back to a placeholder when
`apps/web/dist/index.html` is missing.

**"Stuck on the login screen even with the right password"** — use the
one-click reset link on the login form.

**Ollama "no embedding provider reachable"** — `ollama serve` not running, OR
the embedding model isn't pulled. `ollama pull nomic-embed-text`.

---

## Next

- **First chat** + **first workspace**: → `docs/HOW_TO_USE.md`
- **API + provider integration**: → `docs/API.md`
- **Architecture overview**: → `docs/ARCHITECTURE.md`
