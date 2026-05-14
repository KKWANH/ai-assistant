"""Lightweight planner for general chat requests.

This is intentionally conservative: the planner describes and gates steps, while
only already-safe work is executed by the existing chat path.
"""

from __future__ import annotations

import re
from typing import Any

from aiws import costs


def plan_request(
    *,
    content: str,
    provider: str,
    model: str,
    search_mode: str = "off",
    has_attachment: bool = False,
    attachment_type: str = "",
) -> dict[str, Any]:
    text = content.lower()
    steps: list[dict[str, Any]] = [
        step("requirements", "analyze_request", "요구사항과 제약을 짧게 정리", "ready"),
    ]
    if has_attachment:
        steps.append(step("read_attachment", "file_read", f"첨부 파일 읽기: {attachment_type or 'file'}", "ready"))
    if needs_search(text, search_mode):
        steps.append(step("web_research", "web_search", "필요한 최신 정보 검색", "planned", permission="network"))
    if needs_code(text):
        steps.append(
            step(
                "sandbox_run",
                "containerized_code",
                "격리된 실행 환경에서 코드 작성/실행",
                "planned",
                permission="sandbox",
            )
        )
    steps.extend(
        [
            step("synthesize", "analysis", "사전 정보와 새 정보를 취합해 분석", "ready"),
            step("final_report", "model_response", "결과 요약과 다음 액션 제안", "ready"),
        ]
    )
    model_calls = 1 + sum(1 for item in steps if item["type"] in {"web_search", "containerized_code", "analysis"})
    estimated = costs.estimate_cost(
        provider,
        model,
        costs.rough_token_count(content) * max(1, model_calls),
        1024 * max(1, model_calls),
    )
    return {
        "intent": infer_intent(text),
        "mode": "general_chat_agent",
        "required_context": context_items(has_attachment, attachment_type),
        "steps": steps,
        "estimated_model_calls": model_calls,
        "estimated_cost": estimated,
        "requires_confirmation": any(item.get("permission") in {"network", "sandbox"} for item in steps),
        "execution_policy": {
            "planner_does_not_execute": True,
            "implemented_now": ["analyze_request", "file_read", "analysis", "model_response"],
            "requires_future_or_explicit_action": ["web_search", "containerized_code"],
        },
        "ui": {"open_panels": ["plannerTrace", "artifactGallery"]},
    }


def step(step_id: str, step_type: str, title: str, status: str, *, permission: str = "read-only") -> dict[str, Any]:
    return {
        "id": step_id,
        "type": step_type,
        "title": title,
        "status": status,
        "permission": permission,
    }


def context_items(has_attachment: bool, attachment_type: str) -> list[dict[str, str]]:
    if not has_attachment:
        return []
    return [{"type": "attachment", "status": "available", "mime_or_extension": attachment_type or "file"}]


def needs_search(text: str, search_mode: str) -> bool:
    if search_mode == "always":
        return True
    if search_mode == "off":
        return False
    return bool(re.search(r"(검색|최신|오늘|현재|인터넷|web|search|news|price|가격)", text))


def needs_code(text: str) -> bool:
    return bool(re.search(r"(코드|프로그램|스크립트|실행|테스트|container|python|분석 스크립트)", text))


def infer_intent(text: str) -> str:
    if needs_code(text):
        return "code_or_data_task"
    if re.search(r"(요약|정리|읽)", text):
        return "summarize_or_extract"
    if re.search(r"(분석|비교|리포트)", text):
        return "analyze_and_report"
    return "general_chat"
