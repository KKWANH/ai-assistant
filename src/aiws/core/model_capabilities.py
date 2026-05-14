"""Model capability metadata used by the API and UI."""

from __future__ import annotations

from aiws import costs


def recommended_use(provider: str, model: str) -> str:
    if provider == "ollama":
        return "Local/private text"
    if provider == "gemini":
        return "Cheap image analysis" if "flash" in model else "Large context and reasoning"
    if provider == "kimi":
        return "Long context"
    if provider == "openai":
        return "Codex/code task"
    return "Cloud text"


def capability_for_cost(item: costs.ModelCost, *, api_key_configured: bool) -> dict[str, object]:
    return {
        "provider": item.provider,
        "model": item.model,
        "privacy": "local" if item.provider == "ollama" else "cloud",
        "supports_text": True,
        "supports_image": item.provider in {"gemini", "kimi"},
        "supports_file_text": True,
        "supports_web_search": False,
        "recommended_use": recommended_use(item.provider, item.model),
        "input_per_million": item.input_per_million,
        "output_per_million": item.output_per_million,
        "currency": item.currency,
        "note": item.note,
        "api_key_configured": api_key_configured,
    }
