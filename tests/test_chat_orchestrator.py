from aiws.core import chat_orchestrator


def test_chat_orchestrator_plans_search_and_sandbox_steps():
    plan = chat_orchestrator.plan_request(
        content="최신 가격을 검색하고 Python 분석 스크립트를 실행해서 리포트로 정리해줘",
        provider="openai",
        model="gpt-5.1-codex",
        search_mode="auto",
        has_attachment=True,
        attachment_type=".csv",
    )

    step_types = [step["type"] for step in plan["steps"]]
    assert plan["intent"] == "code_or_data_task"
    assert "file_read" in step_types
    assert "web_search" in step_types
    assert "containerized_code" in step_types
    assert plan["requires_confirmation"] is True
    assert plan["estimated_model_calls"] >= 3


def test_chat_orchestrator_keeps_simple_chat_small():
    plan = chat_orchestrator.plan_request(
        content="안녕",
        provider="ollama",
        model="qwen3:4b",
    )

    assert [step["type"] for step in plan["steps"]] == ["analyze_request", "analysis", "model_response"]
    assert plan["requires_confirmation"] is False
