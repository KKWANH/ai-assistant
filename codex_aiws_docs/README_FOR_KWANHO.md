# 관호님용 요약

이 폴더는 Codex에게 로컬 AI Workspace 프로젝트를 설명하기 위한 문서 묶음입니다.

## 파일 구성

```text
CODEX_START_PROMPT.md
→ Codex 첫 프롬프트로 그대로 붙여넣는 파일

AIWS_PROJECT_SPEC.md
→ 전체 제품/아키텍처/저장소/skills/모델/검색 설계 명세

AGENTS.md
→ Codex가 repo에서 자동으로 참고할 프로젝트 개발 규칙 파일

CODEX_LOCAL_RUNBOOK.md
→ 로컬에서 Codex와 함께 개발할 때 실행 순서와 테스트 명령
```

## 추천 사용법

1. 기존 `local-ai-workspace-v2` 압축을 풉니다.
2. repo root에 `AGENTS.md`를 복사합니다.
3. `AIWS_PROJECT_SPEC.md`, `CODEX_START_PROMPT.md`, `CODEX_LOCAL_RUNBOOK.md`도 repo root나 `docs/`에 넣습니다.
4. repo root에서 `codex`를 실행합니다.
5. `CODEX_START_PROMPT.md` 내용을 첫 프롬프트로 붙여넣습니다.

## Codex에게 처음 시킬 작업

가장 좋은 첫 작업은 이것입니다.

```text
Read AGENTS.md and AIWS_PROJECT_SPEC.md. Then implement MVP 3: aiws ask with Ollama provider. Make minimal changes and add tests with mocked network calls.
```

## 현재 개발 방향

지금은 UI를 더 꾸미기보다 먼저 다음 순서가 좋습니다.

```text
1. aiws ask + Ollama
2. provider abstraction
3. Kimi/GPT/Claude/Gemini
4. search-first pipeline
5. local UI 개선
6. server/부모님용 제한 UI
```
