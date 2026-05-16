# Local-First Privacy

AIWS defaults to keeping work inspectable on your machine:

- Project files live under the workspace root.
- Local model calls stay on the machine when using Ollama.
- Context receipts show files, chunks, model/provider, privacy mode, and cost estimates.
- Artifacts and runs remain file-based and auditable.

## Cloud BYOK

Cloud providers are opt-in. Before a cloud model call, AIWS must make the send boundary clear:

- user message
- selected chat history/context
- attached files or computed profiles
- provider/model
- estimated tokens/cost
- excluded files

## Local-Only Projects

Enable the project local-only lock when a project contains sensitive data. While locked, remote provider calls are blocked even if the user confirms cloud execution.

## Public Access

Treat Cloudflare, Tailscale sharing, or any custom domain as public exposure. Keep auth enabled and hide diagnostics unless you are a local admin.
