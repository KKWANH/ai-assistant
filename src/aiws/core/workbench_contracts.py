"""Server-owned metadata contracts for the AIWS workbench UI."""

from __future__ import annotations

import os
from typing import Any

from aiws import costs
from aiws.env import load_env
from aiws.core import home_workbench, model_capabilities


MODEL_UI = {
    ("ollama", "qwen3:0.6b"): {
        "value": "local-small",
        "group": "local",
        "label": "Qwen3 0.6B Local",
        "short": "Qwen3 0.6B",
        "easy_price": "Free · fastest local",
        "best_for": "Very small local drafts and smoke tests",
        "version": "qwen3:0.6b · Ollama local",
    },
    ("ollama", "qwen3:4b"): {
        "value": "local-small",
        "group": "local",
        "label": "Qwen3 4B Local",
        "legacy_label": "Local only",
        "short": "Qwen3 4B",
        "easy_price": "Free · local Mac",
        "best_for": "Short questions, notes, everyday chat",
        "version": "qwen3:4b · Ollama local",
    },
    ("ollama", "qwen3:8b"): {
        "value": "local",
        "group": "local",
        "label": "Qwen3 8B Local",
        "short": "Qwen3 8B",
        "easy_price": "Free · stronger local model",
        "best_for": "Higher local reasoning for a 24GB Mac mini · pull with Ollama if missing",
        "version": "qwen3:8b · Ollama local",
    },
    ("gemini", "gemini-2.5-flash-lite"): {
        "value": "cheap",
        "group": "fast",
        "label": "Gemini 2.5 Flash-Lite",
        "legacy_label": "Cheap cloud",
        "short": "Gemini 2.5 Flash-Lite",
        "agent_calls": 2,
        "easy_price": "Very cheap · fast cloud",
        "best_for": "General questions, fast summaries, low-cost work",
        "version": "gemini-2.5-flash-lite",
    },
    ("gemini", "gemini-2.5-flash"): {
        "value": "gemini-flash",
        "group": "fast",
        "label": "Gemini 2.5 Flash",
        "short": "Gemini 2.5 Flash",
        "agent_calls": 2,
        "easy_price": "Fast multimodal · paid",
        "best_for": "Image analysis and fast document work",
        "version": "gemini-2.5-flash",
    },
    ("gemini", "gemini-2.5-pro"): {
        "value": "gemini-pro",
        "group": "reasoning",
        "label": "Gemini 2.5 Pro",
        "short": "Gemini 2.5 Pro",
        "agent_calls": 3,
        "easy_price": "Higher accuracy · paid",
        "best_for": "Complex questions, long writing, accuracy-sensitive work",
        "version": "gemini-2.5-pro",
    },
    ("kimi", "kimi-k2.5"): {
        "value": "smart-legacy",
        "group": "long",
        "label": "Kimi K2.5",
        "short": "Kimi K2.5",
        "agent_calls": 3,
        "easy_price": "Long context · paid",
        "best_for": "Long documents and analysis",
        "version": "kimi-k2.5",
    },
    ("kimi", "kimi-k2.6"): {
        "value": "smart",
        "group": "long",
        "label": "Kimi K2.6",
        "legacy_label": "Smart cloud",
        "short": "Kimi K2.6",
        "agent_calls": 3,
        "easy_price": "Long context · paid",
        "best_for": "Long documents, long context, analysis",
        "version": "kimi-k2.6",
    },
    ("kimi", "kimi-k2-thinking"): {
        "value": "kimi-thinking",
        "group": "reasoning",
        "label": "Kimi Thinking",
        "legacy_label": "Kimi thinking",
        "short": "Kimi Thinking",
        "agent_calls": 4,
        "easy_price": "Deep reasoning · slower",
        "best_for": "Deep reasoning, long analysis",
        "version": "kimi-k2-thinking",
    },
    ("openai", "gpt-5.1-codex"): {
        "value": "coding",
        "group": "coding",
        "label": "OpenAI GPT-5.1 Codex",
        "legacy_label": "Coding expensive",
        "short": "GPT-5.1 Codex",
        "agent_calls": 4,
        "easy_price": "Coding specialist · paid",
        "best_for": "Code changes, refactoring, development work",
        "version": "gpt-5.1-codex",
    },
    ("ernie", "ernie-5.1"): {
        "value": "ernie",
        "group": "cloud",
        "label": "ERNIE 5.1",
        "short": "ERNIE 5.1",
        "easy_price": "Qianfan cloud · verify pricing",
        "best_for": "Chinese/multilingual work, long context, research analysis",
        "version": "ernie-5.1 · Baidu Qianfan API",
    },
}


def api_key_map() -> dict[str, bool]:
    load_env()
    return {
        "ollama": True,
        "kimi": bool(os.environ.get("AIWS_KIMI_API_KEY") or os.environ.get("MOONSHOT_API_KEY")),
        "gemini": bool(os.environ.get("AIWS_GEMINI_API_KEY")),
        "openai": bool(os.environ.get("AIWS_OPENAI_API_KEY")),
        "ernie": bool(os.environ.get("AIWS_ERNIE_API_KEY") or os.environ.get("AIWS_QIANFAN_API_KEY")),
    }


def model_catalog() -> list[dict[str, object]]:
    keys = api_key_map()
    models: list[dict[str, object]] = []
    for item in costs.list_model_costs():
        capability = model_capabilities.capability_for_cost(item, api_key_configured=bool(keys.get(item.provider)))
        ui = MODEL_UI.get((item.provider, item.model), {})
        cloud = item.provider != "ollama"
        model = {
            **capability,
            "value": ui.get("value") or f"{item.provider}-{item.model}".replace(":", "-").replace(".", "-"),
            "group": ui.get("group") or ("local" if not cloud else "cloud"),
            "label": ui.get("label") or item.model,
            "legacyLabel": ui.get("legacy_label", ""),
            "short": ui.get("short") or item.model,
            "provider": item.provider,
            "model": item.model,
            "cloud": cloud,
            "inputPrice": item.input_per_million,
            "outputPrice": item.output_per_million,
            "agentCalls": ui.get("agent_calls") or (2 if cloud else 1),
            "cost": _cost_label(item),
            "easyPrice": ui.get("easy_price") or _cost_label(item),
            "privacy": "Cloud AI" if cloud else "Local Mac",
            "bestFor": ui.get("best_for") or capability["recommended_use"],
            "recommendedUse": capability["recommended_use"],
            "supportsText": capability["supports_text"],
            "supportsImage": capability["supports_image"],
            "supportsFileText": capability["supports_file_text"],
            "supportsWebSearch": capability["supports_web_search"],
            "version": ui.get("version") or item.model,
        }
        models.append(model)
    return models


def action_library() -> list[dict[str, Any]]:
    return home_workbench.list_actions()


def workbench_contract() -> dict[str, Any]:
    return {
        "version": 1,
        "models": model_catalog(),
        "actions": action_library(),
        "search_modes": [
            {"value": "off", "label": "Search off", "network": False},
            {"value": "auto", "label": "Local context first", "network": "requires_approval_when_triggered"},
            {"value": "always", "label": "Web search", "network": True},
        ],
    }


def _cost_label(item: costs.ModelCost) -> str:
    if item.provider == "ollama":
        return "Free · local Mac"
    if item.input_per_million <= 0 and item.output_per_million <= 0:
        return f"{item.provider} API · verify pricing"
    return f"~${item.input_per_million:.2f}/M in · ~${item.output_per_million:.2f}/M out"
