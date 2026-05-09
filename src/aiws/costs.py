"""Model catalog and cost estimates."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelCost:
    provider: str
    model: str
    input_per_million: float
    output_per_million: float
    currency: str = "USD"
    note: str = ""


MODEL_COSTS: dict[tuple[str, str], ModelCost] = {
    ("ollama", "qwen3:0.6b"): ModelCost("ollama", "qwen3:0.6b", 0.0, 0.0, note="Local model; electricity only."),
    ("ollama", "qwen3:8b"): ModelCost("ollama", "qwen3:8b", 0.0, 0.0, note="Local model; electricity only."),
    ("kimi", "kimi-k2.5"): ModelCost("kimi", "kimi-k2.5", 0.15, 2.50, note="Estimate; verify against provider billing."),
    ("kimi", "kimi-k2.6"): ModelCost("kimi", "kimi-k2.6", 0.15, 2.50, note="Estimate; verify against provider billing."),
    ("kimi", "kimi-k2-thinking"): ModelCost("kimi", "kimi-k2-thinking", 0.60, 2.50, note="Estimate; verify against provider billing."),
}


def list_model_costs() -> list[ModelCost]:
    return sorted(MODEL_COSTS.values(), key=lambda item: (item.provider, item.model))


def get_model_cost(provider: str, model: str) -> ModelCost | None:
    return MODEL_COSTS.get((provider, model))


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int = 0) -> dict[str, object]:
    cost = get_model_cost(provider, model)
    if cost is None:
        return {
            "provider": provider,
            "model": model,
            "known": False,
            "estimated_cost": None,
            "currency": "USD",
            "note": "Unknown model cost.",
        }
    amount = (input_tokens / 1_000_000 * cost.input_per_million) + (
        output_tokens / 1_000_000 * cost.output_per_million
    )
    return {
        "provider": provider,
        "model": model,
        "known": True,
        "estimated_cost": round(amount, 8),
        "currency": cost.currency,
        "note": cost.note,
    }


def rough_token_count(text: str) -> int:
    return max(1, len(text) // 4)
