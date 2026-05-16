"""Usage/cost domain facade."""

from __future__ import annotations

from pathlib import Path
from datetime import date
import calendar
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


def monthly_summary(root: str | Path, username: str | None, *, include_all: bool = False) -> dict[str, Any]:
    """Return AIWS-recorded monthly API cost and end-of-month projection."""
    user_summary = _summary_for_records(storage.list_model_usage(root, username), username=username)
    payload: dict[str, Any] = {
        "basis": "AIWS recorded usage. actual_usd is used when provider response records it; otherwise estimated_usd from model token pricing is used.",
        "provider_billing_note": "Provider billing dashboards remain the source of truth because BYOK providers do not expose one common billing API.",
        "user": user_summary,
    }
    if include_all:
        payload["all_accounts"] = _summary_for_records(storage.list_model_usage(root, None), username=None)
    return payload


def _summary_for_records(records: list[dict[str, Any]], *, username: str | None) -> dict[str, Any]:
    today = date.today()
    month_prefix = today.isoformat()[:7]
    day_prefix = today.isoformat()
    month_records = [item for item in records if str(item.get("created_at", "")).startswith(month_prefix)]
    day_records = [item for item in records if str(item.get("created_at", "")).startswith(day_prefix)]
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    elapsed_days = max(today.day, 1)
    month_usd = _total_usd(month_records)
    projected_month_usd = round(month_usd / elapsed_days * days_in_month, 8) if elapsed_days else month_usd
    return {
        "username": storage.slugify(username) if username else "all",
        "period": month_prefix,
        "today_usd": _total_usd(day_records),
        "month_usd": month_usd,
        "projected_month_usd": projected_month_usd,
        "days_elapsed": elapsed_days,
        "days_in_month": days_in_month,
        "calls": len(month_records),
        "failed_calls": len([item for item in month_records if item.get("status") == "failed"]),
        "providers": _providers(month_records),
    }


def _total_usd(records: list[dict[str, Any]]) -> float:
    return round(sum(float(item.get("actual_usd") or item.get("estimated_usd") or 0.0) for item in records), 8)


def _providers(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for item in records:
        provider = str(item.get("provider") or "unknown")
        entry = totals.setdefault(provider, {"provider": provider, "usd": 0.0, "calls": 0})
        entry["usd"] = round(float(entry["usd"]) + float(item.get("actual_usd") or item.get("estimated_usd") or 0.0), 8)
        entry["calls"] = int(entry["calls"]) + 1
    return sorted(totals.values(), key=lambda item: float(item["usd"]), reverse=True)
