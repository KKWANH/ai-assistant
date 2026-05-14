"""Usage/cost domain facade."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def record(root: str | Path, username: str, provider: str, cost: float, *, metadata: dict[str, Any] | None = None) -> None:
    storage.record_usage(root, username, provider, cost, metadata=metadata)


def model_total_usd(root: str | Path, username: str, *, period: str = "day") -> float:
    return storage.model_usage_total_usd(root, username, period=period)
