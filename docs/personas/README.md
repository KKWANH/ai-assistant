# Test personas

Three self-contained prompts. Each one defines a role + scenarios + a
deliverable. Paste the whole file into a fresh chat (any LLM or human
tester) and they'll do the audit. Don't mix.

| File | Language | Role | Use when |
|---|---|---|---|
| [`developer.md`](developer.md) | English | Senior engineer audit | After a backend / infra change. Catches contract bugs, latency regressions, broken pipelines. |
| [`non-developer.md`](non-developer.md) | 한국어 | 컴퓨터 익숙하지 않은 50대 사용자 | After a UI / copy change. Catches "I don't know what this button does" and jargon leaks. |
| [`translator-qa.md`](translator-qa.md) | 한국어 | 번역 검수자 (UX 카피라이터) | After any user-visible string change. Catches awkward translations, missing translations, raw English leaks. |

## When to run

| Trigger | Run |
|---|---|
| Backend route / agent / retrieval / MCP / hook change | developer |
| Composer / chat / settings / workspace UI change | non-developer + translator-qa |
| i18n key add/edit | translator-qa |
| Tutorial copy change | non-developer + translator-qa |
| Release candidate | all three, in that order |

## Reporting back

Each persona produces a different deliverable:

- **developer**: a pass/fail table per scenario + "top 3 fixes"
- **non-developer**: a per-scenario note of where they got stuck + the
  one thing they'd warn a friend about
- **translator-qa**: a table of (screen, location, current text,
  problem, suggested fix, severity)

Drop the output into a `TEST_REPORT_<date>.md` in this folder for the
historical record. The three reports together are a release sign-off.
