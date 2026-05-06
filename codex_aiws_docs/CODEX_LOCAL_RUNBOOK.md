# Codex Local Runbook — How to Develop This Repo Locally

## 1. Start a Codex session

From the repository root:

```bash
codex
```

Paste the contents of `CODEX_START_PROMPT.md` as the first task prompt.

Alternatively, ask a narrower task:

```text
Read AGENTS.md and AIWS_PROJECT_SPEC.md. Then implement MVP 3: aiws ask with Ollama provider. Make minimal changes and add tests with mocked network calls.
```

## 2. Recommended first local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m unittest discover -s tests
```

## 3. Run current CLI manually

```bash
aiws --root /tmp/aiws-demo init
aiws --root /tmp/aiws-demo skills list
aiws --root /tmp/aiws-demo project create "AI System" --skills andrej-karpathy-skills
aiws --root /tmp/aiws-demo project create "Local Runner" --parent ai-system
aiws --root /tmp/aiws-demo session create ai-system/local-runner "Step 1 MVP"
aiws --root /tmp/aiws-demo session append ai-system/local-runner step-1-mvp --role user --content "Hello"
aiws --root /tmp/aiws-demo prompt ai-system/local-runner step-1-mvp
```

## 4. Run local UI

```bash
aiws --root /tmp/aiws-demo ui start --mode local --port 8765
```

Open:

```text
http://127.0.0.1:8765
```

## 5. Run server UI

```bash
aiws --root /tmp/aiws-demo ui start --mode server --port 8765 --password "change-me"
```

Do not expose this directly to the public internet.

## 6. Local Ollama preparation for MVP 3

Install and run Ollama separately.

Example model pulls:

```bash
ollama pull qwen3:8b
ollama pull qwen3:14b
```

Ollama should expose the local API at:

```text
http://127.0.0.1:11434
```

## 7. MVP 3 manual test target

After implementing `aiws ask`, test:

```bash
aiws --root /tmp/aiws-demo ask ai-system/local-runner step-1-mvp \
  --provider ollama \
  --model qwen3:8b \
  --content "Summarize this project in three bullets."
```

Expected result:

1. Assistant response printed to terminal.
2. User message written to `messages.jsonl`.
3. Assistant message written to `messages.jsonl`.
4. `session.md` updated.

## 8. Good task prompts for Codex

### Prompt A — inspect only

```text
Read this repository and summarize the current architecture. Do not modify files. Identify the minimum changes needed to implement aiws ask with Ollama.
```

### Prompt B — implement Ollama provider

```text
Implement MVP 3: aiws ask with Ollama provider. Follow AGENTS.md. Make minimal changes. Add tests that mock the Ollama HTTP call. Run the test suite.
```

### Prompt C — add Kimi provider later

```text
Add a Kimi provider after the Ollama provider is working. Reuse the provider abstraction. Store provider/model metadata in assistant messages. Do not implement search yet.
```

### Prompt D — add search later

```text
Design and implement a minimal search-first pipeline with search modes off/auto/always. Start with a provider interface and one simple provider. Store source metadata in JSONL. Do not add RAG.
```
