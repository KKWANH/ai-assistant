# `aiws.yaml` Guide

`aiws.yaml` turns a local project folder into an AIWS workspace. It declares what context can be included, what must be excluded, which actions are available, and what artifacts those actions are expected to create.

## Minimal Example

```yaml
name: Research Workspace
description: Local AI workbench for document review and notes.
root: .

context:
  include:
    - notes/**/*.md
    - papers/**/*.pdf
    - data/**/*.csv
  exclude:
    - .env
    - secrets/**
    - keys/**
    - node_modules/**
    - .git/**

commands:
  summarize_docs:
    kind: prompt_recipe
    label: Summarize documents
    description: Summarize selected files into a markdown report.
    input:
      files:
        accept: [".pdf", ".docx", ".txt", ".md"]
    prompt: |
      Review the included notes and documents.
      Produce a concise markdown summary with open questions.
    output:
      artifact: summary.md
```

## Top-Level Fields

```yaml
version: 1
name: My Workspace
description: What this folder is for.
root: .
permissions: {}
context: {}
commands: {}
panels: []
views: []
```

- `version`: currently `1`.
- `name`: display name.
- `description`: short explanation shown in project UI.
- `root`: project-relative root. It must stay inside the project unless `allow_external_root: true` is explicitly set.
- `permissions`: default workspace permissions.
- `context`: include/exclude patterns.
- `commands` or `actions`: repeatable workbench actions.
- `panels` and `views`: UI hints.

## Context

```yaml
context:
  include:
    - notes/**/*.md
    - data/**/*.csv
  exclude:
    - .env
    - secrets/**
    - keys/**
    - .git/**
```

AIWS always applies built-in secret exclusions for files such as `.env`, private keys, SSH material, and credential folders. Exclusions are part of the context receipt.

## Commands

Supported command kinds:

- `prompt_recipe`: create a prompt/action record for model-assisted work.
- `file_index`: inspect files and generate an index artifact.
- `codex_prompt`: create an implementation brief for Codex.
- `shell`: run a local shell command after explicit confirmation.
- `python`: run a Python script after explicit confirmation.
- `openclaw_status`: inspect local OpenClaw status.

### Prompt Recipe

```yaml
commands:
  summarize_docs:
    kind: prompt_recipe
    label: Summarize documents
    description: Create a markdown summary from local files.
    prompt: |
      Summarize the included files.
      Include assumptions, risks, and follow-up questions.
    output:
      artifact: artifacts/summary.md
```

### Python Action

```yaml
commands:
  profile_csv:
    kind: python
    label: Profile CSV
    script: scripts/profile_csv.py
    args:
      - data/sample.csv
      - artifacts/profile.json
    permissions:
      file_read: true
      file_write: true
      python: true
```

### Shell Action

```yaml
commands:
  run_tests:
    kind: shell
    label: Run tests
    command: python -m pytest
    permissions:
      shell: true
```

Shell and Python actions require explicit confirmation because they execute local code.

## Artifacts

Declare expected outputs so the UI can explain what a run should create:

```yaml
commands:
  build_report:
    kind: prompt_recipe
    label: Build report
    outputs:
      - artifacts/report.md
      - artifacts/findings.json
```

Artifacts are shown with source run, type, size, and open/download actions.

## Security Rules

- Keep `root` inside the project folder.
- Never include `.env`, keys, browser profiles, SSH files, or credential folders.
- Prefer prompt recipes and deterministic file tools before shell/Python.
- Keep `network: false` unless a command genuinely needs network access.
- Cloud model use is BYOK and must be visible in context receipts.

## Recommended Folder Shape

```text
my-workspace/
  aiws.yaml
  notes/
  data/
  scripts/
  artifacts/
```
