import pytest

from aiws import search, storage


def test_search_mode_validation_and_decision():
    assert search.should_search("off", "latest news") is False
    assert search.should_search("always", "hello") is True
    assert search.should_search("auto", "latest news") is True
    assert search.should_search("auto", "hello") is False

    with pytest.raises(storage.WorkspaceError):
        search.should_search("bad", "hello")


def test_search_context_and_metadata():
    result = search.SearchResult(title="Example", url="https://example.com", snippet="Snippet")

    context = search.format_search_context([result])
    metadata = search.results_metadata("always", [result])

    assert "## Search Context" in context
    assert "https://example.com" in context
    assert metadata["sources"][0]["title"] == "Example"


def test_web_search_parses_duckduckgo_results(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b"""
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">Example Doc</a>
            <a class="result__snippet">Useful snippet</a>
            """

    monkeypatch.setattr(search.request, "urlopen", lambda req, timeout: FakeResponse())

    results = search.web_search("example query")

    assert results == [search.SearchResult(title="Example Doc", url="https://example.com/doc", snippet="Useful snippet")]
