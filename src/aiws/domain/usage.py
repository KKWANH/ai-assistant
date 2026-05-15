"""Usage/cost domain facade."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def record(root: str | Path, username: str, provider: str, cost: float, *, metadata: dict[str, Any] | None = None) -> None:
    payload = {
        "user_id": storage.slugify(username),
        "provider": provider,
        "estimated_usd": cost,
    }
    if metadata:
        payload.update(metadata)
    storage.append_model_usage(root, payload)


def model_total_usd(root: str | Path, username: str, *, period: str = "day") -> float:
    return storage.model_usage_total_usd(root, username, period=period)
