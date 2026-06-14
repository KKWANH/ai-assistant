# Install

> The full hands-on setup walkthrough — providers, the Cloudflare tunnel,
> troubleshooting — is **[`HOW_TO_USE.md`](HOW_TO_USE.md)**. For reference docs,
> run Ariadne and open **`/developers`** (Quickstart, Configuration, Running the
> server). This stub keeps the 30-second version.

**Requirements:** Node ≥ 22 (the database is the built-in `node:sqlite` — nothing
native to compile). macOS / Linux; Windows via WSL.

```bash
git clone https://github.com/KKWANH/ai-assistant.git ariadne && cd ariadne
npm install
./ops/ariadne.sh restart      # build the web app + start the server on :4319
open http://localhost:4319     # loopback request = admin, no login
```

No API key is needed to explore — a built-in mock provider answers offline. Add
real keys in **Settings → Providers** or via env vars (see
[`/developers/configuration`] in the app).

For Ollama / hosted / vLLM providers, a public tunnel, and a troubleshooting
list → **[`HOW_TO_USE.md`](HOW_TO_USE.md)**.
