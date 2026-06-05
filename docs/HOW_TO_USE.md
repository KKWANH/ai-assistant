# How to use Ariadne — step by step

10-minute walkthrough for somebody who just cloned the repo. Read this
before [`INSTALL.md`](INSTALL.md) for context, after it for the
"what do I do now" follow-ups.

---

## TL;DR — six commands to a working workspace

```bash
git clone https://github.com/KKWANH/ai-assistant.git ariadne && cd ariadne
npm install
cp .env.example .env                # edit if you want non-Ollama providers
ops/install-aliases.sh && source ~/.zshrc
ariadne start
open http://localhost:4319
```

That's the minimum. The rest of this doc is the **what** + **why** for each
step.

---

## 1. Install

### Prerequisites

| Need | Version | Why |
|---|---|---|
| Node.js | ≥ 22 | Uses `node:sqlite` (built-in, Node 22+ only) |
| npm | bundled with Node | workspaces support |
| macOS / Linux / Windows-WSL | any recent | `node:sqlite` works on all three |

Optional but recommended:

- **Ollama** — local AI models, no API key. Install once, Ariadne auto-uses it.
- **cloudflared** — for exposing your local server as `https://yourname.example.com`. Skip if you only use Ariadne on this machine.

### Clone + install

```bash
git clone https://github.com/KKWANH/ai-assistant.git ariadne
cd ariadne
npm install
```

This installs the four workspace packages (`shared`, `server`, `web`, `admin`)
in one shot. No build step needed — Ariadne runs through `tsx` directly.

### The `ariadne` command (recommended)

```bash
ops/install-aliases.sh
source ~/.zshrc           # or ~/.bashrc
```

This registers `ariadne` as a global shell command. From now on:

```bash
ariadne start       # boot the supervisor + server + (optional) tunnel
ariadne stop
ariadne restart
ariadne status      # show URLs + health
ariadne logs        # tail the live log
ariadne admin       # open the loopback admin dashboard
```

If you'd rather not install the alias, the equivalent is `./ops/ariadne.sh start`.

### Optional: `markitdown` for richer PDF / Word / PPT extraction

