"""Search mode helpers."""

from __future__ import annotations

from dataclasses import dataclass

from . import storage

SEARCH_MODES = {"off", "auto", "always"}


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


def validate_search_mode(mode: str) -> str:
    if mode not in SEARCH_MODES:
        raise storage.WorkspaceError("Search mode must be off, auto, or always.")
    return mode


def should_search(mode: str, content: str) -> bool:
    validate_search_mode(mode)
    if mode == "off":
        return False
    if mode == "always":
        return True
    triggers = ("today", "latest", "current", "news", "price", "weather", "검색", "최신", "오늘", "뉴스")
    return any(trigger in content.lower() for trigger in triggers)


def format_search_context(results: list[SearchResult]) -> str:
    if not results:
        return ""
    lines = ["## Search Context"]
    for index, result in enumerate(results, start=1):
        lines.extend(
            [
                f"{index}. {result.title}",
                f"   URL: {result.url}",
                f"   Snippet: {result.snippet}",
            ]
        )
    return "\n".join(lines) + "\n"


def results_metadata(mode: str, results: list[SearchResult]) -> dict[str, object]:
    validate_search_mode(mode)
    return {
        "mode": mode,
        "sources": [
            {"title": result.title, "url": result.url, "snippet": result.snippet}
            for result in results
        ],
    }
