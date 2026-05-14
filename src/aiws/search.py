"""Search mode helpers."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib import parse, request

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


def web_search(query: str, *, limit: int = 5, timeout: int = 8) -> list[SearchResult]:
    clean = " ".join(query.split()).strip()
    if not clean:
        return []
    url = "https://duckduckgo.com/html/?" + parse.urlencode({"q": clean})
    req = request.Request(
        url,
        headers={
            "User-Agent": "AIWS/0.1 local workspace search",
            "Accept": "text/html",
        },
        method="GET",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            html = response.read().decode("utf-8", errors="replace")
    except Exception:
        return []
    parser = DuckDuckGoHTMLParser(limit=limit)
    parser.feed(html)
    return parser.results[:limit]


class DuckDuckGoHTMLParser(HTMLParser):
    def __init__(self, *, limit: int) -> None:
        super().__init__()
        self.limit = limit
        self.results: list[SearchResult] = []
        self._in_link = False
        self._in_snippet = False
        self._pending_url = ""
        self._title_parts: list[str] = []
        self._snippet_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        classes = set(values.get("class", "").split())
        if tag == "a" and "result__a" in classes:
            self._in_link = True
            self._pending_url = normalize_duckduckgo_url(values.get("href", ""))
            self._title_parts = []
        elif "result__snippet" in classes:
            self._in_snippet = True
            self._snippet_parts = []

    def handle_data(self, data: str) -> None:
        if self._in_link:
            self._title_parts.append(data)
        if self._in_snippet:
            self._snippet_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_link:
            title = " ".join("".join(self._title_parts).split())
            if title and self._pending_url:
                self.results.append(SearchResult(title=unescape(title), url=self._pending_url, snippet=""))
            self._in_link = False
            self._pending_url = ""
            self._title_parts = []
        elif self._in_snippet:
            snippet = " ".join("".join(self._snippet_parts).split())
            if snippet and self.results and not self.results[-1].snippet:
                latest = self.results[-1]
                self.results[-1] = SearchResult(latest.title, latest.url, unescape(snippet))
            self._in_snippet = False
            self._snippet_parts = []


def normalize_duckduckgo_url(value: str) -> str:
    if value.startswith("//duckduckgo.com/l/?"):
        parsed = parse.parse_qs(parse.urlsplit("https:" + value).query)
        return unescape(parsed.get("uddg", [value])[0])
    if value.startswith("/l/?"):
        parsed = parse.parse_qs(parse.urlsplit("https://duckduckgo.com" + value).query)
        return unescape(parsed.get("uddg", [value])[0])
    return unescape(value)


def results_metadata(mode: str, results: list[SearchResult]) -> dict[str, object]:
    validate_search_mode(mode)
    return {
        "mode": mode,
        "sources": [
            {"title": result.title, "url": result.url, "snippet": result.snippet}
            for result in results
        ],
    }