By default Ariadne extracts plain text from PDF (via `pdfjs-dist`) and
DOCX (via `mammoth`). For richer markdown (headings, tables, lists +
PPTX / XLSX support) install [microsoft/markitdown](https://github.com/microsoft/markitdown):

```bash
pip install 'markitdown[pdf,docx,pptx,xlsx]'
```

Then either add the install location to your shell `PATH` so the server
picks it up, or set the explicit binary path in `.env`:

```bash
echo "MARKITDOWN_PATH=$(which markitdown)" >> .env
ariadne restart
```

Confirm with `curl http://localhost:4319/api/files/markitdown-status` —
you should see `{"available": true, "version": "0.x.y", ...}`.

When markitdown is detected, the `POST /api/files/extract` endpoint
converts PDF / DOCX / PPTX / XLSX / HTML / EML / IPYNB to markdown,
cached in `<workspace>/.ariadne/cache/markdown/<sha256>.md` so repeat
calls are O(1) reads. For visual context (slides, diagrams, equations)
that don't survive markdown conversion, `GET /api/files/pdf-screenshot`
renders a single PDF page to PNG.

---

## 2. Connect your AI provider

Ariadne is provider-agnostic. **Pick one** to start — you can switch any
time from the chat composer.

### Option A: Ollama (no API key, local models)

```bash
# install Ollama if you haven't
brew install ollama        # macOS
# or curl -fsSL https://ollama.com/install.sh | sh   (Linux)
ollama serve &             # background process

# pull a model
ollama pull qwen3:8b       # 5 GB, 8B param, balanced
# or `qwen3:0.6b` (fast) / `qwen3:14b` (slow but smarter)
```

Ariadne auto-detects whatever models are installed in Ollama. No `.env`
changes needed. Start Ariadne and the chat composer's model picker
will list them.

> **Tune Ollama for Ariadne (important).** Ollama defaults its context window to
> ~4096 tokens (VRAM-based) — but Ariadne builds rich prompts (workspace memory,
> file excerpts, full web pages, long history) that easily exceed that, so the
> tail gets **silently truncated** and the local model looks "dumber" than it is.
> Raise the window and keep the model warm — these are Ollama **server** env vars
> (the OpenAI-compatible `/v1` endpoint ignores per-request `num_ctx`/`keep_alive`):
>
> ```bash
> export OLLAMA_CONTEXT_LENGTH=16384   # stop silent truncation (fine on 16 GB+ RAM)
> export OLLAMA_KEEP_ALIVE=-1          # keep the model resident → no reload lag
> export OLLAMA_FLASH_ATTENTION=1      # keeps the larger window cheap on memory
> export OLLAMA_KV_CACHE_TYPE=q8_0     #  ”
> # then (re)start `ollama serve` so it picks these up. On a macOS Homebrew
> # service, add them to EnvironmentVariables in
> # ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist and reload the agent.
> ```
> Verify with `ollama ps`: the **CONTEXT** column should read `16384` and **UNTIL**
> `Forever`.

### Option B: Hosted provider (Anthropic / OpenAI / Gemini / Moonshot / Kimi / vLLM)

Edit `.env` (copy from `.env.example` if you haven't):

```bash
# Only the active provider's key is required. Leave the rest blank.
ANTHROPIC_API_KEY=sk-ant-…             # https://console.anthropic.com/
OPENAI_API_KEY=sk-…                    # https://platform.openai.com/
GEMINI_API_KEY=…                       # https://aistudio.google.com/
MOONSHOT_API_KEY=…                     # https://platform.kimi.ai/ OR
                                       # https://platform.kimi.com/ (China)
                                       # OR kimi.com Kimi Code console
                                       # (different platforms — see below)
# Self-hosted vLLM on a Linux/GPU box on your LAN
VLLM_BASE_URL=http://gpu-box.local:8000
```

#### Kimi / Moonshot — three independent platforms

Per the Kimi docs, keys cannot be mixed:

| Platform | URL | Endpoint Ariadne routes to |
|---|---|---|
| International | `platform.kimi.ai` (= `platform.moonshot.ai`) | `api.moonshot.ai/v1` (default) |
| China | `platform.kimi.com` (= `platform.moonshot.cn`) | `api.moonshot.cn/v1` |
| Kimi Code | `kimi.com` membership console | `api.kimi.com/coding/v1` |

Set `MOONSHOT_PLATFORM=china` for the China endpoint, or
`MOONSHOT_PLATFORM=kimi-code` for the membership-bundled coding endpoint.
Default = international.

#### Reload after editing `.env`

```bash
ariadne restart
```

Provider keys are read from environment only, never stored in the DB —
intentionally, to keep secrets out of the SQLite. The settings UI in
the app lets you switch *which* provider is active per session, but
the actual keys live in your shell.

### Verify

```bash
curl -s http://localhost:4319/api/providers/status | jq
```

Each provider has `configured: true|false`. The one with `true` and matching
your key choice is the one Ariadne will use.

---

## 3. Your first workspace

A workspace = a folder on your machine + Ariadne's `.ariadne/` metadata
sitting next to it.

### Via the UI (easiest)

1. Open `http://localhost:4319`
2. Login is automatic on `localhost`. (For remote/tunnel access you'd
   need a password — see `ARIADNE_ADMIN_USER` / `ARIADNE_ADMIN_PASSWORD`
   in `.env`.)
3. Sidebar → **+ 새 자료 폴더** (or "New workspace")
4. Pick a folder on your disk OR start from a **starter template**:
   - **Tutorial workspace** — pre-seeded sample files. Open this first.
   - **Investment portfolio** — multi-account portfolio with charts.
   - **Research papers** — notes + .bib + citation audit.
   - **Code project** — small TS project + staged-diff demo.
   - **Reading library**, **Decisions log**, **Budget tracker**, etc.

The starter scaffolds the right files, surface dashboard, and action
templates for that domain. You can edit anything afterwards.

### Via the API

```bash
curl -X POST http://localhost:4319/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name":"Notes","rootPath":"/Users/you/Documents/notes","starter":"blank"}'
```

---

## 4. Your first chat

Sidebar → **+ 새 대화** (New chat). Type a question. Hit Enter.

### Add a workspace

Top of the composer → workspace dropdown → pick one. Now Ariadne reads
that folder's files when relevant. You'll see:

- **Workspace strip** ABOVE the composer — visual cue you're in a
  project chat (vs plain chat).
- **Workspace files button** in the toolbar — opens a file tree picker
  to attach specific files to the next message.

### Reply modes

Below the composer, three buttons:

- **즉답 (Instant)** — fastest, no agent, no retrieval. Best for general
  questions.
- **자동 (Auto)** — server classifier decides per message. Default for
  workspace-attached chats.
- **Agent** — always runs the plan-and-execute loop (good for "fix this
  bug" or "compare X and Y" type questions). Slower, smarter.

### Web search

`Globe` icon in toolbar — off / auto / on. Auto = server decides per
message. Manual on = forces a web_search step.

---

## 5. Your first action (template)

In a workspace, switch to the **Create & Run** tab.

Each starter ships a few action templates. For example, the Investment
portfolio includes:

- `macro_brief_monthly` — pulls fresh macro news, writes a structured
  brief to `analysis/macro/{date}.md`.
- `rebalance_audit` — compares current allocation vs your target (in
  `goals/2026-allocation.md`).
- `position_check` (asks for a thesis_id) — re-evaluates one position
  against its stated thesis.

Click → fill any inputs → Run. The brief lands in a file in your
workspace. The whole pipeline is configurable per-workspace in
`.ariadne/actions.yaml`.

---

## 6. Your first custom dashboard (surface)

A workspace can carry a **surface** — a TypeScript dashboard you write,
sandboxed in an iframe, with an SDK that reads your CSVs / runs your
templates / fetches live stock quotes / FX rates.

Two layouts:

| Layout | Entry path | When to use |
|---|---|---|
| Single file | `.ariadne/surface.tsx` | Small dashboard, one component |
| Folder | `.ariadne/surface/index.tsx` (+ siblings) | Larger dashboard, split for readability |

The folder layout is bundled by esbuild — `index.tsx` can `import`
freely from sibling files. The Portfolio starter ships a 6-file folder
surface as the canonical example.

### SDK shape

Inside a surface:

```tsx
import { useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

const ariadne = useAriadne();
const csv = await ariadne.readCsv("holdings.csv");
const yaml = await ariadne.readText("accounts/_index.yaml");
const quotes = await ariadne.getQuotes(["AAPL", "005930.KS", "BTC-USD"]);
const fx = await ariadne.getFxRates("KRW", ["USD", "EUR"]);
```

`getQuotes()` accepts:

- US tickers: `AAPL`, `MSFT`, `NVDA`, `BRK.B` → auto-resolved to `BRK-B`
- KR 6-digit: `005930` → auto-suffixed to `005930.KS`
- EU listings: `SAP.DE` (XETRA), `ASML.AS` (Amsterdam), `VUSA.AS`
- Crypto: `BTC-USD`, `ETH-USD`
- FX pairs: `USDKRW=X`, `EURUSD=X`

Failures are partial — a bad symbol doesn't blank the whole batch.
`getQuotesDetailed()` returns `{ quotes, errors }` so the surface can
show 'no quote' badges.

### Build

After editing, click **Build** in the surface editor — esbuild bundles
the entry into `.ariadne/surface-dist/bundle.js`, the workspace's
**Custom screen** tab renders it.

---

## 7. Common 5-minute tasks

### Add an MCP server (Model Context Protocol)

Settings → **MCP servers** → Add. Examples:

| Server | Command | What it gives the agent |
|---|---|---|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem /path` | List/read files outside the workspace |
| GitHub | `npx -y @modelcontextprotocol/server-github` | Read issues / PRs |
| Postgres | `npx -y @modelcontextprotocol/server-postgres` | Query a DB |

The agent planner sees registered MCP tools and can call them via the
`mcp_call` step. Loopback-only registration (you can't add MCP servers
from a remote/tunnel session).

### Stage AI edits, review, apply

The `edit_file` action / agent step never writes files directly. Edits
land in `.ariadne/staged/<run-id>/` and show up at
`/runs/<run-id>/diff` with per-file checkboxes. Apply commits the
selected files; Discard wipes them. Every apply is a git commit in the
workspace's `.ariadne/` (auto-initialized as a git repo so you have a
rewind path).

### Run the eval harness

```bash
npm run eval:retrieval          # 34 in-repo cases, no AI key
npm run eval:retrieval:ci       # same + thresholds → CI gate
npm run eval:strategy           # compare BM25 / semantic / hybrid
npm run eval:rag                # mock-mode generation + scoring
npm run eval:rag -- --live      # uses your active provider
```

Add an eval case in `apps/server/src/eval/cases/` whenever you fix a
retrieval/generation regression — the harness gates every future
release.

---

## 8. Where things live

```
.env                        # provider API keys, ports, tunnel name
data/ariadne.db            # SQLite — accounts, chats, runs, settings
data/<workspace>/          # one folder per workspace
  .ariadne/                # workspace metadata
    surface.tsx OR surface/   # custom dashboard
    actions.yaml             # block-pipeline actions
    hooks.yaml              # event-triggered scripts
    staged/<run-id>/         # AI edit proposals awaiting Apply
    runs/<run-id>/            # past run artifacts
    snapshots/                # file index per workspace scan
logs/                       # server.log, supervisor.log, tunnel.log
run/                        # PID files
```

`data/` is gitignored — your local data never goes to git.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm install` fails on `node:sqlite` | Node < 22 | Install Node 22+ |
| Chat says "no API key configured" | active provider's env var blank | Edit `.env`, `ariadne restart` |
| Surface page is blank | bundle not built or build error | Settings → Surface editor → Build; check error message |
| Ollama models list is empty | `ollama serve` not running | `ollama serve &` then `ariadne restart` |
| Tunnel URL changes every restart | not using a named tunnel | `ops/setup-tunnel.sh <hostname>` once, then it's stable |
| `useT() must be used inside <I18nProvider>` | stale browser cache | hard-refresh (⌘⇧R) |
| Quote returns no data for a symbol | wrong format | `?detailed=1` to see why; check `docs/STOCK_API_AUDIT.md` |
| `eval:retrieval` fails gates | retrieval regression | inspect output, fix root cause; gate is intentional |

### Live logs

```bash
ariadne logs                 # the supervisor log (and follows)
ariadne logs server          # just the server's
ariadne logs tunnel          # just cloudflared
```

### Force rebuild a workspace surface

```bash
curl -X POST http://localhost:4319/api/workspaces/<workspace-id>/surface/build
```

---

## 10. What to read next

| If you want to… | Read |
|---|---|
| Understand the project's positioning + non-goals | [`docs/POSITIONING.md`](POSITIONING.md) |
| See the planned roadmap | [`docs/PRODUCT_PLAN.md`](PRODUCT_PLAN.md) |
| Understand the wire shape of the system | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| Tune chat quality with agent + search | [`docs/INTELLIGENCE_TUNING.md`](INTELLIGENCE_TUNING.md) |
| Keep the app fast as it grows | [`docs/PERFORMANCE_ARCHITECTURE.md`](PERFORMANCE_ARCHITECTURE.md) |
| Build a brokerage-app-style surface | [`docs/PORTFOLIO_STARTER_V2.md`](PORTFOLIO_STARTER_V2.md) |
| Ship Ariadne to public users | [`docs/LAUNCH_PLAN.md`](LAUNCH_PLAN.md) |
| Self-host vLLM as a 4th local provider | [`docs/VLLM_PLAN.md`](VLLM_PLAN.md) |
| Understand the security model | [`SECURITY.md`](../SECURITY.md) |
| Contribute | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |

---

## Quick FAQ

**Q. Does Ariadne send my files to the AI provider?**  
A. Only when *you* ask it to — via attachments, a workspace context-build for a
chat message, or an action template you ran. Ariadne itself is a local
process and has no telemetry. Provider data policies (Anthropic, OpenAI,
etc.) apply to whatever you send them via your key.

**Q. Where are my API keys stored?**  
A. Environment variables only. Never in the DB, never in git. Restart the
daemon to pick up `.env` changes.

**Q. Can two people use Ariadne at the same time?**  
A. Not designed for it — the local-first model is single-user. Multi-user
team support is explicitly out of scope (see `docs/POSITIONING.md` §2.3).

**Q. How do I update Ariadne?**  
A. `git pull && npm install && ariadne restart`. SQLite migrations are
idempotent; no manual steps.

**Q. Does Ariadne train on my data?**  
A. **No.** It does not fine-tune any model. Quality improves through
*promotion-learning* — bad answers you mark get promoted into the eval
harness, which the next version has to pass. See
[`docs/POSITIONING.md`](POSITIONING.md) §"Promotion-learning, not
self-learning".

---

For anything not covered above, open an issue or PR. The repo prefers
specific bug reports over questions — but both are welcome.
