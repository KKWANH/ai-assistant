# Security policy

Ariadne is a **local-first** app: the server you run owns your files,
your API keys, and your chat history. Most of the threats a hosted
SaaS would worry about don't apply here. The threats that *do* apply
are concentrated in a few specific surfaces, and that's what this
document is about.

## Reporting a vulnerability

Do **not** open a public issue.

Email <kwanho0096@gmail.com> with:

- A short description of the vulnerability.
- Reproduction steps or proof-of-concept (file paths, payloads,
  curl commands — whatever's clearest).
- The Ariadne commit SHA you tested against.
- Your suggested severity (it's fine to guess).

Expected response: **within 72 hours**, even if it's just "received,
investigating." Real fixes typically ship within 7 days for high-
severity issues. Once a fix is in, you'll be credited in the release
notes unless you ask not to be.

## What's in scope

These are the surfaces where a real-world report is likely to matter.

### 1. The shared server / Cloudflare tunnel

The server runs on the user's machine. When a tunnel exposes it to
the public internet, **only loopback (`127.0.0.1` / `::1`)** can perform
the high-risk operations:

- Edit surface files (`.ariadne/surface.tsx`).
- Edit / run shell scripts.
- Edit hooks (`.ariadne/hooks.yaml`).
- Add or remove MCP servers.

Remote (tunnel) requests can read + chat + run pre-approved actions,
but cannot mutate the gated surfaces. If you find a way around this
split (a mutation route that's not loopback-gated; an authentication
bypass; a way to escalate from read-only remote to write), that's
in scope.

### 2. The staged-diff invariant

AI-generated edits **never write directly to user files**. They land
in `.ariadne/staged/<run-id>/` and require an explicit human "Apply"
click. If you find a path where an AI tool or action writes outside
this staging area without the apply flow, that's in scope.

### 3. Path traversal / read outside the workspace root

All file reads honor a `safeResolveUnderRoot()` check against the
workspace's `rootPath`. Reads attempting to escape via `../`,
symlinks, absolute paths, encoded characters, etc. should fail. If
you find one that doesn't, in scope.

### 4. Sensitive-file leakage

The retriever (`isRetrievalEligible`) excludes `.env`, `*.pem`,
`*credentials*`, `.cloudflared/`, `id_rsa`, etc. The attachment
parser and surface SDK enforce the same filter. If you find sensitive
files leaking into:

- chat answers,
- search results,
- the workspace snapshot,
- a surface,
- the retrieval index,

that's in scope.

### 5. Provider key exfiltration

API keys live in environment variables, not the database, and the
server is the only process that ever sees them. Surfaces (sandboxed
iframes) have no access to env. If a surface or third-party MCP
server can read a key, in scope.

### 6. MCP / shell-script execution

Running MCP servers and shell scripts is **user-authorized
arbitrary code execution** — those run as the user. If a request
without that authorization can trigger arbitrary execution (e.g., a
crafted attachment that auto-runs a script; a planner step that
silently invokes a script without the action-confirmation flow),
in scope.

## What's not in scope (and why)

- **Threats from your own machine.** If another process on the same
  machine reads your files, that's an OS-level problem outside
  Ariadne's threat model.
- **AI model behavior.** The provider you connect to (Anthropic /
  OpenAI / Gemini / Moonshot / local Ollama) governs its own outputs;
  Ariadne doesn't claim to detect prompt injection in retrieved
  content. The staged-diff invariant is the *containment* layer for
  this, not a prevention claim.
- **DoS via expensive prompts.** Throttling, billing, and rate-limit
  responses are the provider's job.
- **Self-XSS in your own surface code.** Surfaces are your own
  TypeScript — if you put a `<script>` tag in it, that's your
  decision.
- **Issues that require physical access** or compromised credentials.

## What we are explicitly *not* claiming

Ariadne is not "secure by default" in the marketing sense. The
local-first architecture eliminates whole classes of multi-tenant
SaaS vulnerabilities (no shared DB, no cross-tenant data, no
processor-side breach surface for *your* data), but the surfaces
listed above are real and need real attention. We will not pretend
otherwise.

## Hardening recommendations for users

- Don't expose the Cloudflare tunnel without enabling the admin
  password (see `ops/setup-tunnel.sh`).
- Audit any MCP server before adding it — they run as you.
- Treat `.ariadne/staged/` as a real change-review surface, not a
  formality. Read the diff.
- Keep `.env` out of indexed workspaces (the default filter handles
  it; don't override the filter without thinking).

## Acknowledgements

Researchers who reported issues will be listed here. None yet —
this is a v0.1-era project.
